import { getAuth, type User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import {
  createCloudCommandRepository,
  type CloudCommandRepositoryOptions,
} from './cloudCommandRepository';
import { CASHIER_NAME_SNAPSHOT, CASHIER_STUDENT_ID } from '../domain/cloudCommandSchema';
import type { CorrectTransactionPayload } from '../domain/cloudTransactionMutation';
import { decodeCloudDayRecord, type CloudDayRecord } from './cloudDayVendorRepository';
import { listCloudStudents, type CloudStudentRecord } from './cloudStudentRepository';
import { accessLeasePath, dataHeadPath, dayPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 200;
/** One dinner day for at most 500 students; anything larger fails closed instead of showing a partial day. */
const MAX_DAY_TRANSACTIONS = 2_000;

export interface CloudOrderTransactionRecord {
  transactionId: string;
  studentId: string;
  businessDate: string;
  /**
   * `expense` rows are counter cash (studentId `__cashier__`): income has paidAmount, expense has mealPrice.
   * `refund` rows pay a student's balance back in cash: positive `amount`, mealPrice and paidAmount 0.
   */
  type: 'order' | 'payment' | 'expense' | 'refund';
  mealKind: 'bento' | 'other' | null;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  studentNameSnapshot: string;
  menuNameSnapshot: string;
  menuPriceSnapshot: number;
  vendorIdSnapshot: string;
  vendorNameSnapshot: string;
  otherItemName: string | null;
  status: 'active' | 'voided';
  revision: number;
  createdAt: string;
  createdSeq: number;
  operatorUid: string;
  operatorEmail: string;
  sourceDevice: string;
  note: string;
  lastCommandId: string;
  updatedAt: string;
}

export interface CloudOrderSnapshot {
  /** Server business date: Taipei date of the server-confirmed lease `updatedAt`, never the browser clock. */
  today: string;
  goLiveDate: string;
  datasetId: string;
  seq: number;
  day: CloudDayRecord | null;
  students: CloudStudentRecord[];
  /** Today's transactions in the fixed order (createdAt ASC, transactionId ASC). */
  transactions: CloudOrderTransactionRecord[];
}

export type CloudOrderReadErrorCode =
  | CommandErrorCode
  | 'INCOMPLETE_SNAPSHOT'
  | 'STALE_SNAPSHOT'
  | 'RECONCILIATION_FAILED';

export class CloudOrderRepositoryError extends Error {
  readonly code: CloudOrderReadErrorCode;

  constructor(code: CloudOrderReadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudOrderRepositoryError';
  }
}

export type CloudOrderRepositoryOptions = CloudCommandRepositoryOptions & {
  /** Test seam for bounded paging; production uses 200. */
  pageSize?: number;
};

export interface CreateCloudOrderInput {
  commandId: string;
  /** Frozen with the commandId; a retry of the same command must reuse both. */
  transactionId: string;
  leaseEpoch: number;
  studentId: string;
  dayId: string;
  expectedStudentRevision: number;
  expectedDayRevision: number;
  mealKind: 'bento' | 'other';
  mealPrice: number;
  paidAmount: number;
  menuRevision: number | null;
  otherItemName: string | null;
  note: string;
}

export interface CreateCloudPaymentInput {
  commandId: string;
  transactionId: string;
  leaseEpoch: number;
  studentId: string;
  dayId: string;
  expectedStudentRevision: number;
  expectedDayRevision: number;
  paidAmount: number;
  note: string;
}

export interface CreateCloudCashMovementInput {
  commandId: string;
  transactionId: string;
  leaseEpoch: number;
  dayId: string;
  expectedDayRevision: number;
  direction: 'income' | 'expense';
  amount: number;
  reason: string;
}

export interface CreateCloudRefundInput {
  commandId: string;
  transactionId: string;
  leaseEpoch: number;
  studentId: string;
  dayId: string;
  expectedStudentRevision: number;
  expectedDayRevision: number;
  amount: number;
  reason: string;
}

/**
 * P10a：更正、作廢、取消（留款／退款）或撤回一筆既有交易。commandId 在結果確認前不得更換；
 * 櫃台收支列（studentId `__cashier__`）沒有學生版本，`expectedStudentRevision` 傳 null。
 */
export type CloudTransactionMutationInput = {
  commandId: string;
  leaseEpoch: number;
  transactionId: string;
  studentId: string;
  dayId: string;
  expectedTransactionRevision: number;
  expectedStudentRevision: number | null;
  expectedDayRevision: number;
} & (
  | { kind: 'CorrectTransaction'; payload: CorrectTransactionPayload }
  | { kind: 'VoidTransaction' | 'CancelKeepDeposit' | 'CancelRefund'; payload: { reason: string } }
  | { kind: 'Undo'; payload: { targetCommandId: string; reason: string } }
);

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: unknown, keys: string[]): value is Data {
  if (!plainRecord(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64 && !value.includes('/');
}

function timestampIso(value: unknown): string | null {
  if (!(value instanceof Timestamp)) return null;
  const date = value.toDate();
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function taipeiDate(timestamp: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp.toDate());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function currentUser(options: CloudOrderRepositoryOptions): CurrentUser | null {
  if (options.currentUser) return options.currentUser();
  try {
    return getAuth().currentUser;
  } catch {
    return null;
  }
}

function requireGoogleUser(options: CloudOrderRepositoryOptions): CurrentUser {
  const user = currentUser(options);
  if (!user?.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new CloudOrderRepositoryError('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
  return user;
}

function readError(error: unknown): CloudOrderRepositoryError {
  if (error instanceof CloudOrderRepositoryError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = error instanceof Error && error.message ? error.message : '';
  // Typed errors from the shared student/day decoders keep their code.
  if (['UNSUPPORTED_SCHEMA', 'MAINTENANCE', 'INCOMPLETE_SNAPSHOT', 'STALE_SNAPSHOT', 'LEASE_LOST', 'UNAUTHORIZED',
    'QUOTA_EXCEEDED', 'OFFLINE', 'INVALID_INPUT', 'UNKNOWN_RESULT'].includes(code)) {
    return new CloudOrderRepositoryError(code as CloudOrderReadErrorCode, message || '無法讀取雲端訂餐資料');
  }
  if (code.includes('permission-denied')) return new CloudOrderRepositoryError('LEASE_LOST', '目前帳號沒有讀取訂餐資料的有效使用權');
  if (code.includes('unauthenticated')) return new CloudOrderRepositoryError('UNAUTHORIZED', '請重新登入 Google 操作員帳號');
  if (code.includes('resource-exhausted')) return new CloudOrderRepositoryError('QUOTA_EXCEEDED', '目前讀取次數已達服務限制');
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) {
    return new CloudOrderRepositoryError('OFFLINE', '無法連線確認雲端訂餐資料');
  }
  return new CloudOrderRepositoryError('UNKNOWN_RESULT', '無法從伺服器確認雲端訂餐資料');
}

function decodeHead(value: unknown): { seq: number; datasetId: string; goLiveDate: string } {
  if (!exactKeys(value, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'])
    || value.schemaVersion !== 1 || typeof value.datasetId !== 'string' || !value.datasetId
    || !integer(value.seq, 0, Number.MAX_SAFE_INTEGER)
    || (value.lastCommandId !== null && (typeof value.lastCommandId !== 'string' || !UUID.test(value.lastCommandId)))
    || typeof value.maintenance !== 'boolean' || !validDate(value.goLiveDate)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudOrderRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead schema 不支援');
  }
  if (value.maintenance) throw new CloudOrderRepositoryError('MAINTENANCE', '系統正在維護，暫停讀取訂餐資料');
  return { seq: value.seq, datasetId: value.datasetId, goLiveDate: value.goLiveDate };
}

function decodeLease(value: unknown, uid: string): string {
  if (!exactKeys(value, ['holderUid', 'epoch', 'updatedAt'])
    || value.holderUid !== uid || !integer(value.epoch, 0, Number.MAX_SAFE_INTEGER)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudOrderRepositoryError('LEASE_LOST', '目前沒有有效的伺服器使用權租約');
  }
  return taipeiDate(value.updatedAt);
}

/**
 * Strict decode matching the Rules `validTransactionDoc` (order/payment), `validCashMovementTransactionDoc`
 * (expense) and `validRefundTransactionDoc` (refund) shapes; any other type fails closed.
 */
export function decodeCloudOrderTransaction(id: string, value: unknown, businessDate: string, headSeq: number): CloudOrderTransactionRecord {
  const keys = [
    'transactionId', 'studentId', 'businessDate', 'type', 'mealKind', 'mealPrice', 'paidAmount',
    'amount', 'studentNameSnapshot', 'menuNameSnapshot', 'menuPriceSnapshot', 'vendorIdSnapshot',
    'vendorNameSnapshot', 'otherItemName', 'status', 'revision', 'createdAt', 'createdSeq',
    'operatorUid', 'operatorEmail', 'sourceDevice', 'note', 'lastCommandId', 'updatedAt',
  ];
  const fail = () => new CloudOrderRepositoryError('UNSUPPORTED_SCHEMA', `交易文件 ${id} schema 不支援`);
  if (!validDocumentId(id) || !exactKeys(value, keys) || value.transactionId !== id) throw fail();
  const order = value.type === 'order';
  const expense = value.type === 'expense';
  const refund = value.type === 'refund';
  const bento = order && value.mealKind === 'bento';
  const other = order && value.mealKind === 'other';
  if ((value.type !== 'order' && value.type !== 'payment' && !expense && !refund)
    || !validDocumentId(value.studentId) || (expense ? value.studentId !== CASHIER_STUDENT_ID : value.studentId === CASHIER_STUDENT_ID)
    || value.businessDate !== businessDate
    || (order ? !(bento || other) : value.mealKind !== null)
    || !integer(value.mealPrice, 0, 1_000_000) || ((value.type === 'payment' || refund) && value.mealPrice !== 0)
    || !integer(value.paidAmount, value.type === 'payment' ? 1 : 0, 1_000_000) || (refund && value.paidAmount !== 0)
    || (expense && !((value.mealPrice === 0 && value.paidAmount > 0) || (value.paidAmount === 0 && value.mealPrice > 0)))
    || (refund
      ? !integer(value.amount, 1, 1_000_000)
      : value.amount !== (value.paidAmount as number) - (value.mealPrice as number))
    || typeof value.note !== 'string' || value.note.length > 500
    || typeof value.studentNameSnapshot !== 'string' || value.studentNameSnapshot.length < 1 || value.studentNameSnapshot.length > 100
    || (expense && (value.studentNameSnapshot !== CASHIER_NAME_SNAPSHOT || value.note.length < 1))
    || (refund && value.note.length < 1)
    || typeof value.menuNameSnapshot !== 'string' || typeof value.vendorIdSnapshot !== 'string'
    || typeof value.vendorNameSnapshot !== 'string' || !integer(value.menuPriceSnapshot, 0, 1_000_000)
    || (bento
      ? value.menuNameSnapshot.length < 1 || value.vendorIdSnapshot.length < 1 || value.vendorNameSnapshot.length < 1
        || value.menuPriceSnapshot < 1
      : value.menuNameSnapshot !== '' || value.vendorIdSnapshot !== '' || value.vendorNameSnapshot !== ''
        || value.menuPriceSnapshot !== 0)
    || (other
      ? typeof value.otherItemName !== 'string' || value.otherItemName.length < 1 || value.otherItemName.length > 100
      : value.otherItemName !== null)
    || (value.status !== 'active' && value.status !== 'voided')
    || !integer(value.revision, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.createdSeq, 1, headSeq)
    || typeof value.operatorUid !== 'string' || !value.operatorUid
    || typeof value.operatorEmail !== 'string' || !value.operatorEmail
    || typeof value.sourceDevice !== 'string' || !value.sourceDevice
    || typeof value.lastCommandId !== 'string' || !UUID.test(value.lastCommandId)) {
    throw fail();
  }
  const createdAt = timestampIso(value.createdAt);
  const updatedAt = timestampIso(value.updatedAt);
  if (!createdAt || !updatedAt) throw new CloudOrderRepositoryError('UNSUPPORTED_SCHEMA', `交易文件 ${id} 缺少伺服器 Timestamp`);
  return {
    transactionId: id,
    studentId: value.studentId,
    businessDate,
    type: value.type as CloudOrderTransactionRecord['type'],
    mealKind: value.mealKind as 'bento' | 'other' | null,
    mealPrice: value.mealPrice,
    paidAmount: value.paidAmount,
    amount: value.amount as number,
    studentNameSnapshot: value.studentNameSnapshot,
    menuNameSnapshot: value.menuNameSnapshot,
    menuPriceSnapshot: value.menuPriceSnapshot,
    vendorIdSnapshot: value.vendorIdSnapshot,
    vendorNameSnapshot: value.vendorNameSnapshot,
    otherItemName: value.otherItemName as string | null,
    status: value.status,
    revision: value.revision,
    createdAt,
    createdSeq: value.createdSeq,
    operatorUid: value.operatorUid,
    operatorEmail: value.operatorEmail,
    sourceDevice: value.sourceDevice,
    note: value.note,
    lastCommandId: value.lastCommandId,
    updatedAt,
  };
}

/**
 * The same contribution rules as spec §7.1 / Rules `validDayAdvance` and `validDayCashMovementProjection`:
 * active orders count meals and meal price, active order/payment rows count retained receipts, active
 * expense rows split into cashierIncome (paidAmount) and cashierExpense (mealPrice), active refund rows count
 * accountRefunds (amount), voided rows contribute nothing.
 */
export function reconcileDayTotals(day: CloudDayRecord | null, transactions: CloudOrderTransactionRecord[]): void {
  const active = transactions.filter(tx => tx.status === 'active');
  if (!day) {
    if (transactions.length > 0) {
      throw new CloudOrderRepositoryError('RECONCILIATION_FAILED', '營業日尚未建立，卻已有當日交易；請聯絡系統維護者');
    }
    return;
  }
  const computed = {
    activeTransactionCount: active.length,
    bentoCount: active.filter(tx => tx.type === 'order' && tx.mealKind === 'bento').length,
    otherMealCount: active.filter(tx => tx.type === 'order' && tx.mealKind === 'other').length,
    mealTotal: active.reduce((sum, tx) => sum + (tx.type === 'order' ? tx.mealPrice : 0), 0),
    retainedReceipts: active.reduce((sum, tx) => sum + (tx.type === 'order' || tx.type === 'payment' ? tx.paidAmount : 0), 0),
    cashierIncome: active.reduce((sum, tx) => sum + (tx.type === 'expense' ? tx.paidAmount : 0), 0),
    cashierExpense: active.reduce((sum, tx) => sum + (tx.type === 'expense' ? tx.mealPrice : 0), 0),
    accountRefunds: active.reduce((sum, tx) => sum + (tx.type === 'refund' ? tx.amount : 0), 0),
  };
  const mismatched = (Object.keys(computed) as Array<keyof typeof computed>)
    .filter(key => computed[key] !== day.totals[key]);
  if (mismatched.length > 0) {
    throw new CloudOrderRepositoryError(
      'RECONCILIATION_FAILED',
      `當日交易與營業日合計不一致（${mismatched.join('、')}）；沒有顯示可能錯誤的份數或金額`,
    );
  }
}

async function readHead(db: Firestore) {
  const snapshot = await getDocFromServer(doc(db, dataHeadPath()));
  if (!snapshot.exists()) throw new CloudOrderRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 尚未初始化');
  return decodeHead(snapshot.data());
}

async function readLeaseDate(db: Firestore, uid: string): Promise<string> {
  const snapshot = await getDocFromServer(doc(db, accessLeasePath()));
  if (!snapshot.exists()) throw new CloudOrderRepositoryError('LEASE_LOST', '使用權租約不存在');
  return decodeLease(snapshot.data(), uid);
}

async function readDayTransactions(db: Firestore, dayId: string, headSeq: number, pageSize: number) {
  const records: CloudOrderTransactionRecord[] = [];
  let cursor: DocumentSnapshot | undefined;
  for (;;) {
    const remainingProbe = MAX_DAY_TRANSACTIONS + 1 - records.length;
    const pageLimit = Math.min(pageSize, remainingProbe);
    const page = await getDocsFromServer(query(
      collection(db, 'transactions'),
      where('businessDate', '==', dayId),
      orderBy('createdAt'),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ));
    for (const snapshot of page.docs) records.push(decodeCloudOrderTransaction(snapshot.id, snapshot.data(), dayId, headSeq));
    if (records.length > MAX_DAY_TRANSACTIONS) {
      throw new CloudOrderRepositoryError('INCOMPLETE_SNAPSHOT', `當日交易超過 ${MAX_DAY_TRANSACTIONS} 筆完整讀取上限，未顯示不完整資料`);
    }
    if (page.size < pageLimit) return records;
    cursor = page.docs.at(-1);
  }
}

export function createCloudOrderRepository(db: Firestore, options: CloudOrderRepositoryOptions = {}) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) {
    throw new RangeError('pageSize must be an integer from 1 through 200');
  }
  const commands = createCloudCommandRepository(db, options);

  async function loadSnapshot(): Promise<CloudOrderSnapshot> {
    try {
      const user = requireGoogleUser(options);
      const before = await readHead(db);
      const today = await readLeaseDate(db, user.uid);
      const daySnapshot = await getDocFromServer(doc(db, dayPath(today)));
      const day = daySnapshot.exists() ? decodeCloudDayRecord(today, daySnapshot.data()) : null;
      const { students } = await listCloudStudents(db, options);
      const transactions = await readDayTransactions(db, today, before.seq, pageSize);
      const studentIds = new Set(students.map(student => student.studentId));
      const orphan = transactions.find(tx => tx.type !== 'expense' && !studentIds.has(tx.studentId));
      if (orphan) {
        throw new CloudOrderRepositoryError('RECONCILIATION_FAILED', `交易 ${orphan.transactionId} 指向不存在的學生；請聯絡系統維護者`);
      }
      reconcileDayTotals(day, transactions);
      const leaseDateAfter = await readLeaseDate(db, user.uid);
      if (leaseDateAfter !== today) {
        throw new CloudOrderRepositoryError('STALE_SNAPSHOT', '讀取期間伺服器營業日已跨日，請重新載入');
      }
      const after = await readHead(db);
      if (before.seq !== after.seq || before.datasetId !== after.datasetId || before.goLiveDate !== after.goLiveDate) {
        throw new CloudOrderRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料已變更，請重新載入');
      }
      return {
        today,
        goLiveDate: before.goLiveDate,
        datasetId: before.datasetId,
        seq: before.seq,
        day,
        students,
        transactions,
      };
    } catch (error) {
      throw readError(error);
    }
  }

  function createOrder(input: CreateCloudOrderInput): Promise<CommandResult> {
    return commands.commitCommand({
      commandId: input.commandId,
      kind: 'CreateOrder',
      leaseEpoch: input.leaseEpoch,
      targets: { transactionId: input.transactionId, studentId: input.studentId, dayId: input.dayId },
      expectedRevisions: {
        transaction: 0,
        student: input.expectedStudentRevision,
        day: input.expectedDayRevision,
      },
      payload: {
        mealKind: input.mealKind,
        mealPrice: input.mealPrice,
        paidAmount: input.paidAmount,
        menuRevision: input.mealKind === 'bento' ? input.menuRevision : null,
        otherItemName: input.mealKind === 'other' ? input.otherItemName : null,
        note: input.note,
      },
    });
  }

  function createPayment(input: CreateCloudPaymentInput): Promise<CommandResult> {
    return commands.commitCommand({
      commandId: input.commandId,
      kind: 'CreatePayment',
      leaseEpoch: input.leaseEpoch,
      targets: { transactionId: input.transactionId, studentId: input.studentId, dayId: input.dayId },
      expectedRevisions: {
        transaction: 0,
        student: input.expectedStudentRevision,
        day: input.expectedDayRevision,
      },
      payload: { paidAmount: input.paidAmount, note: input.note },
    });
  }

  function createCashMovement(input: CreateCloudCashMovementInput): Promise<CommandResult> {
    return commands.commitCommand({
      commandId: input.commandId,
      kind: 'CreateCashMovement',
      leaseEpoch: input.leaseEpoch,
      targets: { transactionId: input.transactionId, dayId: input.dayId },
      expectedRevisions: { transaction: 0, day: input.expectedDayRevision },
      payload: {
        mealPrice: input.direction === 'expense' ? input.amount : 0,
        paidAmount: input.direction === 'income' ? input.amount : 0,
        reason: input.reason,
      },
    });
  }

  function createRefund(input: CreateCloudRefundInput): Promise<CommandResult> {
    return commands.commitCommand({
      commandId: input.commandId,
      kind: 'CreateRefund',
      leaseEpoch: input.leaseEpoch,
      targets: { transactionId: input.transactionId, studentId: input.studentId, dayId: input.dayId },
      expectedRevisions: {
        transaction: 0,
        student: input.expectedStudentRevision,
        day: input.expectedDayRevision,
      },
      payload: { amount: input.amount, reason: input.reason },
    });
  }

  function mutateTransaction(input: CloudTransactionMutationInput): Promise<CommandResult> {
    return commands.commitCommand({
      commandId: input.commandId,
      kind: input.kind,
      leaseEpoch: input.leaseEpoch,
      targets: { transactionId: input.transactionId, studentId: input.studentId, dayId: input.dayId },
      expectedRevisions: input.expectedStudentRevision === null
        ? { transaction: input.expectedTransactionRevision, day: input.expectedDayRevision }
        : {
          transaction: input.expectedTransactionRevision,
          student: input.expectedStudentRevision,
          day: input.expectedDayRevision,
        },
      payload: input.payload,
    });
  }

  return {
    loadSnapshot,
    mutateTransaction,
    createOrder,
    createPayment,
    createCashMovement,
    createRefund,
    readCommand: (commandId: string): Promise<CommandReceipt | null> => commands.readCommand(commandId),
  };
}

export type CloudOrderRepository = ReturnType<typeof createCloudOrderRepository>;
