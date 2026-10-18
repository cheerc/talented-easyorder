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
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { CommandErrorCode } from '../domain/cloudCommands';
import {
  decodeEnabledCommandDoc,
  decodePostCloseEntryDoc,
  InvalidCloudCommandInput,
  type StoredEnabledCommandDoc,
} from '../domain/cloudCommandSchema';
import {
  CLOUD_REPORT_MAX_DAYS,
  buildCloudMergedTransactions,
  isValidCloudGregorianDate,
  summarizeCloudReportDays,
  validateCloudLedgerRange,
  type CloudAccountHistory,
  type CloudAuditRow,
  type CloudAuditSnapshot,
  type CloudLedgerDateRange,
  type CloudLedgerReport,
  type CloudReportDay,
  type CloudReportDayTotals,
  type CloudReportPostCloseEntry,
  type CloudReportSettlement,
  type CloudReportStudent,
  type CloudReportTransaction,
} from '../domain/cloudLedgerReport';
import { isBackfilled, readCloudBackfillDay, readCloudDayClose } from './cloudDayCloseRepository';
import { decodeCloudOrderTransaction, reconcileDayTotals } from './cloudOrderRepository';
import { listCloudStudents, type CloudStudentRecord } from './cloudStudentRepository';
import { decodeCloudDayRecord, type CloudDayRecord } from './cloudDayVendorRepository';
import { accessLeasePath, dataHeadPath, dayPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

const PAGE_SIZE = 100;
const MAX_DAY_TRANSACTIONS = 2_000;
const MAX_ACCOUNT_TRANSACTIONS = 100_000;
const MAX_ACCOUNT_ROWS_PER_REPORT = 250_000;
const MAX_AUDIT_COMMANDS = 100_000;
const MAX_POST_CLOSE_ENTRIES_PER_DAY = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CloudReadErrorCode = CommandErrorCode
  | 'INCOMPLETE_SNAPSHOT'
  | 'STALE_SNAPSHOT'
  | 'RECONCILIATION_FAILED';

export class CloudReadRepositoryError extends Error {
  readonly code: CloudReadErrorCode;

  constructor(code: CloudReadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudReadRepositoryError';
  }
}

export interface CloudReadPageEvent {
  collection: 'transactions' | 'commands' | 'postCloseEntries';
  page: number;
}

export interface CloudReadRepositoryOptions {
  /** Test seam for bounded cursor paging; production reads 100 documents per page. */
  pageSize?: number;
  /** Emulator-only orchestration seam for proving that page reads fail on a moving head. */
  afterPageRead?: (event: CloudReadPageEvent) => Promise<void>;
  /** Injection seam for Emulator tests; production callers use Firebase Auth currentUser. */
  currentUser?: () => CurrentUser | null;
}

export interface CloudSummaryInput {
  range: CloudLedgerDateRange;
  leaseEpoch: number;
}

export interface CloudReportInput extends CloudSummaryInput {
  studentId: string | null;
}

export interface CloudAccountHistoryInput extends CloudSummaryInput {
  studentId: string;
}

export type CloudAuditInput =
  | { dayId: string; leaseEpoch: number }
  | { studentId: string; leaseEpoch: number };

interface Head {
  datasetId: string;
  sourceSeq: number;
  goLiveDate: string;
}

interface ReadContext {
  head: Head;
  leaseToday: string;
  leaseEpoch: number;
  holderUid: string;
}

interface PagedResult {
  documents: QueryDocumentSnapshot[];
  count: number;
}

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertServerConfirmed(snapshot: { metadata: { fromCache: boolean; hasPendingWrites: boolean } }, source: string): void {
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
    throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `${source} 含快取或未確認的本機寫入，無法作為完整報表`);
  }
}

