import { getAuth, type User } from 'firebase/auth';
import {
  Timestamp,
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { type CommandErrorCode, type CommandReceipt, type CommandResult } from '../domain/cloudCommands';
import {
  CLOUD_PENDING_JOURNAL_PAGE_SIZE,
  cloudPendingJournalForRepository,
  PendingJournalUnavailableError,
  type CloudPendingJournal,
  type PendingCommandIdentity,
} from './cloudPendingJournal';
import { appendCommandDiagnostic } from '../errors/errorLogger';
import {
  CASHIER_NAME_SNAPSHOT,
  CASHIER_STUDENT_ID,
  InvalidCloudCommandInput,
  cashMovementEffect,
  refundCashEffect,
  decodeEnabledCommandDoc,
  decodeSettlementDoc,
  settlementExpectedCash,
  fingerprintCommandInput,
  normalizeEnabledCommandInput,
  sameCommandSemantics,
  type CommandDiagnosticIdentity,
  type CanonicalEnabledInput,
  type StoredEnabledCommandDoc,
} from '../domain/cloudCommandSchema';
import { STUDENT_CODE_REGEX } from '../domain/student';
import {
  TransactionMutationRejected,
  applyTransactionMutation,
  isTransactionMutationKind,
  mutationCashEffect,
  studentContribution,
  totalsContribution,
  type MutableTransaction,
  type TransactionMutationKind,
  type TransactionMutationPayload,
} from '../domain/cloudTransactionMutation';
import {
  accessLeasePath, backfillDayPath, commandPath, dataHeadPath, dayPath, postCloseEntryPath, settlementPath, studentCodePath, studentPath, transactionPath, vendorPath,
} from './firestorePaths';
import {
  CloudRecoveryReaderError,
  type CloudRecoveryReader,
  type RecoveryDocumentSnapshot,
} from './cloudRecoveryReader';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

interface CapturedPendingIntent {
  canonical: CanonicalEnabledInput | null;
  verificationError: RejectCommand | null;
}

function captureCanonicalValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidCloudCommandInput('原命令含非有限數值');
    return value;
  }
  if (typeof value !== 'object') throw new InvalidCloudCommandInput('原命令含不支援的資料值');
  if (ancestors.has(value)) throw new InvalidCloudCommandInput('原命令資料不可循環參照');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new InvalidCloudCommandInput('原命令陣列必須使用固定陣列原型');
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || lengthDescriptor.enumerable) {
        throw new InvalidCloudCommandInput('原命令陣列長度描述子不支援');
      }
      const length = lengthDescriptor.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
        throw new InvalidCloudCommandInput('原命令陣列長度不正確');
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1 || keys.some(key => {
        if (key === 'length') return false;
        if (typeof key !== 'string') return true;
        const index = Number(key);
        return !Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key;
      })) {
        throw new InvalidCloudCommandInput('原命令陣列不可稀疏或含額外欄位');
      }

      const captured: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new InvalidCloudCommandInput('原命令陣列只能包含可列舉資料欄位');
        }
        Object.defineProperty(captured, String(index), {
          value: captureCanonicalValue(descriptor.value, ancestors),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return captured;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidCloudCommandInput('原命令物件必須是固定物件');
    }
    const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new InvalidCloudCommandInput('原命令物件不可含 Symbol 欄位');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new InvalidCloudCommandInput('原命令物件只能包含可列舉資料欄位');
      }
      Object.defineProperty(captured, key, {
        value: captureCanonicalValue(descriptor.value, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return captured;
  } finally {
    ancestors.delete(value);
  }
}

function captureCanonicalData(value: CanonicalEnabledInput): CanonicalEnabledInput {
  // The domain normalizer has already validated this schema. Copy its data values
  // without property reads, accessors, inherited serializers, or mutable aliases.
  return captureCanonicalValue(value, new WeakSet<object>()) as CanonicalEnabledInput;
}

export interface CloudCommandRepositoryOptions {
  /** Injection seam for emulator tests; production callers use Firebase Auth currentUser. */
  currentUser?: () => CurrentUser | null;
  /** Explicit journal injection for browser tests; production callers use localStorage and Web Locks. */
  pendingJournal?: CloudPendingJournal;
}

class RejectCommand extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type PendingReceiptCheck =
  | { status: 'matched'; receipt: CommandReceipt }
  | { status: 'not-found' }
  | { status: 'different-dataset' };

export type PendingIntentCheck =
  | { status: 'matched'; receipt: CommandReceipt }
  | { status: 'not-found' }
  | { status: 'different-dataset' };

type InternalPendingReceiptCheck =
  | { status: 'matched'; receipt: CommandReceipt; stored: StoredEnabledCommandDoc }
  | { status: 'not-found' }
  | { status: 'different-dataset' };

export class CloudCommandReadError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudCommandReadError';
  }
}

function errorResult(code: CommandErrorCode, message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

const LOCAL_STORAGE_UNAVAILABLE_MESSAGE = '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。';

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: string[]): value is Data {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum;
}

function sameStringList(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decodeHead(value: unknown): Data {
  const keys = ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || value.schemaVersion !== 1
    || typeof value.datasetId !== 'string' || value.datasetId.length === 0
    || !integer(value.seq)
    || (value.lastCommandId !== null && typeof value.lastCommandId !== 'string')
    || typeof value.maintenance !== 'boolean'
    || !validDate(value.goLiveDate)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '雲端 dataHead schema 不支援');
  }
  return value;
}

function decodeLease(value: unknown): Data {
  if (!hasExactKeys(value, ['holderUid', 'epoch', 'updatedAt'])
    || (value.holderUid !== null && (typeof value.holderUid !== 'string' || value.holderUid.length === 0))
    || !integer(value.epoch)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '雲端 accessLease schema 不支援');
  }
  return value;
}

function decodeStudent(value: unknown): Data {
  const keys = ['studentId', 'studentCode', 'displayName', 'aliases', 'status', 'openingBalance', 'currentBalance', 'createdAt', 'revision', 'lastCommandId', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || typeof value.studentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.studentId)
    || typeof value.studentCode !== 'string' || !STUDENT_CODE_REGEX.test(value.studentCode)
    || typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 100
    || !Array.isArray(value.aliases) || value.aliases.length > 10 || !value.aliases.every(x => typeof x === 'string' && x.length > 0 && x.length <= 100)
    || (value.status !== 'active' && value.status !== 'inactive')
    || !plainRecord(value.openingBalance)
    || !hasExactKeys(value.openingBalance, ['amount', 'asOfDate', 'note', 'createdAt'])
    || !integer(value.openingBalance.amount, -1_000_000_000)
    || !validDate(value.openingBalance.asOfDate)
    || typeof value.openingBalance.note !== 'string' || value.openingBalance.note.length > 500
    || !(value.openingBalance.createdAt instanceof Timestamp)
    || !integer(value.currentBalance, -1_000_000_000)
    || Math.abs(value.currentBalance) > 1_000_000_000
    || !(value.createdAt instanceof Timestamp)
    || !integer(value.revision, 1)
    || typeof value.lastCommandId !== 'string'
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '學生文件 schema 不支援');
  }
  return value;
}

function decodeDay(value: unknown): Data {
  const keys = ['status', 'revision', 'menu', 'openingCash', 'openedBy', 'openedAt', 'totals', 'lastSettlementRevision', 'lastCommandId', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || !['open', 'closed', 'reopened'].includes(String(value.status))
    || !integer(value.revision, 1)
    || (value.openingCash !== null && (!integer(value.openingCash) || value.openingCash > 20_000))
    || (value.openedBy !== null && (typeof value.openedBy !== 'string' || !value.openedBy))
    || (value.openedAt !== null && !(value.openedAt instanceof Timestamp))
    || ((value.openingCash === null) !== (value.openedBy === null))
    || ((value.openingCash === null) !== (value.openedAt === null))
    || !plainRecord(value.totals)
    || !hasExactKeys(value.totals, ['activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense', 'accountRefunds'])
    || !integer(value.totals.activeTransactionCount)
    || !integer(value.totals.bentoCount)
    || !integer(value.totals.otherMealCount)
    || !integer(value.totals.mealTotal) || value.totals.mealTotal > 1_000_000_000
    || !integer(value.totals.retainedReceipts) || value.totals.retainedReceipts > 1_000_000_000
    || !integer(value.totals.cashierIncome) || value.totals.cashierIncome > 1_000_000_000
    || !integer(value.totals.cashierExpense) || value.totals.cashierExpense > 1_000_000_000
    || !integer(value.totals.accountRefunds) || value.totals.accountRefunds > 1_000_000_000
    || !integer(value.lastSettlementRevision)
    || typeof value.lastCommandId !== 'string'
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '營業日文件 schema 不支援');
  }
  if (value.menu !== null) {
    const menu = value.menu;
    if (!plainRecord(menu)
      || !hasExactKeys(menu, ['businessDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'updatedAt', 'revision', 'inheritedFromDate'])
      || !validDate(menu.businessDate)
      || typeof menu.itemName !== 'string' || menu.itemName.length < 1 || menu.itemName.length > 100
      || !integer(menu.price, 1) || menu.price > 1_000_000
      || typeof menu.vendorId !== 'string' || !menu.vendorId
      || typeof menu.vendorNameSnapshot !== 'string' || !menu.vendorNameSnapshot
      || !(menu.updatedAt instanceof Timestamp)
      || !integer(menu.revision, 1)
      || (menu.inheritedFromDate !== null && !validDate(menu.inheritedFromDate))) {
      throw new RejectCommand('UNSUPPORTED_SCHEMA', '營業日菜單 schema 不支援');
    }
  }
  return value;
}

function decodeVendor(value: unknown): Data {
  const keys = ['vendorId', 'name', 'phone', 'note', 'status', 'deleted', 'createdAt', 'revision', 'lastCommandId', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || typeof value.vendorId !== 'string' || value.vendorId.length < 1 || value.vendorId.length > 64 || value.vendorId.includes('/')
    || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 100
    || typeof value.phone !== 'string' || value.phone.length > 100
    || typeof value.note !== 'string' || value.note.length > 500
    || (value.status !== 'active' && value.status !== 'inactive') || typeof value.deleted !== 'boolean'
    || !(value.createdAt instanceof Timestamp) || !integer(value.revision, 1)
    || typeof value.lastCommandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.lastCommandId)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '供應商文件 schema 不支援');
  }
  return value;
}

/** Same 24-key transaction document as Rules `validTransactionDoc` and the P10a mutations. */
function decodeTransaction(value: unknown): Data {
  const keys = [
    'transactionId', 'studentId', 'businessDate', 'type', 'mealKind', 'mealPrice', 'paidAmount', 'amount',
    'studentNameSnapshot', 'menuNameSnapshot', 'menuPriceSnapshot', 'vendorIdSnapshot', 'vendorNameSnapshot',
    'otherItemName', 'status', 'revision', 'createdAt', 'createdSeq', 'operatorUid', 'operatorEmail',
    'sourceDevice', 'note', 'lastCommandId', 'updatedAt',
  ];
  if (!hasExactKeys(value, keys)
    || typeof value.transactionId !== 'string' || typeof value.studentId !== 'string' || !validDate(value.businessDate)
    || !['order', 'payment', 'expense', 'refund'].includes(String(value.type))
    || (value.mealKind !== null && value.mealKind !== 'bento' && value.mealKind !== 'other')
    || !integer(value.mealPrice) || value.mealPrice > 1_000_000
    || !integer(value.paidAmount) || value.paidAmount > 1_000_000
    || !integer(value.amount, -1_000_000) || value.amount > 1_000_000
    || (value.status !== 'active' && value.status !== 'voided')
    || !integer(value.revision, 1) || !integer(value.createdSeq, 1)
    || typeof value.note !== 'string' || typeof value.operatorUid !== 'string' || typeof value.lastCommandId !== 'string'
    || !(value.createdAt instanceof Timestamp) || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '交易文件 schema 不支援');
  }
  return value;
}

function taipeiCalendarDate(timestamp: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp.toDate());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function getCurrentUser(options: CloudCommandRepositoryOptions): CurrentUser | null {
  if (options.currentUser) return options.currentUser();
  try {
    return getAuth().currentUser;
  } catch {
    return null;
  }
}

