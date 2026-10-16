import { getAuth, type User } from 'firebase/auth';
import {
  Timestamp,
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import {
  InvalidCloudCommandInput,
  decodeEnabledCommandDoc,
  fingerprintCommandInput,
  normalizeEnabledCommandInput,
  sameCommandSemantics,
  type CanonicalEnabledInput,
  type StoredEnabledCommandDoc,
} from '../domain/cloudCommandSchema';
import { STUDENT_CODE_REGEX } from '../domain/student';
import { accessLeasePath, commandPath, dataHeadPath, dayPath, studentCodePath, studentPath, transactionPath, vendorPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

export interface CloudCommandRepositoryOptions {
  /** Injection seam for emulator tests; production callers use Firebase Auth currentUser. */
  currentUser?: () => CurrentUser | null;
}

class RejectCommand extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

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
    || !hasExactKeys(value.totals, ['activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense'])
    || !integer(value.totals.activeTransactionCount)
    || !integer(value.totals.bentoCount)
    || !integer(value.totals.otherMealCount)
    || !integer(value.totals.mealTotal) || value.totals.mealTotal > 1_000_000_000
    || !integer(value.totals.retainedReceipts) || value.totals.retainedReceipts > 1_000_000_000
    || !integer(value.totals.cashierIncome) || value.totals.cashierIncome > 1_000_000_000
    || !integer(value.totals.cashierExpense) || value.totals.cashierExpense > 1_000_000_000
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

async function readRevisionConflict(db: Firestore, input: CanonicalEnabledInput): Promise<CommandErrorCode | null> {
  try {
    if (input.kind === 'CreateStudent' || input.kind === 'ChangeStudentCode' || input.kind === 'EditStudent' || input.kind === 'SetStudentStatus') {
      const student = await getDocFromServer(doc(db, studentPath(input.targets.studentId)));
      if (input.kind === 'CreateStudent') return 'INVALID_INPUT';
      if (!student.exists()) return 'INVALID_INPUT';
      const current = decodeStudent(student.data());
      return current.revision === input.expectedRevisions.student ? 'INVALID_INPUT' : 'REVISION_CONFLICT';
    }
    if (input.kind === 'EnsureDay') {
      await getDocFromServer(doc(db, dayPath(input.targets.dayId)));
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
    if (input.kind !== 'CreateOrder' && input.kind !== 'CreatePayment') return null;
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

function leaseDenialResult(code: CommandErrorCode | null): CommandResult | null {
  if (code === null) return null;
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
  async function verifiedReceipt(commandId: string): Promise<StoredEnabledCommandDoc | null> {
    const snapshot = await getDocFromServer(doc(db, commandPath(commandId)));
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
      requireVerifiedGoogle(getCurrentUser(options));
      const stored = await verifiedReceipt(commandId);
      return stored ? buildReceipt(stored) : null;
    } catch (error) {
      if (error instanceof CloudCommandReadError) throw error;
      if (error instanceof RejectCommand) throw new CloudCommandReadError(error.code, error.message);
      // null is reserved for a successful server read that confirmed absence.
      const code = mapTransactionError(error);
      throw new CloudCommandReadError(code, '無法從伺服器確認 command receipt');
    }
  }

  async function commitCommand(untrustedInput: unknown): Promise<CommandResult> {
    let input: CanonicalEnabledInput;
    let user: CurrentUser;
    let fingerprint: string;
    try {
      input = normalizeEnabledCommandInput(untrustedInput);
      const candidateUser = getCurrentUser(options);
      requireVerifiedGoogle(candidateUser);
      user = candidateUser;
      fingerprint = await fingerprintCommandInput(input);
    } catch (error) {
      if (error instanceof RejectCommand) return errorResult(error.code, error.message);
      if (error instanceof Error && error.name === 'InvalidCloudCommandInput') return errorResult('INVALID_INPUT', error.message);
      return errorResult('UNSUPPORTED_SCHEMA', error instanceof Error ? error.message : '無法驗證命令內容');
    }

    const commandRef = doc(db, commandPath(input.commandId));
    const headRef = doc(db, dataHeadPath());
    const leaseRef = doc(db, accessLeasePath());
    const operatorRef = doc(db, `operators/${user.uid}`);
    const hasDayTarget = input.kind === 'EnsureDay' || input.kind === 'CreateOrder' || input.kind === 'CreatePayment'
      || input.kind === 'SetDayMenu' || input.kind === 'SetOpeningCash';
    const targetDayId = input.kind === 'EnsureDay' ? input.targets.dayId
      : input.kind === 'CreateOrder' || input.kind === 'CreatePayment' || input.kind === 'SetDayMenu' || input.kind === 'SetOpeningCash'
        ? input.targets.dayId : null;
    const dayRef = targetDayId ? doc(db, dayPath(targetDayId)) : null;
    const targetStudentId = input.kind === 'CreateStudent' || input.kind === 'ChangeStudentCode' || input.kind === 'EditStudent' || input.kind === 'SetStudentStatus'
      || input.kind === 'CreateOrder' || input.kind === 'CreatePayment' ? input.targets.studentId : null;
    const targetStudentRef = targetStudentId ? doc(db, studentPath(targetStudentId)) : null;
    const targetVendorId = input.kind === 'SaveVendor' || input.kind === 'RemoveVendor' ? input.targets.vendorId
      : input.kind === 'SetDayMenu' ? input.payload.vendorId : null;
    const targetVendorRef = targetVendorId ? doc(db, vendorPath(targetVendorId)) : null;
    const sourceDayRef = input.kind === 'SetDayMenu' && input.payload.inheritedFromDate
      ? doc(db, dayPath(input.payload.inheritedFromDate)) : null;
    const targetTransactionRef = input.kind === 'CreateOrder' || input.kind === 'CreatePayment'
      ? doc(db, transactionPath(input.targets.transactionId))
      : null;

    try {
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

        if (input.kind === 'EnsureDay') {
          if (!daySnapshot) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'EnsureDay 缺少目標日期參照');
          if (daySnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '該營業日已存在；不會重設或重開日期');
          const businessDate = input.payload.businessDate;
          requireDateAfterGoLive(businessDate, String(headBefore.goLiveDate));
          const dayAfter: Data = {
            status: 'open', revision: 1, menu: null, openingCash: null, openedBy: null, openedAt: null,
            totals: { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0 },
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
            reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
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

      if (transactionOutcome.existing) {
        return { ok: true, receipt: buildReceipt(transactionOutcome.existing) };
      }
      try {
        const stored = await verifiedReceipt(input.commandId);
        if (!stored) return resultFromUnknownError();
        await assertStoredReceiptMatches(stored, input, fingerprint);
        return { ok: true, receipt: buildReceipt(stored) };
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
        const stored = await verifiedReceipt(input.commandId);
        if (stored) {
          await assertStoredReceiptMatches(stored, input, fingerprint);
          return { ok: true, receipt: buildReceipt(stored) };
        }
        if (resultCode === 'REVISION_CONFLICT' || resultCode === 'LEASE_LOST' || resultCode === 'QUOTA_EXCEEDED') {
          if (resultCode === 'LEASE_LOST') {
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

  return { commitCommand, readCommand };
}