function exactKeys(value: unknown, keys: readonly string[]): value is Data {
  if (!plainRecord(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function currentUser(options: CloudReadRepositoryOptions): CurrentUser | null {
  if (options.currentUser) return options.currentUser();
  try {
    return getAuth().currentUser;
  } catch {
    return null;
  }
}

function requireGoogleUser(options: CloudReadRepositoryOptions): CurrentUser {
  const user = currentUser(options);
  if (!user?.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new CloudReadRepositoryError('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
  return user;
}

function decodeHead(value: unknown): Head {
  if (!exactKeys(value, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'])
    || value.schemaVersion !== 1 || typeof value.datasetId !== 'string' || value.datasetId.length < 1 || value.datasetId.length > 128
    || !integer(value.seq) || (value.lastCommandId !== null && (typeof value.lastCommandId !== 'string' || !UUID.test(value.lastCommandId)))
    || (value.seq === 0) !== (value.lastCommandId === null)
    || typeof value.maintenance !== 'boolean' || !isValidCloudGregorianDate(value.goLiveDate)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead schema 不支援');
  }
  if (value.maintenance) throw new CloudReadRepositoryError('MAINTENANCE', '系統正在維護，暫停讀取雲端報表');
  return { datasetId: value.datasetId, sourceSeq: value.seq, goLiveDate: value.goLiveDate };
}

function taipeiDate(timestamp: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp.toDate());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function decodeLease(value: unknown, uid: string): Omit<ReadContext, 'head'> {
  if (!exactKeys(value, ['holderUid', 'epoch', 'updatedAt']) || value.holderUid !== uid
    || !integer(value.epoch) || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudReadRepositoryError('LEASE_LOST', '目前沒有有效的伺服器使用權租約');
  }
  return { holderUid: uid, leaseEpoch: value.epoch, leaseToday: taipeiDate(value.updatedAt) };
}

function readFailure(error: unknown): CloudReadRepositoryError {
  if (error instanceof CloudReadRepositoryError) return error;
  if (error instanceof InvalidCloudCommandInput) {
    return new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '雲端稽核資料 schema 不支援');
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    const message = error instanceof Error ? error.message : '';
    if (['UNSUPPORTED_SCHEMA', 'MAINTENANCE', 'INCOMPLETE_SNAPSHOT', 'STALE_SNAPSHOT', 'RECONCILIATION_FAILED',
      'LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY', 'QUOTA_EXCEEDED', 'OFFLINE', 'INVALID_INPUT', 'UNKNOWN_RESULT']
      .includes(code)) {
      return new CloudReadRepositoryError(code as CloudReadErrorCode, message || '無法完整讀取雲端報表');
    }
    if (code.includes('permission-denied')) return new CloudReadRepositoryError('LEASE_LOST', '目前帳號沒有讀取報表的有效使用權');
    if (code.includes('unauthenticated')) return new CloudReadRepositoryError('UNAUTHORIZED', '請重新登入 Google 操作員帳號');
    if (code.includes('resource-exhausted')) return new CloudReadRepositoryError('QUOTA_EXCEEDED', '目前讀取次數已達服務限制');
    if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) {
      return new CloudReadRepositoryError('OFFLINE', '無法連線確認雲端報表');
    }
  }
  return new CloudReadRepositoryError('UNKNOWN_RESULT', '無法從伺服器確認雲端報表');
}

function validateEpoch(epoch: unknown): asserts epoch is number {
  if (!integer(epoch)) throw new CloudReadRepositoryError('INVALID_INPUT', '使用權租約版本不正確');
}

function validateStudentId(studentId: unknown): asserts studentId is string {
  if (typeof studentId !== 'string' || !UUID.test(studentId)) {
    throw new CloudReadRepositoryError('INVALID_INPUT', '學生帳戶 ID 格式不正確');
  }
}

function validateRange(range: CloudLedgerDateRange): CloudLedgerDateRange {
  let validated: CloudLedgerDateRange;
  try {
    validated = validateCloudLedgerRange(range);
  } catch (error) {
    throw new CloudReadRepositoryError('INVALID_INPUT', error instanceof Error ? error.message : '報表日期區間不正確');
  }
  return validated;
}

function validateSnapshotScope(context: ReadContext, expectedLeaseEpoch: number): void {
  if (context.leaseEpoch !== expectedLeaseEpoch) {
    throw new CloudReadRepositoryError('LEASE_LOST', '使用權租約已切換，請重新確認後再讀取報表');
  }
}

async function readContext(db: Firestore, user: CurrentUser): Promise<ReadContext> {
  const [headSnapshot, leaseSnapshot] = await Promise.all([
    getDocFromServer(doc(db, dataHeadPath())),
    getDocFromServer(doc(db, accessLeasePath())),
  ]);
  assertServerConfirmed(headSnapshot, 'dataHead');
  assertServerConfirmed(leaseSnapshot, 'accessLease');
  if (!headSnapshot.exists()) throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 尚未初始化');
  if (!leaseSnapshot.exists()) throw new CloudReadRepositoryError('LEASE_LOST', '使用權租約不存在');
  return {
    head: decodeHead(headSnapshot.data()),
    ...decodeLease(leaseSnapshot.data(), user.uid),
  };
}

function sameContext(left: ReadContext, right: ReadContext): boolean {
  return left.head.datasetId === right.head.datasetId
    && left.head.sourceSeq === right.head.sourceSeq
    && left.head.goLiveDate === right.head.goLiveDate
    && left.leaseEpoch === right.leaseEpoch
    && left.leaseToday === right.leaseToday
    && left.holderUid === right.holderUid;
}

async function assertContextUnchanged(db: Firestore, user: CurrentUser, before: ReadContext): Promise<void> {
  const after = await readContext(db, user);
  if (!sameContext(before, after)) {
    throw new CloudReadRepositoryError('STALE_SNAPSHOT', '讀取期間資料版本或使用權租約已變更，請重新載入');
  }
}

function toReportStudent(student: CloudStudentRecord): CloudReportStudent {
  return {
    studentId: student.studentId,
    studentCode: student.studentCode,
    displayName: student.displayName,
    aliases: [...student.aliases],
  };
}

function toReportTransaction(
  record: ReturnType<typeof decodeCloudOrderTransaction>,
  backfilled: boolean,
  sourceSeq: number,
): CloudReportTransaction {
  return {
    ...record,
    backfilled,
    sourceSeq,
  };
}

function compareTransactionDocuments(left: QueryDocumentSnapshot, right: QueryDocumentSnapshot): number {
  const leftValue = left.data();
  const rightValue = right.data();
  const leftDate = String(leftValue.businessDate);
  const rightDate = String(rightValue.businessDate);
  const byDate = compareAscii(leftDate, rightDate);
  if (byDate !== 0) return byDate;
  if (!(leftValue.createdAt instanceof Timestamp) || !(rightValue.createdAt instanceof Timestamp)) return 0;
  const byTimestamp = leftValue.createdAt.seconds - rightValue.createdAt.seconds
    || leftValue.createdAt.nanoseconds - rightValue.createdAt.nanoseconds;
  return byTimestamp || compareAscii(left.id, right.id);
}

function assertOrdered(documents: readonly QueryDocumentSnapshot[]): void {
  for (let index = 1; index < documents.length; index += 1) {
    if (compareTransactionDocuments(documents[index - 1], documents[index]) > 0) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', 'Firestore 交易排序與報表固定排序不一致');
    }
  }
}

async function readPaged(
  db: Firestore,
  base: (cursor: DocumentSnapshot | null, pageLimit: number) => Query,
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  maxDocuments: number,
  collectionName: CloudReadPageEvent['collection'],
  afterPageRead?: CloudReadRepositoryOptions['afterPageRead'],
): Promise<PagedResult> {
  const documents: QueryDocumentSnapshot[] = [];
  let cursor: DocumentSnapshot | null = null;
  let pageNumber = 0;
  for (;;) {
    const remainingProbe = maxDocuments + 1 - documents.length;
    const pageLimit = Math.min(pageSize, remainingProbe);
    if (pageLimit <= 0) break;
    const page: QuerySnapshot = await getDocsFromServer(base(cursor, pageLimit));
    assertServerConfirmed(page, collectionName);
    for (const snapshot of page.docs) assertServerConfirmed(snapshot, collectionName);
    pageNumber += 1;
    documents.push(...page.docs);
    if (documents.length > maxDocuments) {
      throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `雲端 ${collectionName} 超過完整讀取上限 ${maxDocuments}`);
    }
    await afterPageRead?.({ collection: collectionName, page: pageNumber });
    await assertContextUnchanged(db, user, context);
    if (page.size < pageLimit) return { documents, count: documents.length };
    cursor = page.docs.at(-1) ?? null;
    if (!cursor) return { documents, count: documents.length };
  }
  throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `雲端 ${collectionName} 無法證明完整讀取至 EOF`);
}

function decodeTransactionSnapshot(snapshot: QueryDocumentSnapshot, headSeq: number): ReturnType<typeof decodeCloudOrderTransaction> {
  const value: unknown = snapshot.data();
  if (!plainRecord(value) || !isValidCloudGregorianDate(value.businessDate)) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `交易文件 ${snapshot.id} 缺少有效 Gregorian 營業日`);
  }
  try {
    return decodeCloudOrderTransaction(snapshot.id, value, value.businessDate, headSeq);
  } catch (error) {
    throw readFailure(error);
  }
}