function requireVerifiedGoogle(user: CurrentUser | null): asserts user is CurrentUser {
  if (!user || !user.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new RejectCommand('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
}

function checkOperator(raw: unknown, user: CurrentUser): void {
  if (!plainRecord(raw) || raw.uid !== user.uid || raw.email !== user.email || raw.active !== true) {
    throw new RejectCommand('UNAUTHORIZED', '此 Google 身分不是啟用中的操作員');
  }
}

function checkLease(raw: unknown, input: CanonicalEnabledInput, user: CurrentUser): void {
  const lease = decodeLease(raw);
  if (lease.holderUid !== user.uid || lease.epoch !== input.leaseEpoch) {
    throw new RejectCommand('LEASE_LOST', '目前使用權租約已變更，請重新確認');
  }
  // Expiration authority remains the Firestore Rules request.time comparison.
}

function checkRevision(actual: unknown, expected: number, label: string): void {
  if (actual !== expected) throw new RejectCommand('REVISION_CONFLICT', `${label} 已變更，請重新載入`);
}

function requireDateAfterGoLive(date: string, goLiveDate: string): void {
  if (date < goLiveDate) throw new RejectCommand('INVALID_INPUT', '營業日早於系統啟用日期');
}

function buildReceipt(stored: StoredEnabledCommandDoc): CommandReceipt {
  if (!(stored.committedAt instanceof Timestamp) || stored.after === null) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt 缺少伺服器 Timestamp 或 after snapshot');
  }
  return {
    commandId: stored.commandId,
    seq: stored.seq,
    committedAt: stored.committedAt.toDate().toISOString(),
    kind: stored.kind,
    targets: stored.targets,
    result: stored.after,
  };
}

function storedInput(stored: StoredEnabledCommandDoc): unknown {
  return {
    commandId: stored.commandId,
    kind: stored.kind,
    leaseEpoch: stored.leaseEpoch,
    targets: stored.targets,
    expectedRevisions: stored.expectedRevisions,
    payload: stored.payload,
  };
}

async function assertStoredReceiptMatches(stored: StoredEnabledCommandDoc, input: CanonicalEnabledInput, fingerprint: string): Promise<void> {
  if (!sameCommandSemantics(input, storedInput(stored))) {
    throw new RejectCommand('INVALID_INPUT', 'commandId 已用於不同的命令內容');
  }
  const storedNormalized = normalizeEnabledCommandInput(storedInput(stored));
  const actualFingerprint = await fingerprintCommandInput(storedNormalized);
  if (stored.inputFingerprint !== actualFingerprint || stored.inputFingerprint !== fingerprint) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt semantic input 與 fingerprint 不一致');
  }
}

function mapTransactionError(error: unknown): CommandErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    if (code.includes('resource-exhausted')) return 'QUOTA_EXCEEDED';
    if (code.includes('permission-denied')) return 'LEASE_LOST';
    if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) return 'UNKNOWN_RESULT';
    if (code.includes('aborted')) return 'REVISION_CONFLICT';
  }
  return 'UNKNOWN_RESULT';
}

function resultFromUnknownError(message = '提交回應不確定，請用原 commandId 查詢結果'): CommandResult {
  return errorResult('UNKNOWN_RESULT', message);
}

/**
 * A diagnosis is a command error code, or one of two finer reasons a transaction on a past day is refused
 * (contract §12.2); `leaseDenialResult` turns them into the code and message the operator sees.
 */
type Diagnosis = CommandErrorCode | 'DAY_REOPENED_AFTER_CLOSE' | 'DAY_REOPENED_NO_MARKER' | 'DAY_NOT_BACKFILLING' | null;

/**
 * Revisions matched but Rules still refused an order, payment or cash movement: say why when the day is not today.
 * Only rejection paths read these two extra documents.
 */
async function diagnoseTransactionDay(db: Firestore, dayId: string, dayValue: Data): Promise<Diagnosis> {
  const lease = await getDocFromServer(doc(db, accessLeasePath()));
  if (!lease.exists()) return 'INVALID_INPUT';
  const today = taipeiCalendarDate((lease.data() as Data).updatedAt as Timestamp);
  if (dayId === today) return dayValue.status === 'closed' ? 'DAY_CLOSED' : 'INVALID_INPUT';
  if (dayValue.status === 'closed') return 'DAY_CLOSED';
  if (dayId > today) return 'INVALID_INPUT';
  const marker = await getDocFromServer(doc(db, backfillDayPath(dayId)));
  if (Number(dayValue.lastSettlementRevision) > 0) return marker.exists() ? 'DAY_REOPENED_AFTER_CLOSE' : 'DAY_REOPENED_NO_MARKER';
  return marker.exists() ? 'INVALID_INPUT' : 'DAY_NOT_BACKFILLING';
}

async function readRevisionConflict(db: Firestore, input: CanonicalEnabledInput): Promise<Diagnosis> {
  try {
    if (input.kind === 'CreateStudent' || input.kind === 'ChangeStudentCode' || input.kind === 'EditStudent' || input.kind === 'SetStudentStatus') {
      const student = await getDocFromServer(doc(db, studentPath(input.targets.studentId)));
      if (input.kind === 'CreateStudent') return 'INVALID_INPUT';
      if (!student.exists()) return 'INVALID_INPUT';
      const current = decodeStudent(student.data());
      return current.revision === input.expectedRevisions.student ? 'INVALID_INPUT' : 'REVISION_CONFLICT';
    }
    if (input.kind === 'CorrectOpening') {
      const [student, day] = await Promise.all([
        getDocFromServer(doc(db, studentPath(input.targets.studentId))),
        getDocFromServer(doc(db, dayPath(input.targets.dayId))),
      ]);
      if (!student.exists() || !day.exists()) return 'INVALID_INPUT';
      const dayValue = decodeDay(day.data());
      if (decodeStudent(student.data()).revision !== input.expectedRevisions.student
        || dayValue.revision !== input.expectedRevisions.day) {
        return 'REVISION_CONFLICT';
      }
      if (dayValue.status === 'closed') return 'DAY_CLOSED';
      return 'INVALID_INPUT';
    }
    if (input.kind === 'EnsureDay') {
      await getDocFromServer(doc(db, dayPath(input.targets.dayId)));
      return 'INVALID_INPUT';
    }
    if (input.kind === 'CloseDay' || input.kind === 'ReopenDay') {
      const day = await getDocFromServer(doc(db, dayPath(input.targets.dayId)));
      if (!day.exists()) return 'INVALID_INPUT';
      const dayValue = decodeDay(day.data());
      if (dayValue.revision !== input.expectedRevisions.day
        || dayValue.lastSettlementRevision !== input.expectedRevisions.settlement) {
        return 'REVISION_CONFLICT';
      }
      if (input.kind === 'CloseDay' && dayValue.status === 'closed') return 'DAY_CLOSED';
      return 'INVALID_INPUT';
    }
    if (input.kind === 'SaveVendor' || input.kind === 'RemoveVendor') {
      const vendor = await getDocFromServer(doc(db, vendorPath(input.targets.vendorId)));
      if (!vendor.exists()) {
        return input.expectedRevisions.vendor === 0 ? 'INVALID_INPUT' : 'REVISION_CONFLICT';
      }
      const current = decodeVendor(vendor.data());
      return current.revision === input.expectedRevisions.vendor ? 'INVALID_INPUT' : 'REVISION_CONFLICT';
    }
    if (input.kind === 'BackfillOpeningCash' || input.kind === 'StartBackfill') {
      const daySnapshot = await getDocFromServer(doc(db, dayPath(input.targets.dayId)));
      if (!daySnapshot.exists()) return 'INVALID_INPUT';
      const day = decodeDay(daySnapshot.data());
      if (day.revision !== input.expectedRevisions.day) return 'REVISION_CONFLICT';
      if (day.status === 'closed') return 'DAY_CLOSED';
      if (input.kind === 'StartBackfill' && day.lastSettlementRevision !== 0) return 'DAY_CLOSED';
      return 'INVALID_INPUT';
    }
    if (input.kind === 'RecordPostCloseEntry') {
      const daySnapshot = await getDocFromServer(doc(db, dayPath(input.targets.dayId)));
      if (!daySnapshot.exists()) return 'INVALID_INPUT';
      const day = decodeDay(daySnapshot.data());
      if (day.revision !== input.expectedRevisions.day
        || day.lastSettlementRevision !== input.expectedRevisions.settlement) {
        return 'REVISION_CONFLICT';
      }
      return 'INVALID_INPUT';
    }
    if (input.kind === 'SetDayMenu' || input.kind === 'SetOpeningCash') {
      const daySnapshot = await getDocFromServer(doc(db, dayPath(input.targets.dayId)));
      if (!daySnapshot.exists()) return 'INVALID_INPUT';
      const day = decodeDay(daySnapshot.data());
      if (day.revision !== input.expectedRevisions.day) return 'REVISION_CONFLICT';
      if (input.kind === 'SetDayMenu') {
        const headSnapshot = await getDocFromServer(doc(db, dataHeadPath()));
        if (!headSnapshot.exists()) return 'UNSUPPORTED_SCHEMA';
        const head = decodeHead(headSnapshot.data());
        if (head.seq !== input.expectedRevisions.headSeq) return 'REVISION_CONFLICT';
      }
      if (day.status === 'closed') return 'DAY_CLOSED';
      // A successful server-only day read proves this operator still has read access under
      // the active lease. Rules may still reject frozen selectionDate or other command content;
      // those are retryable data/input errors, not evidence that the lease was lost.
      return 'INVALID_INPUT';
    }
    if (input.kind === 'CreateCashMovement') {
      const [day, transaction] = await Promise.all([
        getDocFromServer(doc(db, dayPath(input.targets.dayId))),
        getDocFromServer(doc(db, transactionPath(input.targets.transactionId))),
      ]);
      if (transaction.exists() || !day.exists()) return 'INVALID_INPUT';
      const current = decodeDay(day.data());
      if (current.revision !== input.expectedRevisions.day) return 'REVISION_CONFLICT';
      return await diagnoseTransactionDay(db, input.targets.dayId, current);
    }
    if (isTransactionMutationKind(input.kind)) {
      const mutation = input as Extract<CanonicalEnabledInput, { kind: TransactionMutationKind }>;
      const cashier = mutation.targets.studentId === CASHIER_STUDENT_ID;
      const [transaction, day, student] = await Promise.all([
        getDocFromServer(doc(db, transactionPath(mutation.targets.transactionId))),
        getDocFromServer(doc(db, dayPath(mutation.targets.dayId))),
        cashier ? Promise.resolve(null) : getDocFromServer(doc(db, studentPath(mutation.targets.studentId))),
      ]);
      if (!transaction.exists() || !day.exists() || (student !== null && !student.exists())) return 'INVALID_INPUT';
      const transactionValue = decodeTransaction(transaction.data());
      const dayValue = decodeDay(day.data());
      if (transactionValue.revision !== mutation.expectedRevisions.transaction
        || dayValue.revision !== mutation.expectedRevisions.day
        || (student !== null && decodeStudent(student.data()).revision !== mutation.expectedRevisions.student)) {
        return 'REVISION_CONFLICT';
      }
      if (dayValue.status === 'closed') return 'DAY_CLOSED';
      return 'INVALID_INPUT';
    }
    if (input.kind !== 'CreateOrder' && input.kind !== 'CreatePayment' && input.kind !== 'CreateRefund') return null;
    const [student, day, transaction] = await Promise.all([
      getDocFromServer(doc(db, studentPath(input.targets.studentId))),
      getDocFromServer(doc(db, dayPath(input.targets.dayId))),
      getDocFromServer(doc(db, transactionPath(input.targets.transactionId))),
    ]);
    if (transaction.exists()) return 'INVALID_INPUT';
    if (!student.exists() || !day.exists()) return null;
    const studentValue = student.data();
    const dayValue = day.data();
    if (studentValue.revision !== input.expectedRevisions.student || dayValue.revision !== input.expectedRevisions.day) {
      return 'REVISION_CONFLICT';
    }
    if (input.kind === 'CreateRefund' && decodeDay(dayValue).status === 'closed') return 'DAY_CLOSED';
    if (input.kind === 'CreateOrder' || input.kind === 'CreatePayment') {
      return await diagnoseTransactionDay(db, input.targets.dayId, decodeDay(dayValue));
    }
    // A successful server-only projection read proves that the current-holder read guard passed.
    // If the revisions still match, the Rules rejected this command's content/state (for example,
    // an unsupported historical transaction date), not a stale revision.
    return 'INVALID_INPUT';
  } catch (error) {
    if (error instanceof RejectCommand && error.code === 'UNSUPPORTED_SCHEMA') return error.code;
    // Server-only reads are also the current-holder/lease validity check. A denied read is not evidence of a conflict.
    return null;
  }
}