function sameDocumentSet(left: readonly QueryDocumentSnapshot[], right: readonly QueryDocumentSnapshot[]): boolean {
  if (left.length !== right.length) return false;
  const ids = new Set(left.map(item => item.id));
  return ids.size === left.length && right.every(item => ids.has(item.id));
}

async function readDayTransactions(
  db: Firestore,
  dayId: string,
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  afterPageRead?: CloudReadRepositoryOptions['afterPageRead'],
): Promise<ReturnType<typeof decodeCloudOrderTransaction>[]> {
  const primary = await readPaged(
    db,
    (cursor, pageLimit) => query(
      collection(db, 'transactions'),
      where('businessDate', '==', dayId),
      orderBy('createdAt'),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ),
    context, user, pageSize, MAX_DAY_TRANSACTIONS, 'transactions', afterPageRead,
  );
  const documentIdProof = await readPaged(
    db,
    (cursor, pageLimit) => query(
      collection(db, 'transactions'),
      where('businessDate', '==', dayId),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ),
    context, user, pageSize, MAX_DAY_TRANSACTIONS, 'transactions', afterPageRead,
  );
  if (!sameDocumentSet(primary.documents, documentIdProof.documents)) {
    throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${dayId} 有缺少排序欄位的交易，無法證明明細完整`);
  }
  const decoded = primary.documents.map(snapshot => {
    const record = decodeTransactionSnapshot(snapshot, context.head.sourceSeq);
    if (record.businessDate !== dayId) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `交易 ${snapshot.id} 營業日與查詢日期不一致`);
    }
    return record;
  });
  for (const snapshot of documentIdProof.documents) decodeTransactionSnapshot(snapshot, context.head.sourceSeq);
  assertOrdered(primary.documents);
  return decoded;
}

function dayTotals(day: CloudDayRecord | null): CloudReportDayTotals | null {
  if (!day) return null;
  return { ...day.totals };
}

function toReportSettlement(dayId: string, settlement: {
  revision: number;
  status: 'closed' | 'reopened';
  totals: CloudReportDayTotals;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  note: string;
  actorUid: string;
  actorEmail: string;
  sourceSeq: number;
  committedAt: string;
  lastCommandId: string;
}): CloudReportSettlement {
  return { businessDate: dayId, ...settlement, totals: { ...settlement.totals } };
}

function asciiTimestamp(timestamp: Timestamp): string {
  return timestamp.toDate().toISOString();
}

async function readPostCloseEntries(
  db: Firestore,
  dayId: string,
  lastSettlementRevision: number,
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  afterPageRead?: CloudReadRepositoryOptions['afterPageRead'],
): Promise<CloudReportPostCloseEntry[]> {
  const page = await readPaged(
    db,
    (cursor, pageLimit) => query(
      collection(db, 'postCloseEntries'),
      where('dayId', '==', dayId),
      orderBy('createdAt'),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ),
    context, user, pageSize, MAX_POST_CLOSE_ENTRIES_PER_DAY, 'postCloseEntries', afterPageRead,
  );
  const entries = page.documents.map(snapshot => {
    let decoded: Data;
    try {
      decoded = decodePostCloseEntryDoc(snapshot.data(), snapshot.id) as Data;
    } catch (error) {
      throw readFailure(error);
    }
    if (decoded.dayId !== dayId || !(decoded.createdAt instanceof Timestamp)
      || !integer(decoded.settlementRevision, 1) || decoded.settlementRevision > lastSettlementRevision) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `關帳後補記 ${snapshot.id} 與營業日版本不一致`);
    }
    return {
      entryId: snapshot.id,
      businessDate: dayId,
      settlementRevision: decoded.settlementRevision,
      direction: decoded.direction as CloudReportPostCloseEntry['direction'],
      amount: decoded.amount as number,
      reason: decoded.reason as string,
      createdBy: decoded.createdBy as string,
      createdAt: asciiTimestamp(decoded.createdAt),
      commandId: decoded.commandId as string,
      countedInEffectiveCash: decoded.settlementRevision === lastSettlementRevision,
    };
  });
  return entries;
}

interface LoadedRange {
  days: CloudReportDay[];
  dayRecords: Map<string, CloudDayRecord | null>;
  backfills: Map<string, { dayId: string } | null>;
}

function rangeDates(range: CloudLedgerDateRange): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${range.startDate}T00:00:00.000Z`);
  while (cursor.toISOString().slice(0, 10) <= range.endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (dates.length > CLOUD_REPORT_MAX_DAYS) throw new CloudReadRepositoryError('INVALID_INPUT', '報表日期區間最多 31 天');
  return dates;
}

async function loadRange(
  db: Firestore,
  dates: readonly string[],
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  afterPageRead?: CloudReadRepositoryOptions['afterPageRead'],
): Promise<LoadedRange> {
  const days: CloudReportDay[] = [];
  const dayRecords = new Map<string, CloudDayRecord | null>();
  const backfills = new Map<string, { dayId: string } | null>();
  for (const dayId of dates) {
    const snapshot = await getDocFromServer(doc(db, dayPath(dayId)));
    assertServerConfirmed(snapshot, `營業日 ${dayId}`);
    let day: CloudDayRecord | null = null;
    if (snapshot.exists()) {
      try {
        day = decodeCloudDayRecord(dayId, snapshot.data());
      } catch (error) {
        throw readFailure(error);
      }
    }
    if (day && dayId < context.head.goLiveDate) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `系統啟用日前存在營業日投影 ${dayId}`);
    }
    if (day) {
      const requiresSettlement = day.status === 'closed' || day.status === 'reopened';
      const hasSettlementRevision = day.lastSettlementRevision > 0;
      if (requiresSettlement !== hasSettlementRevision) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 狀態與日結版號不一致`);
      }
    }
    const backfill = await readCloudBackfillDay(db, dayId);
    if (backfill && !day) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `回填標記 ${dayId} 缺少營業日投影`);
    }
    const close = day && day.lastSettlementRevision > 0
      ? await readCloudDayClose(db, dayId, { currentUser: () => user })
      : null;
    if (day && day.lastSettlementRevision > 0 && close === null) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 缺少版號所指的完整日結歷史`);
    }
    if (close) {
      const totalsMatch = JSON.stringify(close.totals) === JSON.stringify(day?.totals);
      if (close.status !== day?.status || close.revision !== day.revision
        || close.lastSettlementRevision !== day.lastSettlementRevision || close.openingCash !== day.openingCash || !totalsMatch) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 與完整日結版本讀取結果不一致`);
      }
      if (close.settlements.some(settlement => settlement.sourceSeq > context.head.sourceSeq)) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 日結來源序號超過資料版本`);
      }
    }
    if (close && close.postCloseEntries.length > MAX_POST_CLOSE_ENTRIES_PER_DAY) {
      throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${dayId} 補記超過完整讀取上限`);
    }
    const settlements = (close?.settlements ?? []).map(settlement => toReportSettlement(dayId, settlement));
    const entries = close
      ? await readPostCloseEntries(db, dayId, day?.lastSettlementRevision ?? 0, context, user, pageSize, afterPageRead)
      : [];
    if (close) {
      const expectedIds = new Set(close.postCloseEntries.map(entry => entry.entryId));
      if (entries.length !== expectedIds.size || entries.some(entry => !expectedIds.has(entry.entryId))) {
        throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${dayId} 的補記分頁與完整日結讀取不一致`);
      }
    }
    if (day?.status === 'closed' && (close === null || close.effectiveCash === null)) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `已關帳日 ${dayId} 缺少可驗證的有效關帳現金`);
    }
    days.push({
      businessDate: dayId,
      exists: day !== null,
      status: day?.status ?? null,
      revision: day?.revision ?? null,
      openingCash: day?.openingCash ?? null,
      totals: dayTotals(day),
      lastSettlementRevision: day?.lastSettlementRevision ?? 0,
      backfillReason: backfill?.reason ?? null,
      settlements,
      postCloseEntries: entries,
      effectiveCash: close?.effectiveCash ?? null,
    });
    dayRecords.set(dayId, day);
    backfills.set(dayId, backfill ? { dayId: backfill.dayId } : null);
  }
  return { days, dayRecords, backfills };
}

async function readTransactionsForRange(
  db: Firestore,
  range: LoadedRange,
  dates: readonly string[],
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  afterPageRead?: CloudReadRepositoryOptions['afterPageRead'],
): Promise<CloudReportTransaction[]> {
  const transactions: CloudReportTransaction[] = [];
  for (const dayId of dates) {
    const records = await readDayTransactions(db, dayId, context, user, pageSize, afterPageRead);
    if (records.some(record => record.businessDate < context.head.goLiveDate)) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `系統啟用日前存在交易 ${dayId}`);
    }
    reconcileDayTotals(range.dayRecords.get(dayId) ?? null, records);
    const marker = range.backfills.get(dayId) ?? null;
    for (const record of records) {
      transactions.push(toReportTransaction(record, isBackfilled({ businessDate: dayId, createdAt: Timestamp.fromDate(new Date(record.createdAt)) }, marker), context.head.sourceSeq));
    }
  }
  return transactions;
}

interface AccountPrefix {
  currentBalance: number;
  transactions: CloudReportTransaction[];
  transactionCount: number;
}

async function readAccountPrefix(
  db: Firestore,
  student: CloudStudentRecord,
  range: CloudLedgerDateRange,
  backfills: ReadonlyMap<string, { dayId: string } | null>,
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  afterPageRead: CloudReadRepositoryOptions['afterPageRead'],
): Promise<AccountPrefix> {
  const studentId = student.studentId;
  const ordered = await readPaged(
    db,
    (cursor, pageLimit) => query(
      collection(db, 'transactions'),
      where('studentId', '==', studentId),
      orderBy('businessDate'),
      orderBy('createdAt'),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ),
    context, user, pageSize, MAX_ACCOUNT_TRANSACTIONS, 'transactions', afterPageRead,
  );
  const allDocuments = await readPaged(
    db,
    (cursor, pageLimit) => query(
      collection(db, 'transactions'),
      where('studentId', '==', studentId),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ),
    context, user, pageSize, MAX_ACCOUNT_TRANSACTIONS, 'transactions', afterPageRead,
  );
  if (!sameDocumentSet(ordered.documents, allDocuments.documents)) {
    throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `帳戶 ${studentId} 有缺少排序欄位的歷史交易`);
  }
  for (const snapshot of allDocuments.documents) decodeTransactionSnapshot(snapshot, context.head.sourceSeq);
  assertOrdered(ordered.documents);

  if (!isValidCloudGregorianDate(student.openingBalance.asOfDate)) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `學生 ${studentId} 期初日期不支援`);
  }
  let balance = student.openingBalance.amount;
  const visible: CloudReportTransaction[] = [];
  for (const snapshot of ordered.documents) {
    const record = decodeTransactionSnapshot(snapshot, context.head.sourceSeq);
    if (record.studentId !== studentId || record.type === 'expense' || record.businessDate < context.head.goLiveDate
      || record.businessDate < student.openingBalance.asOfDate
      || record.businessDate > context.leaseToday) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `帳戶 ${studentId} 的歷史前綴日期或帳戶資料不一致`);
    }
    if (record.status === 'active') {
      balance += record.type === 'refund' ? -record.amount : record.amount;
      if (!Number.isSafeInteger(balance) || balance < -1_000_000_000 || balance > 1_000_000_000) {
        throw new CloudReadRepositoryError('RECONCILIATION_FAILED', `帳戶 ${studentId} 歷史餘額超出安全範圍`);
      }
    }
    if (record.businessDate >= range.startDate && record.businessDate <= range.endDate) {
      const marker = backfills.get(record.businessDate) ?? null;
      const visibleTransaction = toReportTransaction(
        record,
        isBackfilled({ businessDate: record.businessDate, createdAt: Timestamp.fromDate(new Date(record.createdAt)) }, marker),
        context.head.sourceSeq,
      );
      visibleTransaction.afterBalance = balance;
      visibleTransaction.balanceApplicability = 'verified';
      visible.push(visibleTransaction);
    }
  }
  if (balance !== student.currentBalance) {
    throw new CloudReadRepositoryError('RECONCILIATION_FAILED', `帳戶 ${studentId} 完整歷史與學生 currentBalance 不一致`);
  }
  return { currentBalance: balance, transactions: visible, transactionCount: ordered.count };
}