function leaseDenialResult(code: Diagnosis): CommandResult | null {
  if (code === null) return null;
  if (code === 'DAY_REOPENED_AFTER_CLOSE') {
    return errorResult('DAY_CLOSED', '這個營業日曾經關過帳（現在是重開狀態），不能再用回填補登訂餐、繳費或櫃台收支；要修正這一天的帳請用更正或作廢');
  }
  if (code === 'DAY_REOPENED_NO_MARKER') {
    return errorResult('DAY_CLOSED', '這個營業日關過帳後重開，而且沒有回填標記，所以不能補登訂餐、繳費或櫃台收支；要修正這一天的帳請用更正或作廢');
  }
  if (code === 'DAY_NOT_BACKFILLING') {
    return errorResult('INVALID_INPUT', '這個過去的營業日沒有回填標記，不能補登；請先到日結頁把它標為回填');
  }
  if (code === 'REVISION_CONFLICT') {
    return errorResult(code, '伺服器資料已變更；請保留 commandId 並重新確認');
  }
  if (code === 'INVALID_INPUT') {
    return errorResult(code, '目前 Rules 不允許這筆命令；請檢查日期與資料狀態');
  }
  if (code === 'DAY_CLOSED') {
    return errorResult(code, '營業日已關閉；請重新載入日期資料');
  }
  if (code === 'UNSUPPORTED_SCHEMA') {
    return errorResult(code, '伺服器日期或資料版本不支援；請聯絡管理者');
  }
  return null;
}