function checkedAccountHistoryCount(current: number, next: number): number {
  const count = current + next;
  if (!Number.isSafeInteger(count) || count > MAX_ACCOUNT_ROWS_PER_REPORT) {
    throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `報表帳戶歷史合計超過完整讀取上限 ${MAX_ACCOUNT_ROWS_PER_REPORT}`);
  }
  return count;
}

function emptyReport(context: ReadContext, range: CloudLedgerDateRange, scope: { studentId: string | null }, loaded: LoadedRange,
  students: CloudReportStudent[], transactions: CloudReportTransaction[]): CloudLedgerReport {
  const settlements = loaded.days.flatMap(day => day.settlements);
  const postCloseEntries = loaded.days.flatMap(day => day.postCloseEntries);
  return {
    datasetId: context.head.datasetId,
    sourceSeq: context.head.sourceSeq,
    goLiveDate: context.head.goLiveDate,
    leaseToday: context.leaseToday,
    leaseEpoch: context.leaseEpoch,
    range,
    scope,
    complete: true,
    summary: summarizeCloudReportDays(loaded.days),
    students,
    days: loaded.days,
    transactions,
    mergedTransactions: buildCloudMergedTransactions(transactions),
    settlements,
    postCloseEntries,
  };
}

export function createCloudReadRepository(db: Firestore, options: CloudReadRepositoryOptions = {}) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) {
    throw new RangeError('pageSize must be an integer from 1 through 100');
  }

  async function readSummary(input: CloudSummaryInput): Promise<CloudLedgerReport> {
    try {
      validateEpoch(input.leaseEpoch);
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      const range = validateRange(input.range);
      const dates = rangeDates(range);
      const loaded = await loadRange(db, dates, context, user, pageSize, options.afterPageRead);
      await assertContextUnchanged(db, user, context);
      return emptyReport(context, range, { studentId: null }, loaded, [], []);
    } catch (error) {
      throw readFailure(error);
    }
  }

  async function readReport(input: CloudReportInput): Promise<CloudLedgerReport> {
    try {
      validateEpoch(input.leaseEpoch);
      if (input.studentId !== null) validateStudentId(input.studentId);
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      const range = validateRange(input.range);
      const dates = rangeDates(range);
      const loaded = await loadRange(db, dates, context, user, pageSize, options.afterPageRead);
      const allTransactions = await readTransactionsForRange(db, loaded, dates, context, user, pageSize, options.afterPageRead);
      const listed = await listCloudStudents(db, { currentUser: () => user });
      if (listed.datasetId !== context.head.datasetId || listed.seq !== context.head.sourceSeq
        || listed.goLiveDate !== context.head.goLiveDate) {
        throw new CloudReadRepositoryError('STALE_SNAPSHOT', '學生名單與報表資料版本不一致');
      }
      const studentById = new Map(listed.students.map(student => [student.studentId, student]));
      for (const transaction of allTransactions) {
        if (transaction.studentId !== '__cashier__' && !studentById.has(transaction.studentId)) {
          throw new CloudReadRepositoryError('RECONCILIATION_FAILED', `交易 ${transaction.transactionId} 指向不存在的學生`);
        }
      }
      let transactions = input.studentId === null
        ? allTransactions
        : allTransactions.filter(transaction => transaction.studentId === input.studentId);
      const accountIds = [...new Set(transactions.filter(transaction => transaction.studentId !== '__cashier__')
        .map(transaction => transaction.studentId))].sort(compareAscii);
      let readRows = 0;
      const balancesByTransaction = new Map<string, CloudReportTransaction>();
      for (const studentId of accountIds) {
        const student = studentById.get(studentId);
        if (!student) throw new CloudReadRepositoryError('RECONCILIATION_FAILED', `找不到帳戶 ${studentId}`);
        const prefix = await readAccountPrefix(
          db, student, range, loaded.backfills, context, user, pageSize, options.afterPageRead,
        );
        readRows = checkedAccountHistoryCount(readRows, prefix.transactionCount);
        for (const transaction of prefix.transactions) balancesByTransaction.set(transaction.transactionId, transaction);
      }
      transactions = transactions.map(transaction => {
        if (transaction.studentId === '__cashier__') {
          return { ...transaction, balanceApplicability: 'not-applicable' };
        }
        const balanced = balancesByTransaction.get(transaction.transactionId);
        if (!balanced || balanced.afterBalance === undefined) {
          throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `交易 ${transaction.transactionId} 沒有可驗證的帳戶餘額`);
        }
        return balanced;
      });
      await assertContextUnchanged(db, user, context);
      return emptyReport(context, range, { studentId: input.studentId }, loaded,
        listed.students.map(toReportStudent), transactions);
    } catch (error) {
      throw readFailure(error);
    }
  }

  async function readAccountHistory(input: CloudAccountHistoryInput): Promise<CloudAccountHistory> {
    try {
      validateEpoch(input.leaseEpoch);
      validateStudentId(input.studentId);
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      const range = validateRange(input.range);
      const listed = await listCloudStudents(db, { currentUser: () => user });
      if (listed.datasetId !== context.head.datasetId || listed.seq !== context.head.sourceSeq) {
        throw new CloudReadRepositoryError('STALE_SNAPSHOT', '學生名單與帳戶歷史資料版本不一致');
      }
      const student = listed.students.find(candidate => candidate.studentId === input.studentId);
      if (!student) throw new CloudReadRepositoryError('INVALID_INPUT', '查無此學生帳戶');
      const dates = rangeDates(range);
      const loaded = await loadRange(db, dates, context, user, pageSize, options.afterPageRead);
      await readTransactionsForRange(db, loaded, dates, context, user, pageSize, options.afterPageRead);
      const prefix = await readAccountPrefix(db, student, range, loaded.backfills, context, user, pageSize, options.afterPageRead);
      await assertContextUnchanged(db, user, context);
      return {
        datasetId: context.head.datasetId,
        sourceSeq: context.head.sourceSeq,
        goLiveDate: context.head.goLiveDate,
        leaseToday: context.leaseToday,
        leaseEpoch: context.leaseEpoch,
        range,
        scope: { studentId: input.studentId },
        complete: true,
        student: toReportStudent(student),
        openingBalance: student.openingBalance.amount,
        currentBalance: prefix.currentBalance,
        transactions: prefix.transactions,
      };
    } catch (error) {
      throw readFailure(error);
    }
  }

  async function readAudit(input: CloudAuditInput): Promise<CloudAuditSnapshot> {
    try {
      validateEpoch(input.leaseEpoch);
      const isDay = 'dayId' in input;
      if (isDay) {
        if (!isValidCloudGregorianDate(input.dayId)) throw new CloudReadRepositoryError('INVALID_INPUT', '稽核日期格式不正確');
      } else validateStudentId(input.studentId);
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      const queryBase = isDay
        ? (cursor: DocumentSnapshot | null, pageLimit: number) => query(
          collection(db, 'commands'),
          where('businessDate', '==', input.dayId),
          where('seq', '<=', context.head.sourceSeq),
          orderBy('seq'),
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(pageLimit),
        )
        : (cursor: DocumentSnapshot | null, pageLimit: number) => query(
          collection(db, 'commands'),
          where('studentId', '==', input.studentId),
          where('seq', '<=', context.head.sourceSeq),
          orderBy('seq'),
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(pageLimit),
        );
      const documentIdProofBase = isDay
        ? (cursor: DocumentSnapshot | null, pageLimit: number) => query(
          collection(db, 'commands'),
          where('businessDate', '==', input.dayId),
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(pageLimit),
        )
        : (cursor: DocumentSnapshot | null, pageLimit: number) => query(
          collection(db, 'commands'),
          where('studentId', '==', input.studentId),
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(pageLimit),
        );
      const [paged, documentIdProof] = await Promise.all([
        readPaged(db, queryBase, context, user, pageSize, MAX_AUDIT_COMMANDS, 'commands', options.afterPageRead),
        readPaged(db, documentIdProofBase, context, user, pageSize, MAX_AUDIT_COMMANDS, 'commands', options.afterPageRead),
      ]);
      if (!sameDocumentSet(paged.documents, documentIdProof.documents)) {
        throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', '稽核命令缺少 seq 等必要排序欄位，無法證明範圍完整');
      }
      const rows: CloudAuditRow[] = [];
      let previousSeq = 0;
      for (const snapshot of paged.documents) {
        let command: StoredEnabledCommandDoc;
        try {
          command = decodeEnabledCommandDoc(snapshot.data());
        } catch (error) {
          throw readFailure(error);
        }
        if (command.commandId !== snapshot.id || command.seq <= previousSeq || command.seq > context.head.sourceSeq
          || (isDay && command.businessDate !== input.dayId)
          || (!isDay && command.studentId !== input.studentId)) {
          throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `稽核 command ${snapshot.id} 與查詢範圍不一致`);
        }
        previousSeq = command.seq;
        rows.push({
          commandId: command.commandId,
          kind: command.kind,
          seq: command.seq,
          leaseEpoch: command.leaseEpoch,
          businessDate: command.businessDate,
          studentId: command.studentId,
          actorUid: command.actor.uid,
          actorEmail: command.actor.email,
          committedAt: command.committedAt.toDate().toISOString(),
          reason: command.reason,
          before: command.before,
          after: command.after,
        });
      }
      await assertContextUnchanged(db, user, context);
      return {
        datasetId: context.head.datasetId,
        sourceSeq: context.head.sourceSeq,
        goLiveDate: context.head.goLiveDate,
        leaseToday: context.leaseToday,
        leaseEpoch: context.leaseEpoch,
        scope: isDay ? { dayId: input.dayId } : { studentId: input.studentId },
        complete: true,
        rows,
      };
    } catch (error) {
      throw readFailure(error);
    }
  }

  return { readSummary, readReport, readAccountHistory, readAudit };
}