export function createCloudCommandRepository(db: Firestore, options: CloudCommandRepositoryOptions = {}) {
  const pendingJournal = options.pendingJournal ?? cloudPendingJournalForRepository(db);

  interface RecoveryContext {
    uid: string;
    datasetId: string;
    leaseEpoch: number;
    maintenance: boolean;
  }

  function assertCurrentRecoveryOwner(user: CurrentUser): void {
    const current = getCurrentUser(options);
    requireVerifiedGoogle(current);
    if (current.uid !== user.uid || current.email !== user.email) {
      throw new RejectCommand('LEASE_LOST', '登入身分已變更，請重新確認使用權');
    }
  }

  function isCurrentRecoveryOwner(user: CurrentUser): boolean {
    try {
      assertCurrentRecoveryOwner(user);
      return true;
    } catch {
      return false;
    }
  }

  async function readRecoveryContext(
    user: CurrentUser,
    expectedEpoch: number,
    recoveryReader?: CloudRecoveryReader,
  ): Promise<RecoveryContext> {
    assertCurrentRecoveryOwner(user);
    recoveryReader?.assertCurrent();
    let headSnapshot: RecoveryDocumentSnapshot;
    let leaseSnapshot: RecoveryDocumentSnapshot;
    let operatorSnapshot: RecoveryDocumentSnapshot;
    try {
      [headSnapshot, leaseSnapshot, operatorSnapshot] = recoveryReader
        ? await Promise.all([
          recoveryReader.readHead(),
          recoveryReader.readLease(),
          recoveryReader.readOperator(user.uid),
        ])
        : await Promise.all([
          getDocFromServer(doc(db, dataHeadPath())),
          getDocFromServer(doc(db, accessLeasePath())),
          getDocFromServer(doc(db, `operators/${user.uid}`)),
        ]);
    } catch (error) {
      if (error instanceof CloudRecoveryReaderError) throw new RejectCommand(error.code, error.message);
      throw error;
    }
    recoveryReader?.assertCurrent();
    assertCurrentRecoveryOwner(user);
    if ([headSnapshot, leaseSnapshot, operatorSnapshot].some(snapshot => snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)) {
      throw new RejectCommand('UNKNOWN_RESULT', '伺服器尚未確認目前資料與使用權');
    }
    if (!headSnapshot.exists()) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'dataHead 尚未由維護者初始化');
    if (!leaseSnapshot.exists()) throw new RejectCommand('LEASE_LOST', '使用權租約不存在');
    if (!operatorSnapshot.exists()) throw new RejectCommand('UNAUTHORIZED', '操作員文件不存在');
    const head = decodeHead(headSnapshot.data());
    const lease = decodeLease(leaseSnapshot.data());
    checkOperator(operatorSnapshot.data(), user);
    if (lease.holderUid !== user.uid || lease.epoch !== expectedEpoch) {
      throw new RejectCommand('LEASE_LOST', '目前使用權租約已變更，請重新確認');
    }
    return { uid: user.uid, datasetId: String(head.datasetId), leaseEpoch: Number(lease.epoch), maintenance: head.maintenance === true };
  }

  async function confirmPendingBatch(
    records: readonly PendingCommandIdentity[],
    expectedEpoch: number,
    recoveryReader?: CloudRecoveryReader,
  ): Promise<InternalPendingReceiptCheck[]> {
    if (records.length < 1 || records.length > CLOUD_PENDING_JOURNAL_PAGE_SIZE) {
      throw new CloudCommandReadError('INVALID_INPUT', '一次最多核對 100 筆待決識別');
    }
    const candidateUser = getCurrentUser(options);
    try {
      requireVerifiedGoogle(candidateUser);
    } catch {
      throw new CloudCommandReadError('UNAUTHORIZED', '需要目前已驗證的 Google 操作員身分');
    }
    const user = candidateUser;
    try {
      const before = await readRecoveryContext(user, expectedEpoch, recoveryReader);
      const checks: InternalPendingReceiptCheck[] = [];
      for (const record of records) {
        if (before.datasetId !== record.datasetId) {
          checks.push({ status: 'different-dataset' });
          continue;
        }
        let stored: StoredEnabledCommandDoc | null;
        try {
          stored = await verifiedReceipt(record.commandId, recoveryReader);
        } catch (error) {
          if (error instanceof CloudRecoveryReaderError) throw new RejectCommand(error.code, error.message);
          throw error;
        }
        recoveryReader?.assertCurrent();
        assertCurrentRecoveryOwner(user);
        if (!stored) {
          checks.push({ status: 'not-found' });
          continue;
        }
        const beforeDataset = (stored.before as Data | null)?.head && ((stored.before as Data).head as Data).datasetId;
        const afterDataset = (stored.after as Data | null)?.head && ((stored.after as Data).head as Data).datasetId;
        if (stored.commandId !== record.commandId || stored.actor.uid !== record.uid
          || beforeDataset !== record.datasetId || afterDataset !== record.datasetId) {
          throw new RejectCommand('UNSUPPORTED_SCHEMA', '伺服器 receipt 與待核對識別不一致');
        }
        checks.push({ status: 'matched', receipt: buildReceipt(stored), stored });
      }
      const after = await readRecoveryContext(user, expectedEpoch, recoveryReader);
      if (before.uid !== after.uid || before.datasetId !== after.datasetId || before.leaseEpoch !== after.leaseEpoch) {
        throw new RejectCommand('LEASE_LOST', '查詢期間使用權或資料集已變更');
      }
      return checks;
    } catch (error) {
      if (error instanceof CloudCommandReadError) throw error;
      if (error instanceof RejectCommand) throw new CloudCommandReadError(error.code, error.message);
      throw new CloudCommandReadError(mapTransactionError(error), '目前無法安全確認伺服器 receipt');
    }
  }

  async function confirmPendingCommand(
    record: PendingCommandIdentity,
    expectedEpoch: number,
    recoveryReader?: CloudRecoveryReader,
  ): Promise<InternalPendingReceiptCheck> {
    return (await confirmPendingBatch([record], expectedEpoch, recoveryReader))[0];
  }

  async function clearAfterConfirmedReceipt(
    record: PendingCommandIdentity,
    expectedEpoch: number,
    owner: CurrentUser,
  ): Promise<void> {
    try {
      const check = await confirmPendingCommand(record, expectedEpoch);
      if (check.status === 'matched') {
        // Receipt and server owner/dataset/lease checks completed above, outside the journal lock.
        // The lock callback must remain a synchronous observation of the live Auth owner.
        await pendingJournal.removeIf(record, () => isCurrentRecoveryOwner(owner));
      }
    } catch {
      // The business result is already committed; a failed local cleanup remains visible for later lookup.
    }
  }

  async function verifiedReceipt(commandId: string, recoveryReader?: CloudRecoveryReader): Promise<StoredEnabledCommandDoc | null> {
    const snapshot = recoveryReader
      ? await recoveryReader.readCommandReceipt(commandId)
      : await getDocFromServer(doc(db, commandPath(commandId)));
    recoveryReader?.assertCurrent();
    if (!snapshot.exists()) return null;
    let stored: StoredEnabledCommandDoc;
    try {
      stored = decodeEnabledCommandDoc(snapshot.data());
    } catch (error) {
      if (error instanceof InvalidCloudCommandInput) {
        throw new RejectCommand('UNSUPPORTED_SCHEMA', '伺服器 command receipt schema 不支援');
      }
      throw error;
    }
    if (stored.commandId !== commandId) {
      throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt commandId 與文件路徑不一致');
    }
    try {
      const normalized = normalizeEnabledCommandInput(storedInput(stored));
      const actualFingerprint = await fingerprintCommandInput(normalized);
      recoveryReader?.assertCurrent();
      if (stored.inputFingerprint !== actualFingerprint) {
        throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt semantic input 與 fingerprint 不一致');
      }
    } catch (error) {
      if (error instanceof RejectCommand) throw error;
      if (error instanceof InvalidCloudCommandInput) {
        throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt semantic input schema 不支援');
      }
      throw error;
    }
    return stored;
  }

  async function readCommand(commandId: string): Promise<CommandReceipt | null> {
    if (typeof commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
      throw new CloudCommandReadError('INVALID_INPUT', 'commandId 必須是 UUID');
    }
    try {
      const user = getCurrentUser(options);
      requireVerifiedGoogle(user);
      const stored = await verifiedReceipt(commandId);
      assertCurrentRecoveryOwner(user);
      return stored ? buildReceipt(stored) : null;
    } catch (error) {
      if (error instanceof CloudCommandReadError) throw error;
      if (error instanceof RejectCommand) throw new CloudCommandReadError(error.code, error.message);
      // null is reserved for a successful server read that confirmed absence.
      const code = mapTransactionError(error);
      throw new CloudCommandReadError(code, '無法從伺服器確認 command receipt');
    }
  }

  async function confirmPending(
    record: PendingCommandIdentity,
    expectedEpoch: number,
    recoveryReader?: CloudRecoveryReader,
  ): Promise<PendingReceiptCheck> {
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) {
      throw new CloudCommandReadError('LEASE_LOST', '目前使用權租約世代不正確');
    }
    const check = await confirmPendingCommand(record, expectedEpoch, recoveryReader);
    if (check.status === 'matched') return { status: 'matched', receipt: check.receipt };
    return check;
  }

  async function confirmPendingPage(records: readonly PendingCommandIdentity[], expectedEpoch: number): Promise<PendingReceiptCheck[]> {
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1) {
      throw new CloudCommandReadError('LEASE_LOST', '目前使用權租約世代不正確');
    }
    return (await confirmPendingBatch(records, expectedEpoch)).map(check => (
      check.status === 'matched' ? { status: 'matched', receipt: check.receipt } : check
    ));
  }

  /**
   * Read-only confirmation for a caller that still holds the original typed command.
   * It proves both receipt identity and the command's complete canonical semantics; it never writes.
   */
  function capturePendingIntent(untrustedInput: unknown, expectedEpoch: number): CapturedPendingIntent {
    try {
      const normalized = normalizeEnabledCommandInput(untrustedInput);
      if (normalized.leaseEpoch !== expectedEpoch) {
        throw new RejectCommand('LEASE_LOST', '凍結命令的使用權世代與目前頁面不符');
      }
      // Keep a detached canonical snapshot before any caller can mutate the original
      // object while recovery reads are in flight.
      return { canonical: captureCanonicalData(normalized), verificationError: null };
    } catch (error) {
      return {
        canonical: null,
        verificationError: error instanceof RejectCommand
          ? error
          : new RejectCommand('INVALID_INPUT', '原命令內容不符合正式命令格式'),
      };
    }
  }

  async function confirmCapturedPendingIntent(
    captured: CapturedPendingIntent,
    expectedEpoch: number,
    expectedDatasetId: string,
    expectedUid: string,
    recoveryReader?: CloudRecoveryReader,
  ): Promise<PendingIntentCheck> {
    if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1
      || typeof expectedDatasetId !== 'string' || expectedDatasetId.length < 1 || expectedDatasetId.length > 256
      || typeof expectedUid !== 'string' || expectedUid.length < 1 || expectedUid.length > 256) {
      throw new CloudCommandReadError('INVALID_INPUT', '待確認命令的使用權或資料集識別不正確');
    }
    const candidateUser = getCurrentUser(options);
    try {
      requireVerifiedGoogle(candidateUser);
    } catch {
      throw new CloudCommandReadError('UNAUTHORIZED', '需要目前已驗證的 Google 操作員身分');
    }
    const user = candidateUser;
    if (user.uid !== expectedUid) throw new CloudCommandReadError('LEASE_LOST', '登入身分已變更；原命令不可在新身分下確認或重試');
    try {
      const before = await readRecoveryContext(user, expectedEpoch, recoveryReader);
      const { canonical } = captured;
      let verificationError = captured.verificationError;

      let result: PendingIntentCheck | null = null;
      let inputFingerprint: string | null = null;
      if (canonical) {
        inputFingerprint = await fingerprintCommandInput(canonical);
        recoveryReader?.assertCurrent();
        assertCurrentRecoveryOwner(user);
        if (before.datasetId !== expectedDatasetId) {
          result = { status: 'different-dataset' };
        } else {
          const stored = await verifiedReceipt(canonical.commandId, recoveryReader);
          recoveryReader?.assertCurrent();
          assertCurrentRecoveryOwner(user);
          if (!stored) {
            result = { status: 'not-found' };
          } else {
            const beforeDataset = (stored.before as Data | null)?.head && ((stored.before as Data).head as Data).datasetId;
            const afterDataset = (stored.after as Data | null)?.head && ((stored.after as Data).head as Data).datasetId;
            if (stored.commandId !== canonical.commandId || stored.actor.uid !== user.uid
              || beforeDataset !== expectedDatasetId || afterDataset !== expectedDatasetId) {
              verificationError = new RejectCommand('UNSUPPORTED_SCHEMA', '伺服器 receipt 與原命令資料集或操作人不一致');
            } else {
              try {
                await assertStoredReceiptMatches(stored, canonical, inputFingerprint);
                recoveryReader?.assertCurrent();
                assertCurrentRecoveryOwner(user);
                result = { status: 'matched', receipt: buildReceipt(stored) };
              } catch (error) {
                recoveryReader?.assertCurrent();
                assertCurrentRecoveryOwner(user);
                verificationError = error instanceof RejectCommand
                  ? error
                  : new RejectCommand('UNKNOWN_RESULT', '目前無法完成原命令語意比對');
              }
            }
          }
        }
      }

      const after = await readRecoveryContext(user, expectedEpoch, recoveryReader);
      if (before.uid !== after.uid || before.datasetId !== after.datasetId || before.leaseEpoch !== after.leaseEpoch) {
        throw new RejectCommand('LEASE_LOST', '查詢期間使用權或資料集已變更');
      }
      if (verificationError) throw verificationError;
      if (!result) throw new RejectCommand('UNKNOWN_RESULT', '目前無法安全確認原命令');
      if (result.status === 'not-found' && (before.maintenance || after.maintenance)) {
        throw new RejectCommand('MAINTENANCE', '系統維護中，暫停同編號重試；請稍後重新查詢');
      }
      return result;
    } catch (error) {
      if (error instanceof CloudCommandReadError) throw error;
      if (error instanceof CloudRecoveryReaderError) throw new CloudCommandReadError(error.code, error.message);
      if (error instanceof RejectCommand) throw new CloudCommandReadError(error.code, error.message);
      if (error instanceof InvalidCloudCommandInput) throw new CloudCommandReadError('INVALID_INPUT', '原命令內容不符合正式命令格式');
      throw new CloudCommandReadError(mapTransactionError(error), '目前無法安全確認原命令');
    }
  }

  async function confirmPendingIntent(
    untrustedInput: unknown,
    expectedEpoch: number,
    expectedDatasetId: string,
    expectedUid: string,
    recoveryReader?: CloudRecoveryReader,
  ): Promise<PendingIntentCheck> {
    const captured = capturePendingIntent(untrustedInput, expectedEpoch);
    return confirmCapturedPendingIntent(captured, expectedEpoch, expectedDatasetId, expectedUid, recoveryReader);
  }

  async function cleanupConfirmedIntent(
    untrustedInput: unknown,
    expectedEpoch: number,
    expectedDatasetId: string,
    expectedUid: string,
    recoveryReader: CloudRecoveryReader | undefined,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    const captured = capturePendingIntent(untrustedInput, expectedEpoch);
    const record: PendingCommandIdentity | null = captured.canonical ? {
      commandId: captured.canonical.commandId,
      datasetId: expectedDatasetId,
      uid: expectedUid,
    } : null;
    const check = await confirmCapturedPendingIntent(
      captured,
      expectedEpoch,
      expectedDatasetId,
      expectedUid,
      recoveryReader,
    );
    if (check.status !== 'matched' || !record) return false;
    const owner = getCurrentUser(options);
    requireVerifiedGoogle(owner);
    if (owner.uid !== expectedUid) throw new CloudCommandReadError('LEASE_LOST', '登入身分已變更，不能清除原命令追蹤');
    // The receipt and both server contexts were verified before entering removeIfPresent.
    // Its lock callback is intentionally synchronous and contains no network work.
    // `true` is a post-condition, not a claim about who removed the entry: the confirmed identity is no longer
    // tracked (removed now, or already removed by the commit path). Only a kept entry is `false`.
    const outcome = await pendingJournal.removeIfPresent(record, () => {
      try {
        recoveryReader?.assertCurrent();
        assertCurrentRecoveryOwner(owner);
        return isCurrent() === true;
      } catch {
        return false;
      }
    });
    return outcome !== 'kept';
  }

  async function getPendingRecoveryContext(expectedEpoch: number, recoveryReader?: CloudRecoveryReader): Promise<RecoveryContext> {
    const user = getCurrentUser(options);
    try {
      requireVerifiedGoogle(user);
    } catch {
      throw new CloudCommandReadError('UNAUTHORIZED', '需要目前已驗證的 Google 操作員身分');
    }
    try {
      recoveryReader?.assertCurrent();
      return await readRecoveryContext(user, expectedEpoch, recoveryReader);
    } catch (error) {
      if (error instanceof RejectCommand) throw new CloudCommandReadError(error.code, error.message);
      if (error instanceof CloudRecoveryReaderError) throw new CloudCommandReadError(error.code, error.message);
      throw new CloudCommandReadError(mapTransactionError(error), '目前無法確認資料集與使用權');
    }
  }

  async function commitCommand(untrustedInput: unknown): Promise<CommandResult> {
    let identity: CommandDiagnosticIdentity = { commandId: null, kind: null };
    const flight = { release: undefined as (() => void) | undefined };
    try {
      const result = await commitCommandInternal(
        untrustedInput,
        observed => { identity = observed; },
        release => { flight.release = release; },
      );
      if (!result.ok) {
        try {
          appendCommandDiagnostic({ ...identity, errorCode: result.error.code });
        } catch {
          // Local diagnostics are best effort and cannot change a command result.
        }
      }
      return result;
    } catch (error) {
      try {
        appendCommandDiagnostic({ ...identity, errorCode: 'UNKNOWN_RESULT' });
      } catch {
        // Local diagnostics are best effort and cannot change a command outcome.
      }
      throw error;
    } finally {
      flight.release?.();
    }
  }

  async function commitCommandInternal(
    untrustedInput: unknown,
    onDiagnosticIdentity: (identity: CommandDiagnosticIdentity) => void,
    onInFlight: (release: () => void) => void,
  ): Promise<CommandResult> {
    let input: CanonicalEnabledInput;
    let user: CurrentUser;
    let fingerprint: string;
    try {
      input = normalizeEnabledCommandInput(untrustedInput, onDiagnosticIdentity);
      try {
        // Successful normalization establishes the identity used by fingerprinting and the receipt path.
        onDiagnosticIdentity({ commandId: input.commandId, kind: input.kind });
      } catch {
        // Diagnostic observation is optional and must not change command normalization.
      }
      const candidateUser = getCurrentUser(options);
      requireVerifiedGoogle(candidateUser);
      user = candidateUser;
      fingerprint = await fingerprintCommandInput(input);
    } catch (error) {
      if (error instanceof RejectCommand) return errorResult(error.code, error.message);
      if (error instanceof Error && error.name === 'InvalidCloudCommandInput') return errorResult('INVALID_INPUT', error.message);
      return errorResult('UNSUPPORTED_SCHEMA', error instanceof Error ? error.message : '無法驗證命令內容');
    }

    let preflight: RecoveryContext;
    try {
      preflight = await readRecoveryContext(user, input.leaseEpoch);
      if (preflight.maintenance) throw new RejectCommand('MAINTENANCE', '系統正在維護，暫停新命令');
    } catch (error) {
      if (error instanceof RejectCommand) return errorResult(error.code, error.message);
      return errorResult(mapTransactionError(error), '無法從伺服器確認目前操作員、資料集與使用權');
    }

    const pendingIdentity: PendingCommandIdentity = {
      commandId: input.commandId,
      datasetId: preflight.datasetId,
      uid: user.uid,
    };
    const release = pendingJournal.registerInFlight(pendingIdentity, input.leaseEpoch);
    onInFlight(release);
    try {
      await pendingJournal.put(pendingIdentity);
    } catch (error) {
      if (error instanceof PendingJournalUnavailableError) {
        return errorResult('LOCAL_STORAGE_UNAVAILABLE', LOCAL_STORAGE_UNAVAILABLE_MESSAGE);
      }
      return errorResult('LOCAL_STORAGE_UNAVAILABLE', LOCAL_STORAGE_UNAVAILABLE_MESSAGE);
    }

    const commandRef = doc(db, commandPath(input.commandId));
    const headRef = doc(db, dataHeadPath());
    const leaseRef = doc(db, accessLeasePath());
    const operatorRef = doc(db, `operators/${user.uid}`);
    const mutation = isTransactionMutationKind(input.kind) ? input as Extract<CanonicalEnabledInput, { kind: TransactionMutationKind }> : null;
    const hasDayTarget = input.kind === 'EnsureDay' || input.kind === 'CreateOrder' || input.kind === 'CreatePayment'
      || input.kind === 'CreateCashMovement' || input.kind === 'CreateRefund' || input.kind === 'SetDayMenu' || input.kind === 'SetOpeningCash'
      || mutation !== null || input.kind === 'CorrectOpening' || input.kind === 'CloseDay' || input.kind === 'ReopenDay'
      || input.kind === 'BackfillOpeningCash' || input.kind === 'StartBackfill' || input.kind === 'RecordPostCloseEntry';
    const targetDayId = input.kind === 'EnsureDay' ? input.targets.dayId
      : input.kind === 'CreateOrder' || input.kind === 'CreatePayment' || input.kind === 'CreateCashMovement'
        || input.kind === 'CreateRefund' || input.kind === 'SetDayMenu' || input.kind === 'SetOpeningCash'
        || input.kind === 'CorrectOpening' || input.kind === 'CloseDay' || input.kind === 'ReopenDay'
        || input.kind === 'BackfillOpeningCash' || input.kind === 'StartBackfill' || input.kind === 'RecordPostCloseEntry'
        ? input.targets.dayId : mutation ? mutation.targets.dayId : null;
    const dayRef = targetDayId ? doc(db, dayPath(targetDayId)) : null;
    const targetStudentId = input.kind === 'CreateStudent' || input.kind === 'ChangeStudentCode' || input.kind === 'EditStudent' || input.kind === 'SetStudentStatus'
      || input.kind === 'CreateOrder' || input.kind === 'CreatePayment' || input.kind === 'CreateRefund'
      || input.kind === 'CorrectOpening' ? input.targets.studentId
      : mutation && mutation.targets.studentId !== CASHIER_STUDENT_ID ? mutation.targets.studentId : null;
    const targetStudentRef = targetStudentId ? doc(db, studentPath(targetStudentId)) : null;
    const targetVendorId = input.kind === 'SaveVendor' || input.kind === 'RemoveVendor' ? input.targets.vendorId
      : input.kind === 'SetDayMenu' ? input.payload.vendorId : null;
    const targetVendorRef = targetVendorId ? doc(db, vendorPath(targetVendorId)) : null;
    const sourceDayRef = input.kind === 'SetDayMenu' && input.payload.inheritedFromDate
      ? doc(db, dayPath(input.payload.inheritedFromDate)) : null;
    const targetTransactionRef = input.kind === 'CreateOrder' || input.kind === 'CreatePayment' || input.kind === 'CreateCashMovement'
      || input.kind === 'CreateRefund'
      ? doc(db, transactionPath(input.targets.transactionId))
      : mutation ? doc(db, transactionPath(mutation.targets.transactionId)) : null;

    try {
      const currentUser = getCurrentUser(options);
      requireVerifiedGoogle(currentUser);
      if (currentUser.uid !== user.uid) throw new RejectCommand('LEASE_LOST', '登入身分已變更，命令尚未送出');
      const transactionOutcome = await runTransaction(db, async tx => {
        // Complete every read before the first write. These server transaction reads never use cache.
        const commandSnapshot = await tx.get(commandRef);
        const headSnapshot = await tx.get(headRef);
        const operatorSnapshot = await tx.get(operatorRef);
        const leaseSnapshot = await tx.get(leaseRef);

        if (!operatorSnapshot.exists()) throw new RejectCommand('UNAUTHORIZED', '操作員文件不存在');
        checkOperator(operatorSnapshot.data(), user);
        if (!leaseSnapshot.exists()) throw new RejectCommand('LEASE_LOST', '使用權租約不存在');
        checkLease(leaseSnapshot.data(), input, user);
        if (!headSnapshot.exists()) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'dataHead 尚未由維護者初始化');
        const headBefore = decodeHead(headSnapshot.data());
        const transactionUser = getCurrentUser(options);
        requireVerifiedGoogle(transactionUser);
        if (transactionUser.uid !== user.uid) throw new RejectCommand('LEASE_LOST', '登入身分已變更，命令尚未送出');
        if (headBefore.datasetId !== preflight.datasetId) throw new RejectCommand('MAINTENANCE', '資料集已變更，請重新載入並確認待核對清單');
        if (headBefore.maintenance) throw new RejectCommand('MAINTENANCE', '系統正在維護，暫停新命令');

        if (commandSnapshot.exists()) {
          const stored = decodeEnabledCommandDoc(commandSnapshot.data());
          if (stored.commandId !== input.commandId) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt commandId 與文件路徑不一致');
          // Historical actor/lease epoch do not authorize a new read; the current operator/lease above does.
          await assertStoredReceiptMatches(stored, input, fingerprint);
          return { existing: stored } as const;
        }

        const daySnapshot = dayRef ? await tx.get(dayRef) : null;
        const vendorSnapshot = targetVendorRef ? await tx.get(targetVendorRef) : null;
        const sourceDaySnapshot = sourceDayRef ? await tx.get(sourceDayRef) : null;
        let studentBefore: Data | null = null;
        let transactionExists = false;
        let transactionData: unknown = null;
        if (targetStudentRef && targetStudentId) {
          const studentSnapshot = await tx.get(targetStudentRef);
          if (input.kind === 'CreateStudent') {
            if (studentSnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '學生 ID 已存在');
          } else {
            if (!studentSnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '目標學生不存在');
            studentBefore = decodeStudent(studentSnapshot.data());
            if (studentBefore.studentId !== targetStudentId) throw new RejectCommand('UNSUPPORTED_SCHEMA', '學生文件 ID 與路徑不一致');
          }
        }
        if (targetTransactionRef) {
          const transactionSnapshot = await tx.get(targetTransactionRef);
          transactionExists = transactionSnapshot.exists();
          transactionData = transactionExists ? transactionSnapshot.data() : null;
        }

        const codeIndexRef = input.kind === 'CreateStudent'
          ? doc(db, studentCodePath(input.payload.studentCode))
          : null;
        if (codeIndexRef) {
          const codeIndexSnapshot = await tx.get(codeIndexRef);
          if (codeIndexSnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '該學生編號已被使用');
        }

        let oldIndexRef: ReturnType<typeof doc> | null = null;
        let newIndexRef: ReturnType<typeof doc> | null = null;
        if (input.kind === 'ChangeStudentCode') {
          if (!studentBefore) throw new RejectCommand('INVALID_INPUT', '目標學生不存在');
          const oldCode = String(studentBefore.studentCode);
          const newCode = input.payload.studentCode;
          if (oldCode === newCode) throw new RejectCommand('INVALID_INPUT', '新舊編號相同，無需變更');
          oldIndexRef = doc(db, studentCodePath(oldCode));
          newIndexRef = doc(db, studentCodePath(newCode));
          const oldIndexSnapshot = await tx.get(oldIndexRef);
          const newIndexSnapshot = await tx.get(newIndexRef);
          if (!oldIndexSnapshot.exists() || oldIndexSnapshot.data()?.studentId !== targetStudentId) {
            throw new RejectCommand('UNSUPPORTED_SCHEMA', '舊編號索引不存在或指向不正確');
          }
          if (newIndexSnapshot.exists()) {
            throw new RejectCommand('INVALID_INPUT', '目標編號已被使用');
          }
        }

        const seq = Number(headBefore.seq) + 1;
        const now = serverTimestamp();
        const headAfter: Data = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: now };
        const zeroCash = { before: 0, after: 0, delta: 0, reasonKind: 'none' as const, refundAmount: 0 };

        if (input.kind === 'CorrectOpening') {
          if (!daySnapshot?.exists() || !dayRef || !studentBefore || !targetStudentRef) {
            throw new RejectCommand('INVALID_INPUT', '期初日的營業日或學生不存在');
          }
          const { dayId } = input.targets;
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(studentBefore.revision, input.expectedRevisions.student, '學生版本');
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          const openingBefore = studentBefore.openingBalance as Data;
          if (openingBefore.asOfDate !== dayId) throw new RejectCommand('INVALID_INPUT', '期初日期不能更改');
          if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '期初日已關帳，請先重開該日再更正期初');
          const openingAfter: Data = { ...openingBefore, amount: input.payload.amount, note: input.payload.note };
          if (openingAfter.amount === openingBefore.amount && openingAfter.note === openingBefore.note) {
            throw new RejectCommand('INVALID_INPUT', '期初金額與備註都沒有變更');
          }
          const nextBalance = Number(studentBefore.currentBalance) - Number(openingBefore.amount) + input.payload.amount;
          if (!Number.isSafeInteger(nextBalance) || Math.abs(nextBalance) > 1_000_000_000) {
            throw new RejectCommand('INVALID_INPUT', '更正後餘額超出允許範圍');
          }
          const studentAfter: Data = {
            ...studentBefore,
            openingBalance: openingAfter,
            currentBalance: nextBalance,
            revision: Number(studentBefore.revision) + 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const dayAfter: Data = {
            ...dayBefore,
            revision: Number(dayBefore.revision) + 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const stored = {
            commandId: input.commandId, kind: 'CorrectOpening', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: dayId, studentId: input.targets.studentId,
            targets: input.targets, expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, student: studentBefore, day: dayBefore },
            after: { head: headAfter, student: studentAfter, day: dayAfter },
            reason: input.payload.reason, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          tx.update(targetStudentRef, studentAfter);
          tx.update(dayRef, dayAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'CloseDay' || input.kind === 'ReopenDay') {
          if (!daySnapshot?.exists() || !dayRef) throw new RejectCommand('INVALID_INPUT', '營業日不存在');
          const { dayId, settlementRevision } = input.targets;
          const close = input.kind === 'CloseDay';
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          checkRevision(dayBefore.lastSettlementRevision, input.expectedRevisions.settlement, '日結版本');
          if (dayId > taipeiCalendarDate(Timestamp.now())) throw new RejectCommand('INVALID_INPUT', '未來日期不能關帳或重開');
          if (close && dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '這個營業日已關帳');
          if (!close && dayBefore.status !== 'closed') throw new RejectCommand('INVALID_INPUT', '只有已關帳的營業日可以重開');
          if (close && dayBefore.openingCash === null) throw new RejectCommand('INVALID_INPUT', '尚未確認開帳現金，不能關帳');
          const expectedCash = settlementExpectedCash(dayBefore);
          if (close && (input.payload as { expectedCash: number }).expectedCash !== expectedCash) {
            throw new RejectCommand('REVISION_CONFLICT', '應有現金已變更，請重新載入後再關帳');
          }
          if (close) {
            // P11c3: a back-filled day (marker present) closes with no difference and aligned to the next opened
            // day's opening cash; an ordinary day carries no `alignWithDayId`. Reading both here makes the client
            // transaction fail on a concurrent change; Rules re-check the same facts at commit.
            const closeValues = input.payload as { countedCash: number; alignWithDayId?: string | null };
            const marked = (await tx.get(doc(db, backfillDayPath(dayId)))).exists();
            const aligned = Object.hasOwn(closeValues, 'alignWithDayId');
            if (marked && !aligned) throw new RejectCommand('INVALID_INPUT', '回填日關帳必須指定對齊日（alignWithDayId）');
            if (!marked && aligned) throw new RejectCommand('INVALID_INPUT', '這個營業日沒有回填標記，不能帶對齊日');
            if (marked && closeValues.countedCash !== expectedCash) {
              throw new RejectCommand('INVALID_INPUT', `回填日關帳不得有差額（應有現金 ${expectedCash} 元）`);
            }
            if (typeof closeValues.alignWithDayId === 'string') {
              const alignSnapshot = await tx.get(doc(db, dayPath(closeValues.alignWithDayId)));
              if (!alignSnapshot.exists()) throw new RejectCommand('INVALID_INPUT', `對齊日 ${closeValues.alignWithDayId} 不存在`);
              const alignOpening = decodeDay(alignSnapshot.data()).openingCash;
              if (alignOpening === null) throw new RejectCommand('INVALID_INPUT', `對齊日 ${closeValues.alignWithDayId} 尚未確認開帳現金`);
              if (alignOpening !== closeValues.countedCash) {
                throw new RejectCommand('INVALID_INPUT', `實點 ${closeValues.countedCash} 元須等於 ${closeValues.alignWithDayId} 的開帳現金 ${alignOpening} 元`);
              }
            }
          }
          const previousRef = settlementRevision > 1 ? doc(db, settlementPath(dayId, settlementRevision - 1)) : null;
          const nextRef = doc(db, settlementPath(dayId, settlementRevision));
          const previousSnapshot = previousRef ? await tx.get(previousRef) : null;
          const nextSnapshot = await tx.get(nextRef);
          if (nextSnapshot.exists()) throw new RejectCommand('UNSUPPORTED_SCHEMA', '日結版本已存在，但營業日指標未指向它');
          let previousSettlement: Data | null = null;
          if (previousSnapshot) {
            if (!previousSnapshot.exists()) throw new RejectCommand('UNSUPPORTED_SCHEMA', '前一版日結不存在');
            try {
              previousSettlement = decodeSettlementDoc(previousSnapshot.data(), dayId, settlementRevision - 1);
            } catch {
              throw new RejectCommand('UNSUPPORTED_SCHEMA', '前一版日結 schema 不支援');
            }
          }
          const dayAfter: Data = {
            ...dayBefore,
            status: close ? 'closed' : 'reopened',
            lastSettlementRevision: settlementRevision,
            revision: Number(dayBefore.revision) + 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const closePayload = close ? input.payload as { countedCash: number; note: string } : null;
          const settlement: Data = {
            dayId, revision: settlementRevision, status: close ? 'closed' : 'reopened',
            totals: dayBefore.totals, openingCash: dayBefore.openingCash, expectedCash,
            countedCash: closePayload ? closePayload.countedCash : null,
            difference: closePayload ? closePayload.countedCash - expectedCash : null,
            note: closePayload ? closePayload.note : (input.payload as { reason: string }).reason,
            actorUid: user.uid, actorEmail: user.email!, sourceSeq: seq, committedAt: now,
            previousRevision: settlementRevision - 1, lastCommandId: input.commandId,
          };
          const stored = {
            commandId: input.commandId, kind: input.kind, seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: dayId, studentId: null,
            targets: input.targets, expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: dayBefore, previousSettlement },
            after: { head: headAfter, day: dayAfter, settlement },
            reason: close ? null : (input.payload as { reason: string }).reason,
            cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          tx.update(dayRef, dayAfter);
          tx.set(nextRef, settlement);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'BackfillOpeningCash') {
          if (!daySnapshot?.exists() || !dayRef) throw new RejectCommand('INVALID_INPUT', '營業日不存在');
          const { dayId } = input.targets;
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '已關帳的營業日不能補開帳');
          requireDateAfterGoLive(dayId, String(headBefore.goLiveDate));
          const today = taipeiCalendarDate((leaseSnapshot.data() as Data).updatedAt as Timestamp);
          if (dayId >= today) throw new RejectCommand('INVALID_INPUT', '只有今天以前的營業日可以補開帳；今天請直接確認開帳現金');
          if (dayBefore.openingCash !== null) throw new RejectCommand('INVALID_INPUT', '這個營業日已確認開帳現金，不需補開帳');
          const payload = input.payload as { openingCash: number; reason: string };
          const dayAfter: Data = {
            ...dayBefore, openingCash: payload.openingCash, openedBy: user.uid, openedAt: now,
            revision: Number(dayBefore.revision) + 1, lastCommandId: input.commandId, updatedAt: now,
          };
          const stored = {
            commandId: input.commandId, kind: 'BackfillOpeningCash', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: dayId, studentId: null, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: dayBefore }, after: { head: headAfter, day: dayAfter },
            reason: payload.reason, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          tx.update(dayRef, dayAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'StartBackfill') {
          if (!daySnapshot?.exists() || !dayRef) throw new RejectCommand('INVALID_INPUT', '營業日不存在');
          const { dayId } = input.targets;
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          if (dayBefore.status === 'closed' || dayBefore.lastSettlementRevision !== 0) {
            throw new RejectCommand('DAY_CLOSED', '關過帳的營業日不能用回填修改');
          }
          requireDateAfterGoLive(dayId, String(headBefore.goLiveDate));
          const today = taipeiCalendarDate((leaseSnapshot.data() as Data).updatedAt as Timestamp);
          if (dayId >= today) throw new RejectCommand('INVALID_INPUT', '只有今天以前的營業日可以回填；今天請直接登錄');
          const markerRef = doc(db, backfillDayPath(dayId));
          if ((await tx.get(markerRef)).exists()) throw new RejectCommand('INVALID_INPUT', '這個營業日已經在回填中');
          const payload = input.payload as { reason: string };
          const marker: Data = {
            dayId, reason: payload.reason, startedBy: user.uid, startedAt: now, commandId: input.commandId,
          };
          const stored = {
            commandId: input.commandId, kind: 'StartBackfill', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: dayId, studentId: null, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: dayBefore, backfill: null },
            after: { head: headAfter, day: dayBefore, backfill: marker },
            reason: payload.reason, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          tx.set(markerRef, marker);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'RecordPostCloseEntry') {
          if (!daySnapshot?.exists() || !dayRef) throw new RejectCommand('INVALID_INPUT', '營業日不存在');
          const { dayId } = input.targets;
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          checkRevision(Number(dayBefore.lastSettlementRevision), input.expectedRevisions.settlement, '日結版本');
          if (dayBefore.status !== 'closed') {
            throw new RejectCommand('INVALID_INPUT', '只有已關帳的營業日可以補記；還沒關帳或重開中的日子請直接登錄');
          }
          requireDateAfterGoLive(dayId, String(headBefore.goLiveDate));
          const payload = input.payload as { direction: 'income' | 'expense'; amount: number; reason: string };
          const entryRef = doc(db, postCloseEntryPath(input.commandId));
          if ((await tx.get(entryRef)).exists()) throw new RejectCommand('INVALID_INPUT', '這筆補記已存在');
          const entry: Data = {
            entryId: input.commandId, dayId, settlementRevision: Number(dayBefore.lastSettlementRevision),
            direction: payload.direction, amount: payload.amount, reason: payload.reason,
            createdBy: user.uid, createdAt: now, commandId: input.commandId,
          };
          const stored = {
            commandId: input.commandId, kind: 'RecordPostCloseEntry', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: dayId, studentId: null, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: dayBefore, postCloseEntry: null },
            after: { head: headAfter, day: dayBefore, postCloseEntry: entry },
            reason: payload.reason, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          tx.set(entryRef, entry);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'RecordBackup') {
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'RecordBackup', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: null, studentId: null, targets: {}, expectedRevisions: {},
            before: { head: headBefore }, after: { head: headAfter }, reason: null,
            cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'RecordExport' || input.kind === 'RecordPrint') {
          if (input.payload.sourceSeq > Number(headBefore.seq)) {
            throw new RejectCommand('INVALID_INPUT', 'sourceSeq 不得晚於目前資料快照');
          }
          const businessDate = input.kind === 'RecordPrint' ? input.payload.businessDate : null;
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: input.kind, seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate, studentId: input.payload.scope.studentId, targets: {}, expectedRevisions: {},
            before: { head: headBefore }, after: { head: headAfter }, reason: null,
            cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'EnsureDay') {
          if (!daySnapshot) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'EnsureDay 缺少目標日期參照');
          if (daySnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '該營業日已存在；不會重設或重開日期');
          const businessDate = input.payload.businessDate;
          requireDateAfterGoLive(businessDate, String(headBefore.goLiveDate));
          const dayAfter: Data = {
            status: 'open', revision: 1, menu: null, openingCash: null, openedBy: null, openedAt: null,
            totals: { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 },
            lastSettlementRevision: 0, lastCommandId: input.commandId, updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: input.kind, seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: null },
            after: { head: headAfter, day: dayAfter },
            reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.set(dayRef!, dayAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'SaveVendor' || input.kind === 'RemoveVendor') {
          if (!targetVendorRef || !vendorSnapshot) throw new RejectCommand('UNSUPPORTED_SCHEMA', '供應商命令缺少 target 參照');
          const vendorId = input.targets.vendorId;
          const expectedRevision = input.expectedRevisions.vendor;
          const vendorBefore = vendorSnapshot.exists() ? decodeVendor(vendorSnapshot.data()) : null;
          if (vendorBefore && vendorBefore.vendorId !== vendorId) {
            throw new RejectCommand('UNSUPPORTED_SCHEMA', '供應商文件 ID 與路徑不一致');
          }
          checkRevision(vendorBefore?.revision ?? 0, expectedRevision, '供應商版本');

          if (input.kind === 'SaveVendor') {
            const payload = input.payload;
            if (expectedRevision === 0) {
              if (vendorBefore) throw new RejectCommand('INVALID_INPUT', '供應商 ID 已存在或曾使用；不得重用');
              const vendorAfter: Data = {
                vendorId, name: payload.name, phone: payload.phone, note: payload.note,
                status: 'active', deleted: false, createdAt: now, revision: 1,
                lastCommandId: input.commandId, updatedAt: now,
              };
              const stored: StoredEnabledCommandDoc = {
                commandId: input.commandId, kind: 'SaveVendor', seq, leaseEpoch: input.leaseEpoch,
                actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
                businessDate: null, studentId: null, targets: input.targets,
                expectedRevisions: input.expectedRevisions,
                before: { head: headBefore, vendor: null }, after: { head: headAfter, vendor: vendorAfter },
                reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
              };
              tx.set(targetVendorRef, vendorAfter);
              tx.update(headRef, headAfter);
              tx.set(commandRef, stored);
              return { existing: null } as const;
            }
            if (!vendorBefore || vendorBefore.deleted) throw new RejectCommand('INVALID_INPUT', '供應商不存在或已刪除');
            const vendorAfter: Data = {
              ...vendorBefore, name: payload.name, phone: payload.phone, note: payload.note,
              status: payload.status, deleted: false, revision: expectedRevision + 1,
              lastCommandId: input.commandId, updatedAt: now,
            };
            const stored: StoredEnabledCommandDoc = {
              commandId: input.commandId, kind: 'SaveVendor', seq, leaseEpoch: input.leaseEpoch,
              actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
              businessDate: null, studentId: null, targets: input.targets,
              expectedRevisions: input.expectedRevisions,
              before: { head: headBefore, vendor: vendorBefore }, after: { head: headAfter, vendor: vendorAfter },
              reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
            };
            tx.update(targetVendorRef, vendorAfter);
            tx.update(headRef, headAfter);
            tx.set(commandRef, stored);
            return { existing: null } as const;
          }

          if (!vendorBefore || vendorBefore.deleted || vendorBefore.status !== 'inactive') {
            throw new RejectCommand('INVALID_INPUT', '只有未刪除的停用供應商可以封存');
          }
          const vendorAfter: Data = {
            ...vendorBefore, deleted: true, revision: expectedRevision + 1,
            lastCommandId: input.commandId, updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'RemoveVendor', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: null, studentId: null, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, vendor: vendorBefore }, after: { head: headAfter, vendor: vendorAfter },
            reason: input.payload.reason, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.update(targetVendorRef, vendorAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'SetDayMenu' || input.kind === 'SetOpeningCash') {
          if (!dayRef || !daySnapshot?.exists()) throw new RejectCommand('INVALID_INPUT', '營業日不存在；請先建立空白日期');
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '已關帳的營業日不能修改');
          requireDateAfterGoLive(input.targets.dayId, String(headBefore.goLiveDate));

          if (input.kind === 'SetDayMenu') {
            const payload = input.payload;
            if (input.expectedRevisions.headSeq !== headBefore.seq) {
              throw new RejectCommand('REVISION_CONFLICT', '讀取菜單來源後雲端資料已變更，請重新載入');
            }
            if (taipeiCalendarDate((leaseSnapshot.data() as Data).updatedAt as Timestamp) !== payload.selectionDate) {
              throw new RejectCommand('REVISION_CONFLICT', '伺服器租約日期已變更，請重新載入後再儲存菜單');
            }
            if (!vendorSnapshot?.exists()) throw new RejectCommand('INVALID_INPUT', '菜單供應商不存在');
            const vendor = decodeVendor(vendorSnapshot.data());
            if (vendor.vendorId !== payload.vendorId || vendor.deleted || vendor.status !== 'active'
              || vendor.name !== payload.vendorNameSnapshot) {
              throw new RejectCommand('INVALID_INPUT', '菜單供應商已停用、刪除或名稱已變更；請重新確認');
            }
            if (payload.inheritedFromDate !== null) {
              if (payload.inheritedFromDate >= input.targets.dayId || payload.inheritedFromDate > payload.selectionDate
                || !sourceDaySnapshot?.exists()) {
                throw new RejectCommand('INVALID_INPUT', '繼承來源日期或文件不合法');
              }
              const source = decodeDay(sourceDaySnapshot.data());
              const sourceMenu = source.menu as Data | null;
              if (!sourceMenu || sourceMenu.businessDate !== payload.inheritedFromDate
                || sourceMenu.itemName !== payload.itemName || sourceMenu.price !== payload.price
                || sourceMenu.vendorId !== payload.vendorId
                || sourceMenu.vendorNameSnapshot !== payload.vendorNameSnapshot
                || vendor.name !== sourceMenu.vendorNameSnapshot) {
                throw new RejectCommand('INVALID_INPUT', '最近來源菜單或供應商已變更；請重新載入或直接確認新菜單');
              }
            } else if (sourceDaySnapshot) {
              throw new RejectCommand('UNSUPPORTED_SCHEMA', '直接菜單命令不應帶繼承來源參照');
            }
            const previousMenu = dayBefore.menu as Data | null;
            const menuAfter: Data = {
              businessDate: input.targets.dayId, itemName: payload.itemName, price: payload.price,
              vendorId: payload.vendorId, vendorNameSnapshot: payload.vendorNameSnapshot,
              updatedAt: now, revision: previousMenu ? Number(previousMenu.revision) + 1 : 1,
              inheritedFromDate: payload.inheritedFromDate,
            };
            const dayAfter: Data = {
              ...dayBefore, menu: menuAfter, revision: Number(dayBefore.revision) + 1,
              lastCommandId: input.commandId, updatedAt: now,
            };
            const stored: StoredEnabledCommandDoc = {
              commandId: input.commandId, kind: 'SetDayMenu', seq, leaseEpoch: input.leaseEpoch,
              actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
              businessDate: input.targets.dayId, studentId: null, targets: input.targets,
              expectedRevisions: input.expectedRevisions,
              before: { head: headBefore, day: dayBefore }, after: { head: headAfter, day: dayAfter },
              reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
            };
            tx.update(dayRef, dayAfter);
            tx.update(headRef, headAfter);
            tx.set(commandRef, stored);
            return { existing: null } as const;
          }

          const payload = input.payload;
          const today = taipeiCalendarDate((leaseSnapshot.data() as Data).updatedAt as Timestamp);
          if (input.targets.dayId !== today) throw new RejectCommand('INVALID_INPUT', '開帳現金只可設定伺服器台北今日');
          const wasUnconfirmed = dayBefore.openingCash === null;
          const dayAfter: Data = {
            ...dayBefore, openingCash: payload.openingCash,
            openedBy: wasUnconfirmed ? user.uid : dayBefore.openedBy,
            openedAt: wasUnconfirmed ? now : dayBefore.openedAt,
            revision: Number(dayBefore.revision) + 1, lastCommandId: input.commandId, updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'SetOpeningCash', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: input.targets.dayId, studentId: null, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: dayBefore }, after: { head: headAfter, day: dayAfter },
            reason: payload.reason ?? null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.update(dayRef, dayAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'CreateStudent') {
          if (!targetStudentRef || !codeIndexRef || studentBefore !== null || !daySnapshot && hasDayTarget) {
            throw new RejectCommand('INVALID_INPUT', '建立學生命令目標不合法');
          }
          const opening = input.payload.openingBalance;
          const studentAfter: Data = {
            studentId: input.targets.studentId,
            studentCode: input.payload.studentCode,
            displayName: input.payload.displayName,
            aliases: input.payload.aliases,
            status: 'active',
            openingBalance: { ...opening, createdAt: now },
            currentBalance: opening.amount,
            createdAt: now,
            revision: 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const codeIndexAfter: Data = {
            studentId: input.targets.studentId,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'CreateStudent', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: null, studentId: input.targets.studentId, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, student: null }, after: { head: headAfter, student: studentAfter },
            reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.set(targetStudentRef, studentAfter);
          tx.set(codeIndexRef, codeIndexAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'ChangeStudentCode') {
          if (!targetStudentRef || !studentBefore || !oldIndexRef || !newIndexRef) {
            throw new RejectCommand('INVALID_INPUT', '目標學生不存在');
          }
          checkRevision(studentBefore.revision, input.expectedRevisions.student, '學生版本');
          const studentAfter: Data = {
            ...studentBefore,
            studentCode: input.payload.studentCode,
            revision: Number(studentBefore.revision) + 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const newIndexAfter: Data = {
            studentId: input.targets.studentId,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'ChangeStudentCode', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: null, studentId: input.targets.studentId, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, student: studentBefore }, after: { head: headAfter, student: studentAfter },
            reason: input.payload.reason, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.update(targetStudentRef, studentAfter);
          tx.set(newIndexRef, newIndexAfter);
          tx.delete(oldIndexRef);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'EditStudent' || input.kind === 'SetStudentStatus') {
          if (!targetStudentRef || !studentBefore) throw new RejectCommand('INVALID_INPUT', '目標學生不存在');
          checkRevision(studentBefore.revision, input.expectedRevisions.student, '學生版本');
          let reason: string | null = null;
          let studentAfter: Data;
          if (input.kind === 'EditStudent') {
            const nextDisplayName = input.payload.displayName ?? String(studentBefore.displayName);
            const nextAliases = input.payload.aliases ?? studentBefore.aliases;
            if (nextDisplayName === studentBefore.displayName && sameStringList(nextAliases, studentBefore.aliases)) {
              throw new RejectCommand('INVALID_INPUT', '學生資料沒有變更');
            }
            studentAfter = {
              ...studentBefore,
              displayName: nextDisplayName,
              aliases: nextAliases,
              revision: Number(studentBefore.revision) + 1,
              lastCommandId: input.commandId,
              updatedAt: now,
            };
          } else {
            if (input.payload.status === studentBefore.status) {
              throw new RejectCommand('INVALID_INPUT', '學生狀態沒有變更');
            }
            reason = input.payload.reason;
            studentAfter = {
              ...studentBefore,
              status: input.payload.status,
              revision: Number(studentBefore.revision) + 1,
              lastCommandId: input.commandId,
              updatedAt: now,
            };
          }
          const storedCommon = {
            commandId: input.commandId, kind: input.kind, seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: null, studentId: input.targets.studentId, targets: input.targets,
            expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, student: studentBefore }, after: { head: headAfter, student: studentAfter },
            reason, cashEffect: zeroCash, inputFingerprint: fingerprint,
          };
          const stored: StoredEnabledCommandDoc = input.kind === 'EditStudent'
            ? { ...storedCommon, kind: 'EditStudent', payload: input.payload }
            : { ...storedCommon, kind: 'SetStudentStatus', payload: input.payload };
          tx.update(targetStudentRef, studentAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'CreateCashMovement') {
          if (!daySnapshot?.exists() || !targetTransactionRef || !dayRef) {
            throw new RejectCommand('INVALID_INPUT', '櫃台收支需要已存在的營業日');
          }
          if (transactionExists) throw new RejectCommand('INVALID_INPUT', 'transactionId 已存在');
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '該日已關帳');
          requireDateAfterGoLive(input.targets.dayId, String(headBefore.goLiveDate));
          const { mealPrice, paidAmount, reason } = input.payload;
          const totalsBefore = dayBefore.totals as Data;
          const totalsAfter = {
            ...totalsBefore,
            activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
            cashierIncome: Number(totalsBefore.cashierIncome) + paidAmount,
            cashierExpense: Number(totalsBefore.cashierExpense) + mealPrice,
          };
          if (Object.values(totalsAfter).some(value => !Number.isSafeInteger(value) || Math.abs(value as number) > 1_000_000_000)) {
            throw new RejectCommand('INVALID_INPUT', '營業日合計超出允許範圍');
          }
          const dayAfter: Data = {
            ...dayBefore,
            revision: Number(dayBefore.revision) + 1,
            totals: totalsAfter,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const transactionAfter: Data = {
            transactionId: input.targets.transactionId,
            studentId: CASHIER_STUDENT_ID,
            businessDate: input.targets.dayId,
            type: 'expense',
            mealKind: null,
            mealPrice,
            paidAmount,
            amount: paidAmount - mealPrice,
            studentNameSnapshot: CASHIER_NAME_SNAPSHOT,
            menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '',
            otherItemName: null,
            status: 'active', revision: 1, createdAt: now, createdSeq: seq,
            operatorUid: user.uid, operatorEmail: user.email,
            sourceDevice: 'pc', note: reason,
            lastCommandId: input.commandId, updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'CreateCashMovement', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: input.targets.dayId, studentId: CASHIER_STUDENT_ID,
            targets: input.targets, expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: dayBefore, transaction: null },
            after: { head: headAfter, day: dayAfter, transaction: transactionAfter },
            reason, cashEffect: cashMovementEffect(input.payload), payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.update(dayRef, dayAfter);
          tx.set(targetTransactionRef, transactionAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind === 'CreateRefund') {
          if (!daySnapshot?.exists() || !studentBefore || !targetTransactionRef || !dayRef || !targetStudentRef) {
            throw new RejectCommand('INVALID_INPUT', '退款需要已存在的營業日與學生');
          }
          if (transactionExists) throw new RejectCommand('INVALID_INPUT', 'transactionId 已存在');
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(studentBefore.revision, input.expectedRevisions.student, '學生版本');
          checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
          if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '該日已關帳');
          requireDateAfterGoLive(input.targets.dayId, String(headBefore.goLiveDate));
          const opening = studentBefore.openingBalance as Data;
          if (String(opening.asOfDate) > input.targets.dayId) throw new RejectCommand('INVALID_INPUT', '營業日早於學生期初日');
          const { amount, reason } = input.payload;
          const currentBalance = Number(studentBefore.currentBalance);
          if (amount > currentBalance) throw new RejectCommand('INVALID_INPUT', '退款金額不能超過目前餘額');
          const totalsBefore = dayBefore.totals as Data;
          const totalsAfter = {
            ...totalsBefore,
            activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
            accountRefunds: Number(totalsBefore.accountRefunds) + amount,
          };
          if (Object.values(totalsAfter).some(value => !Number.isSafeInteger(value) || Math.abs(value as number) > 1_000_000_000)) {
            throw new RejectCommand('INVALID_INPUT', '營業日合計超出允許範圍');
          }
          const studentAfter: Data = {
            ...studentBefore,
            currentBalance: currentBalance - amount,
            revision: Number(studentBefore.revision) + 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const dayAfter: Data = {
            ...dayBefore,
            revision: Number(dayBefore.revision) + 1,
            totals: totalsAfter,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const transactionAfter: Data = {
            transactionId: input.targets.transactionId,
            studentId: input.targets.studentId,
            businessDate: input.targets.dayId,
            type: 'refund',
            mealKind: null,
            mealPrice: 0,
            paidAmount: 0,
            amount,
            studentNameSnapshot: studentBefore.displayName,
            menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '',
            otherItemName: null,
            status: 'active', revision: 1, createdAt: now, createdSeq: seq,
            operatorUid: user.uid, operatorEmail: user.email,
            sourceDevice: 'pc', note: reason,
            lastCommandId: input.commandId, updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: 'CreateRefund', seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: input.targets.dayId, studentId: input.targets.studentId,
            targets: input.targets, expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, student: studentBefore, day: dayBefore, transaction: null },
            after: { head: headAfter, student: studentAfter, day: dayAfter, transaction: transactionAfter },
            reason, cashEffect: refundCashEffect(amount), payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.update(targetStudentRef, studentAfter);
          tx.update(dayRef, dayAfter);
          tx.set(targetTransactionRef, transactionAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (mutation) {
          if (!daySnapshot?.exists() || !dayRef || !targetTransactionRef || !transactionExists) {
            throw new RejectCommand('INVALID_INPUT', '要更正的交易或營業日不存在');
          }
          const { transactionId, studentId, dayId } = mutation.targets;
          const cashier = studentId === CASHIER_STUDENT_ID;
          const transactionBefore = decodeTransaction(transactionData);
          if (transactionBefore.transactionId !== transactionId || transactionBefore.studentId !== studentId
            || transactionBefore.businessDate !== dayId || cashier !== (transactionBefore.type === 'expense')) {
            throw new RejectCommand('INVALID_INPUT', '交易的帳戶或營業日與命令不一致');
          }
          if (!cashier && (!studentBefore || !targetStudentRef)) throw new RejectCommand('INVALID_INPUT', '交易的學生不存在');
          const dayBefore = decodeDay(daySnapshot.data());
          checkRevision(transactionBefore.revision, mutation.expectedRevisions.transaction, '交易版本');
          if (studentBefore) checkRevision(studentBefore.revision, mutation.expectedRevisions.student ?? -1, '學生版本');
          checkRevision(dayBefore.revision, mutation.expectedRevisions.day, '營業日版本');
          if (transactionBefore.status !== 'active') throw new RejectCommand('INVALID_INPUT', '這筆交易已作廢，不能再更正或取消');
          if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '該日已關帳，不能更正');
          requireDateAfterGoLive(dayId, String(headBefore.goLiveDate));
          if (mutation.kind === 'CancelRefund' || mutation.kind === 'Undo') {
            const today = taipeiCalendarDate((leaseSnapshot.data() as Data).updatedAt as Timestamp);
            if (dayId !== today) throw new RejectCommand('INVALID_INPUT', '只能撤回或退還台北今天的交易');
          }
          if (mutation.kind === 'Undo' && (transactionBefore.revision !== 1 || transactionBefore.operatorUid !== user.uid
            || transactionBefore.lastCommandId !== mutation.payload.targetCommandId)) {
            throw new RejectCommand('INVALID_INPUT', '只能撤回本人剛送出且未更動的交易');
          }
          let applied: Data;
          try {
            applied = applyTransactionMutation(
              transactionBefore as unknown as MutableTransaction,
              { kind: mutation.kind, payload: mutation.payload } as TransactionMutationPayload,
            ) as unknown as Data;
          } catch (error) {
            if (error instanceof TransactionMutationRejected) throw new RejectCommand('INVALID_INPUT', error.message);
            throw error;
          }
          const transactionAfter: Data = {
            ...applied,
            revision: Number(transactionBefore.revision) + 1,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          const contributionBefore = totalsContribution(transactionBefore as unknown as MutableTransaction);
          const contributionAfter = totalsContribution(transactionAfter as unknown as MutableTransaction);
          const totalsBefore = dayBefore.totals as Record<string, number>;
          const totalsAfter = Object.fromEntries(
            (Object.keys(contributionBefore) as Array<keyof typeof contributionBefore>).map(key => [
              key, totalsBefore[key] - contributionBefore[key] + contributionAfter[key],
            ]),
          );
          if (Object.values(totalsAfter).some(value => !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000)) {
            throw new RejectCommand('INVALID_INPUT', '營業日合計超出允許範圍');
          }
          const dayAfter: Data = {
            ...dayBefore,
            revision: Number(dayBefore.revision) + 1,
            totals: totalsAfter,
            lastCommandId: input.commandId,
            updatedAt: now,
          };
          let studentAfter: Data | null = null;
          if (studentBefore) {
            const nextBalance = Number(studentBefore.currentBalance)
              - studentContribution(transactionBefore as unknown as MutableTransaction)
              + studentContribution(transactionAfter as unknown as MutableTransaction);
            if (!Number.isSafeInteger(nextBalance) || Math.abs(nextBalance) > 1_000_000_000) {
              throw new RejectCommand('INVALID_INPUT', '餘額超出允許範圍');
            }
            if (mutation.kind === 'CorrectTransaction' && transactionBefore.type === 'refund'
              && Number(transactionAfter.amount) > Number(transactionBefore.amount) && nextBalance < 0) {
              throw new RejectCommand('INVALID_INPUT', '退款更正後餘額不能是負數');
            }
            studentAfter = {
              ...studentBefore,
              currentBalance: nextBalance,
              revision: Number(studentBefore.revision) + 1,
              lastCommandId: input.commandId,
              updatedAt: now,
            };
          }
          const cashEffect = mutationCashEffect(
            mutation.kind,
            transactionBefore as unknown as MutableTransaction,
            transactionAfter as unknown as MutableTransaction,
          );
          const stored = {
            commandId: input.commandId, kind: mutation.kind, seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate: dayId, studentId,
            targets: mutation.targets, expectedRevisions: mutation.expectedRevisions,
            before: studentAfter
              ? { head: headBefore, student: studentBefore, day: dayBefore, transaction: transactionBefore }
              : { head: headBefore, day: dayBefore, transaction: transactionBefore },
            after: studentAfter
              ? { head: headAfter, student: studentAfter, day: dayAfter, transaction: transactionAfter }
              : { head: headAfter, day: dayAfter, transaction: transactionAfter },
            reason: mutation.payload.reason, cashEffect, payload: mutation.payload, inputFingerprint: fingerprint,
          } as StoredEnabledCommandDoc;
          if (studentAfter) tx.update(targetStudentRef!, studentAfter);
          tx.update(dayRef, dayAfter);
          tx.update(targetTransactionRef, transactionAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (input.kind !== 'CreateOrder' && input.kind !== 'CreatePayment') {
          throw new RejectCommand('UNSUPPORTED_SCHEMA', '命令種類沒有對應的寫入流程');
        }
        if (!daySnapshot?.exists() || !studentBefore || !targetTransactionRef || !dayRef) {
          throw new RejectCommand('INVALID_INPUT', '建立交易需要已存在的營業日與學生');
        }
        if (transactionExists) throw new RejectCommand('INVALID_INPUT', 'transactionId 已存在');
        const dayBefore = decodeDay(daySnapshot.data());
        checkRevision(studentBefore.revision, input.expectedRevisions.student, '學生版本');
        checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
        checkRevision(0, input.expectedRevisions.transaction, '交易版本');
        if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '該日已關帳');
        requireDateAfterGoLive(input.targets.dayId, String(headBefore.goLiveDate));
        if (input.kind === 'CreateOrder' && studentBefore.status !== 'active') {
          throw new RejectCommand('INVALID_INPUT', '停用學生不能新增餐點');
        }
        const opening = studentBefore.openingBalance as Data;
        if (String(opening.asOfDate) > input.targets.dayId) throw new RejectCommand('INVALID_INPUT', '營業日早於學生期初日');

        const orderInput = input.kind === 'CreateOrder' ? input : null;
        const order = orderInput !== null;
        const mealPrice = orderInput?.payload.mealPrice ?? 0;
        const mealKind = orderInput?.payload.mealKind ?? null;
        const paidAmount = input.payload.paidAmount;
        const note = input.payload.note;
        const menu = dayBefore.menu as Data | null;
        if (orderInput?.payload.mealKind === 'bento') {
          if (!menu || orderInput.payload.menuRevision !== menu.revision || mealPrice !== menu.price) {
            throw new RejectCommand('REVISION_CONFLICT', '菜單或單價已變更，請重新確認');
          }
        }
        const currentBalance = Number(studentBefore.currentBalance);
        const nextBalance = currentBalance + paidAmount - mealPrice;
        if (!Number.isSafeInteger(nextBalance) || Math.abs(nextBalance) > 1_000_000_000) {
          throw new RejectCommand('INVALID_INPUT', '餘額超出允許範圍');
        }
        const totalsBefore = dayBefore.totals as Data;
        const totalsAfter = {
          ...totalsBefore,
          activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
          bentoCount: Number(totalsBefore.bentoCount) + (mealKind === 'bento' ? 1 : 0),
          otherMealCount: Number(totalsBefore.otherMealCount) + (mealKind === 'other' ? 1 : 0),
          mealTotal: Number(totalsBefore.mealTotal) + mealPrice,
          retainedReceipts: Number(totalsBefore.retainedReceipts) + paidAmount,
        };
        if (Object.values(totalsAfter).some(value => !Number.isSafeInteger(value) || Math.abs(value as number) > 1_000_000_000)) {
          throw new RejectCommand('INVALID_INPUT', '營業日合計超出允許範圍');
        }

        const studentAfter: Data = {
          ...studentBefore,
          currentBalance: nextBalance,
          revision: Number(studentBefore.revision) + 1,
          lastCommandId: input.commandId,
          updatedAt: now,
        };
        const dayAfter: Data = {
          ...dayBefore,
          revision: Number(dayBefore.revision) + 1,
          totals: totalsAfter,
          lastCommandId: input.commandId,
          updatedAt: now,
        };
        const transactionAfter: Data = {
          transactionId: input.targets.transactionId,
          studentId: input.targets.studentId,
          businessDate: input.targets.dayId,
          type: order ? 'order' : 'payment',
          mealKind,
          mealPrice,
          paidAmount,
          amount: paidAmount - mealPrice,
          studentNameSnapshot: studentBefore.displayName,
          menuNameSnapshot: mealKind === 'bento' ? menu?.itemName : '',
          menuPriceSnapshot: mealKind === 'bento' ? menu?.price : 0,
          vendorIdSnapshot: mealKind === 'bento' ? menu?.vendorId : '',
          vendorNameSnapshot: mealKind === 'bento' ? menu?.vendorNameSnapshot : '',
          otherItemName: orderInput?.payload.otherItemName ?? null,
          status: 'active', revision: 1, createdAt: now, createdSeq: seq,
          operatorUid: user.uid, operatorEmail: user.email,
          sourceDevice: 'pc', note,
          lastCommandId: input.commandId, updatedAt: now,
        };
        const cashEffect = {
          before: 0, after: paidAmount, delta: paidAmount,
          reasonKind: paidAmount > 0 ? 'collection' as const : 'none' as const,
          refundAmount: 0,
        };
        const storedCommon = {
          commandId: input.commandId, seq, leaseEpoch: input.leaseEpoch,
          actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
          businessDate: input.targets.dayId, studentId: input.targets.studentId,
          targets: input.targets, expectedRevisions: input.expectedRevisions,
          before: { head: headBefore, student: studentBefore, day: dayBefore, transaction: null },
          after: { head: headAfter, student: studentAfter, day: dayAfter, transaction: transactionAfter },
          reason: null, cashEffect, inputFingerprint: fingerprint,
        };
        const stored: StoredEnabledCommandDoc = input.kind === 'CreateOrder'
          ? { ...storedCommon, kind: 'CreateOrder', payload: input.payload }
          : { ...storedCommon, kind: 'CreatePayment', payload: input.payload };
        // All gets above are completed before the first write.
          tx.update(targetStudentRef!, studentAfter);
          tx.update(dayRef!, dayAfter);
        tx.set(targetTransactionRef, transactionAfter);
        tx.update(headRef, headAfter);
        tx.set(commandRef, stored);
        return { existing: null } as const;
      }, { maxAttempts: 5 });

      if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();

      if (transactionOutcome.existing) {
        await clearAfterConfirmedReceipt(pendingIdentity, input.leaseEpoch, user);
        if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
        return { ok: true, receipt: buildReceipt(transactionOutcome.existing) };
      }
      try {
        const confirmed = (await confirmPendingBatch([pendingIdentity], input.leaseEpoch))[0];
        if (confirmed.status !== 'matched') return resultFromUnknownError();
        const stored = confirmed.stored;
        await assertStoredReceiptMatches(stored, input, fingerprint);
        if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
        await pendingJournal.removeIf(
          pendingIdentity,
          () => isCurrentRecoveryOwner(user),
        ).catch(() => false);
        if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
        return { ok: true, receipt: confirmed.receipt };
      } catch {
        // A successful transaction followed by an unreadable receipt is ambiguous, never a definite failure.
        return resultFromUnknownError();
      }
    } catch (error) {
      if (error instanceof RejectCommand) return errorResult(error.code, error.message);
      if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'InvalidCloudCommandInput') {
        return errorResult('INVALID_INPUT', error instanceof Error ? error.message : '命令內容不合法');
      }

      const resultCode = mapTransactionError(error);
      try {
        if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
        const stored = await verifiedReceipt(input.commandId);
        if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
        if (stored) {
          await assertStoredReceiptMatches(stored, input, fingerprint);
          if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
          await clearAfterConfirmedReceipt(pendingIdentity, input.leaseEpoch, user);
          if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
          return { ok: true, receipt: buildReceipt(stored) };
        }
        if (resultCode === 'REVISION_CONFLICT' || resultCode === 'LEASE_LOST' || resultCode === 'QUOTA_EXCEEDED') {
          if (resultCode === 'LEASE_LOST') {
            if (!isCurrentRecoveryOwner(user)) return resultFromUnknownError();
            const diagnosed = leaseDenialResult(await readRevisionConflict(db, input));
            if (diagnosed) return diagnosed;
          }
          return errorResult(resultCode, '提交遭伺服器拒絕；請保留 commandId 並確認目前狀態');
        }
      } catch (readError) {
        if (readError instanceof RejectCommand && readError.code === 'INVALID_INPUT') {
          return errorResult(readError.code, readError.message);
        }
        if (resultCode === 'LEASE_LOST') {
          const diagnosed = leaseDenialResult(await readRevisionConflict(db, input));
          return diagnosed ?? errorResult('LEASE_LOST', '目前操作使用權已失效；請重新確認使用權');
        }
      }
      return resultFromUnknownError();
    }
  }

  return {
    commitCommand, readCommand, confirmPending, confirmPendingPage, confirmPendingIntent,
    cleanupConfirmedIntent, getPendingRecoveryContext,
  };
}
