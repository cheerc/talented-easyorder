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
  attributeCloudAuditDate,
  buildCloudMergedTransactions,
  isValidCloudGregorianDate,
  summarizeCloudReportDays,
  validateCloudLedgerRange,
  type CloudAccessEventRow,
  type CloudAccessEventsSnapshot,
  type CloudAccountHistory,
  type CloudAuditRow,
  type CloudAuditRangeRow,
  type CloudAuditRangeSnapshot,
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
import { isBackfilled, readCloudBackfillDay, readCloudDayClose, readCloudSettlementVersion } from './cloudDayCloseRepository';
import { decodeCloudOrderTransaction, reconcileDayTotals } from './cloudOrderRepository';
import { decodeCloudStudentRecord, listCloudStudents, type CloudStudentRecord } from './cloudStudentRepository';
import { decodeCloudDayRecord, type CloudDayRecord } from './cloudDayVendorRepository';
import { accessEventPath, accessLeasePath, dataHeadPath, dayPath, studentPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

const PAGE_SIZE = 100;
const MAX_DAY_TRANSACTIONS = 2_000;
/** Transactions one report or account history reads, from the start of its range to today (fails closed above it). */
const MAX_RANGE_TRANSACTIONS = 250_000;
const MAX_AUDIT_COMMANDS = 100_000;
const MIN_FIRESTORE_TIMESTAMP = new Timestamp(-62_135_596_800, 0);
const MAX_FIRESTORE_TIMESTAMP = new Timestamp(253_402_300_799, 999_999_999);
const MAX_POST_CLOSE_ENTRIES_PER_DAY = 20_000;
const MAX_ACCESS_EVENTS = 20_000;
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
  collection: 'transactions' | 'commands' | 'postCloseEntries' | 'accessEvents';
  page: number;
  queryScope?: 'null-date-audit-range';
  committedAtRange?: { startInclusive: string; end: string; endInclusive: boolean };
}

export interface CloudReadRepositoryOptions {
  /** Test seam for bounded cursor paging; production reads 100 documents per page. */
  pageSize?: number;
  /** Test seam for the bounded access-event read; production fails closed above 20,000 events. */
  maxAccessEvents?: number;
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
  /** A student's audit is paged from the newest: `beforeSeq` (the oldest seq already shown) asks for the page before it. */
  | { studentId: string; leaseEpoch: number; beforeSeq?: number };

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
  pageTrace?: Pick<CloudReadPageEvent, 'queryScope' | 'committedAtRange'>,
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
    await afterPageRead?.({ collection: collectionName, page: pageNumber, ...pageTrace });
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

function taipeiAuditTimestampRange(range: CloudLedgerDateRange): {
  start: Timestamp;
  end: Timestamp;
  inclusiveEnd: boolean;
} {
  const taipeiOffsetMs = 8 * 60 * 60 * 1000;
  const startMs = Date.parse(`${range.startDate}T00:00:00.000Z`) - taipeiOffsetMs;
  const endMs = Date.parse(`${range.endDate}T00:00:00.000Z`) + 86_400_000 - taipeiOffsetMs;
  const minMs = MIN_FIRESTORE_TIMESTAMP.toMillis();
  const maxMs = MAX_FIRESTORE_TIMESTAMP.toMillis();
  const start = startMs < minMs ? MIN_FIRESTORE_TIMESTAMP : Timestamp.fromMillis(startMs);
  if (endMs > maxMs) return { start, end: MAX_FIRESTORE_TIMESTAMP, inclusiveEnd: true };
  return { start, end: Timestamp.fromMillis(endMs), inclusiveEnd: false };
}

interface DecodedAccessEvent {
  epoch: number;
  kind: CloudAccessEventRow['kind'];
  holderUid: string | null;
  previousHolderUid: string | null;
  actorUid: string;
  actorEmail: string;
  at: Timestamp;
}

function decodeAccessEvent(snapshot: { id: string; data: () => unknown }): DecodedAccessEvent {
  const value = snapshot.data();
  const uid = (candidate: unknown): candidate is string => typeof candidate === 'string' && candidate.length > 0;
  const nullableUid = (candidate: unknown): candidate is string | null => candidate === null || uid(candidate);
  const epoch = /^[1-9][0-9]*$/.test(snapshot.id) ? Number(snapshot.id) : 0;
  if (!Number.isSafeInteger(epoch) || epoch < 1
    || !exactKeys(value, ['kind', 'holderUid', 'previousHolderUid', 'actorUid', 'actorEmail', 'at'])
    || (value.kind !== 'acquire' && value.kind !== 'takeover' && value.kind !== 'release')
    || !nullableUid(value.holderUid) || !nullableUid(value.previousHolderUid)
    || !uid(value.actorUid) || !uid(value.actorEmail) || !(value.at instanceof Timestamp)) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `使用權交接紀錄 ${snapshot.id} 格式不支援`);
  }
  const kindMatches = value.kind === 'release'
    ? value.holderUid === null && value.previousHolderUid !== null
    : value.kind === 'acquire'
      ? value.holderUid !== null && value.previousHolderUid === null
      : value.holderUid !== null && value.previousHolderUid !== null;
  if (!kindMatches) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `使用權交接紀錄 ${snapshot.id} 的種類與前後持有人不一致`);
  }
  return {
    epoch,
    kind: value.kind,
    holderUid: value.holderUid,
    previousHolderUid: value.previousHolderUid,
    actorUid: value.actorUid,
    actorEmail: value.actorEmail,
    at: value.at,
  };
}

function decodeAuditCommand(snapshot: QueryDocumentSnapshot, headSeq: number): CloudAuditRow {
  let command: StoredEnabledCommandDoc;
  try {
    command = decodeEnabledCommandDoc(snapshot.data());
  } catch (error) {
    throw readFailure(error);
  }
  if (command.commandId !== snapshot.id || command.seq > headSeq) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `稽核 command ${snapshot.id} 與固定資料版本不一致`);
  }
  return {
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
  };
}

function assertUniqueAuditRows(rows: readonly CloudAuditRow[]): void {
  const ids = new Set<string>();
  const seqs = new Map<number, string>();
  for (const row of rows) {
    const seqOwner = seqs.get(row.seq);
    if (ids.has(row.commandId) || (seqOwner !== undefined && seqOwner !== row.commandId)) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '稽核範圍有重複 command ID 或資料序號');
    }
    ids.add(row.commandId);
    seqs.set(row.seq, row.commandId);
  }
}

function compareAuditSeq(left: CloudAuditRangeRow, right: CloudAuditRangeRow): number {
  return left.seq - right.seq || compareAscii(left.commandId, right.commandId);
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

/**
 * P16f2 S13: the day heads of a range for a summary: the day document and, for a day that has been closed, its latest settlement
 * (two reads a day at most, instead of every settlement version, the post-close entries and the back-fill marker). A summary day
 * therefore carries that one settlement, no post-close entries, no back-fill reason and no effective cash (`null`: it needs the
 * entries); the report of the range reads the whole.
 */
async function loadRangeHeads(
  db: Firestore,
  dates: readonly string[],
  context: ReadContext,
): Promise<CloudReportDay[]> {
  const days: CloudReportDay[] = [];
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
    if (day && (day.status === 'closed' || day.status === 'reopened') !== (day.lastSettlementRevision > 0)) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 狀態與日結版號不一致`);
    }
    const latest = day && day.lastSettlementRevision > 0
      ? await readCloudSettlementVersion(db, dayId, day.lastSettlementRevision).catch(error => { throw readFailure(error); })
      : null;
    if (day && day.lastSettlementRevision > 0) {
      if (latest === null) throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 缺少版號所指的日結版本`);
      if (latest.sourceSeq > context.head.sourceSeq) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 日結來源序號超過資料版本`);
      }
      if (day.status === 'closed' && (latest.status !== 'closed' || latest.countedCash === null)) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `已關帳日 ${dayId} 的最新日結版本不是關帳版本`);
      }
    }
    days.push({
      businessDate: dayId,
      exists: day !== null,
      status: day?.status ?? null,
      revision: day?.revision ?? null,
      openingCash: day?.openingCash ?? null,
      totals: dayTotals(day),
      lastSettlementRevision: day?.lastSettlementRevision ?? 0,
      backfillReason: null,
      settlements: latest ? [toReportSettlement(dayId, latest)] : [],
      postCloseEntries: [],
      effectiveCash: null,
    });
  }
  return days;
}

type TransactionRecord = ReturnType<typeof decodeCloudOrderTransaction>;

/**
 * Every transaction from `startDate` to today, everyone's or one student's, in the report order (business date, creation time,
 * id). The range of a report is the first part of it; the rest (the days after the range) is what the balances are worked back
 * through. A report of today reads today's transactions and nothing more.
 */
async function readTransactionsSince(
  db: Firestore,
  startDate: string,
  studentId: string | null,
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  afterPageRead?: CloudReadRepositoryOptions['afterPageRead'],
): Promise<TransactionRecord[]> {
  const paged = await readPaged(
    db,
    (cursor, pageLimit) => query(
      collection(db, 'transactions'),
      ...(studentId === null ? [] : [where('studentId', '==', studentId)]),
      where('businessDate', '>=', startDate),
      orderBy('businessDate'),
      orderBy('createdAt'),
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ),
    context, user, pageSize, MAX_RANGE_TRANSACTIONS, 'transactions', afterPageRead,
  );
  assertOrdered(paged.documents);
  return paged.documents.map(snapshot => decodeTransactionSnapshot(snapshot, context.head.sourceSeq));
}

function transactionEffect(record: TransactionRecord): number {
  return record.status === 'active' ? (record.type === 'refund' ? -record.amount : record.amount) : 0;
}

/**
 * The balance after each transaction of one account, worked back from the student's `currentBalance` (which the Rules check with
 * every command) through the account's transactions from the range start to today, `records` in report order. The whole history
 * is not read: the balance before the first of them is not needed, so it is not reconciled against the opening here (the backup
 * replay and the restore `verify` do that).
 */
function balancesBackFromCurrent(
  student: CloudStudentRecord,
  records: readonly TransactionRecord[],
  context: ReadContext,
): Map<string, number> {
  if (!isValidCloudGregorianDate(student.openingBalance.asOfDate)) {
    throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `學生 ${student.studentId} 期初日期不支援`);
  }
  const balances = new Map<string, number>();
  let balance = student.currentBalance;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (record.studentId !== student.studentId || record.type === 'expense' || record.businessDate < context.head.goLiveDate
      || record.businessDate < student.openingBalance.asOfDate || record.businessDate > context.leaseToday) {
      throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `帳戶 ${student.studentId} 的歷史交易日期或帳戶資料不一致`);
    }
    balances.set(record.transactionId, balance);
    balance -= transactionEffect(record);
    if (!Number.isSafeInteger(balance) || balance < -1_000_000_000 || balance > 1_000_000_000) {
      throw new CloudReadRepositoryError('RECONCILIATION_FAILED', `帳戶 ${student.studentId} 歷史餘額超出安全範圍`);
    }
  }
  return balances;
}

async function readStudent(db: Firestore, studentId: string): Promise<CloudStudentRecord | null> {
  const snapshot = await getDocFromServer(doc(db, studentPath(studentId)));
  assertServerConfirmed(snapshot, '學生文件');
  if (!snapshot.exists()) return null;
  try {
    return decodeCloudStudentRecord(snapshot.id, snapshot.data());
  } catch (error) {
    throw readFailure(error);
  }
}

function withBalance(
  record: TransactionRecord,
  backfills: ReadonlyMap<string, { dayId: string } | null>,
  balances: ReadonlyMap<string, number>,
  sourceSeq: number,
): CloudReportTransaction {
  const marker = backfills.get(record.businessDate) ?? null;
  const row = toReportTransaction(
    record,
    isBackfilled({ businessDate: record.businessDate, createdAt: Timestamp.fromDate(new Date(record.createdAt)) }, marker),
    sourceSeq,
  );
  if (record.studentId === '__cashier__') return { ...row, balanceApplicability: 'not-applicable' };
  const balance = balances.get(record.transactionId);
  if (balance === undefined) {
    throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `交易 ${record.transactionId} 沒有可驗證的帳戶餘額`);
  }
  return { ...row, afterBalance: balance, balanceApplicability: 'verified' };
}

/**
 * The commands of one student, newest first, until a page ends before `olderThan` (a command that is dated before the range was
 * committed before it ended, and sequence numbers grow with the commit time, so nothing older can belong to the range) or the
 * history ends. `olderThan` null reads one page only.
 */
async function readStudentCommandsNewestFirst(
  db: Firestore,
  studentId: string,
  context: ReadContext,
  user: CurrentUser,
  pageSize: number,
  options: { before: number | null; olderThan: Timestamp | null; afterPageRead?: CloudReadRepositoryOptions['afterPageRead'] },
): Promise<{ documents: QueryDocumentSnapshot[]; hasMore: boolean }> {
  const documents: QueryDocumentSnapshot[] = [];
  const bound = Math.min(options.before ?? Number.MAX_SAFE_INTEGER, context.head.sourceSeq + 1);
  let cursor: DocumentSnapshot | null = null;
  let pageNumber = 0;
  for (;;) {
    const pageLimit = pageSize + 1;
    const page: QuerySnapshot = await getDocsFromServer(query(
      collection(db, 'commands'),
      where('studentId', '==', studentId),
      where('seq', '<', bound),
      orderBy('seq', 'desc'),
      orderBy(documentId(), 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageLimit),
    ));
    assertServerConfirmed(page, 'commands');
    for (const snapshot of page.docs) assertServerConfirmed(snapshot, 'commands');
    pageNumber += 1;
    await options.afterPageRead?.({ collection: 'commands', page: pageNumber });
    await assertContextUnchanged(db, user, context);
    // one document more than a page tells whether there is an older one; it is not part of this page
    const hasMore = page.size > pageSize;
    const taken = hasMore ? page.docs.slice(0, pageSize) : page.docs;
    documents.push(...taken);
    if (documents.length > MAX_AUDIT_COMMANDS) {
      throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `稽核區間超過完整讀取上限 ${MAX_AUDIT_COMMANDS}`);
    }
    if (!hasMore || options.olderThan === null) return { documents, hasMore };
    const oldest = taken.at(-1)?.data().committedAt;
    if (oldest instanceof Timestamp && oldest.toMillis() < options.olderThan.toMillis()) return { documents, hasMore: true };
    cursor = taken.at(-1) ?? null;
    if (!cursor) return { documents, hasMore };
  }
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
      const days = await loadRangeHeads(db, dates, context);
      await assertContextUnchanged(db, user, context);
      return emptyReport(context, range, { studentId: null }, { days, dayRecords: new Map(), backfills: new Map() }, [], []);
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
      // the transactions from the start of the range to today (of everyone, or of the one student)
      const since = await readTransactionsSince(db, range.startDate, input.studentId, context, user, pageSize, options.afterPageRead);
      const inRange = since.filter(record => record.businessDate <= range.endDate);
      if (inRange.some(record => record.businessDate < context.head.goLiveDate)) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '系統啟用日前存在交易');
      }
      if (input.studentId === null) {
        // the full days of the range reconcile with their projections; a report of one student does not read the others' transactions
        for (const dayId of dates) {
          const records = inRange.filter(record => record.businessDate === dayId);
          if (records.length > MAX_DAY_TRANSACTIONS) {
            throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `雲端 transactions 超過完整讀取上限 ${MAX_DAY_TRANSACTIONS}`);
          }
          reconcileDayTotals(loaded.dayRecords.get(dayId) ?? null, records);
        }
      }
      const listed = await listCloudStudents(db, { currentUser: () => user });
      if (listed.datasetId !== context.head.datasetId || listed.seq !== context.head.sourceSeq
        || listed.goLiveDate !== context.head.goLiveDate) {
        throw new CloudReadRepositoryError('STALE_SNAPSHOT', '學生名單與報表資料版本不一致');
      }
      const studentById = new Map(listed.students.map(student => [student.studentId, student]));
      for (const record of since) {
        if (record.studentId !== '__cashier__' && !studentById.has(record.studentId)) {
          throw new CloudReadRepositoryError('RECONCILIATION_FAILED', `交易 ${record.transactionId} 指向不存在的學生`);
        }
      }
      const balances = new Map<string, number>();
      const accountIds = [...new Set(inRange.filter(record => record.studentId !== '__cashier__').map(record => record.studentId))].sort(compareAscii);
      for (const studentId of accountIds) {
        const student = studentById.get(studentId)!;
        const account = balancesBackFromCurrent(student, since.filter(record => record.studentId === studentId), context);
        for (const [transactionId, balance] of account) balances.set(transactionId, balance);
      }
      const transactions = inRange.map(record => withBalance(record, loaded.backfills, balances, context.head.sourceSeq));
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
      rangeDates(range);
      // the one student's document, not the roster
      const student = await readStudent(db, input.studentId);
      if (!student) throw new CloudReadRepositoryError('INVALID_INPUT', '查無此學生帳戶');
      const since = await readTransactionsSince(db, range.startDate, input.studentId, context, user, pageSize, options.afterPageRead);
      const inRange = since.filter(record => record.businessDate <= range.endDate);
      if (inRange.some(record => record.businessDate < context.head.goLiveDate)) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '系統啟用日前存在交易');
      }
      // the days of the range (projection, settlements, post-close entries, back-fill marker): the page needs them to decide what a
      // correction may touch, so the history carries them instead of the page reading a second report
      const loaded = await loadRange(db, rangeDates(range), context, user, pageSize, options.afterPageRead);
      const backfills = loaded.backfills;
      const balances = balancesBackFromCurrent(student, since, context);
      const transactions = inRange.map(record => withBalance(record, backfills, balances, context.head.sourceSeq));
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
        studentStatus: student.status,
        studentRevision: student.revision,
        openingBalance: student.openingBalance.amount,
        currentBalance: student.currentBalance,
        days: loaded.days,
        settlements: loaded.days.flatMap(day => day.settlements),
        postCloseEntries: loaded.days.flatMap(day => day.postCloseEntries),
        transactions,
      };
    } catch (error) {
      throw readFailure(error);
    }
  }

  async function readAuditRange(input: CloudReportInput): Promise<CloudAuditRangeSnapshot> {
    try {
      validateEpoch(input.leaseEpoch);
      if (input.studentId !== null) validateStudentId(input.studentId);
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      const range = validateRange(input.range);
      const auditRows: CloudAuditRow[] = [];

      if (input.studentId === null) {
        const dates = rangeDates(range);
        for (const dayId of dates) {
          const queryBase = (cursor: DocumentSnapshot | null, pageLimit: number) => query(
            collection(db, 'commands'),
            where('businessDate', '==', dayId),
            orderBy('seq'),
            orderBy(documentId()),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(pageLimit),
          );
          const paged = await readPaged(db, queryBase, context, user, pageSize, MAX_AUDIT_COMMANDS, 'commands', options.afterPageRead);
          const dayRows = paged.documents.map(snapshot => {
            const row = decodeAuditCommand(snapshot, context.head.sourceSeq);
            if (row.businessDate !== dayId) {
              throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `稽核 command ${snapshot.id} 與查詢營業日不一致`);
            }
            return row;
          });
          assertUniqueAuditRows(dayRows);
          auditRows.push(...dayRows);
          if (auditRows.length > MAX_AUDIT_COMMANDS) {
            throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `稽核區間超過完整讀取上限 ${MAX_AUDIT_COMMANDS}`);
          }
        }

        const timestamps = taipeiAuditTimestampRange(range);
        const nullDateQuery = (cursor: DocumentSnapshot | null, pageLimit: number) => query(
          collection(db, 'commands'),
          where('businessDate', '==', null),
          where('committedAt', '>=', timestamps.start),
          ...(timestamps.inclusiveEnd
            ? [where('committedAt', '<=', timestamps.end)]
            : [where('committedAt', '<', timestamps.end)]),
          orderBy('committedAt'),
          orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []),
          limit(pageLimit),
        );
        const committedAtRange = {
          startInclusive: timestamps.start.toDate().toISOString(),
          end: timestamps.end.toDate().toISOString(),
          endInclusive: timestamps.inclusiveEnd,
        };
        const paged = await readPaged(
          db, nullDateQuery, context, user, pageSize, MAX_AUDIT_COMMANDS, 'commands', options.afterPageRead,
          { queryScope: 'null-date-audit-range', committedAtRange },
        );
        const rangeRows = paged.documents.map(snapshot => {
          const row = decodeAuditCommand(snapshot, context.head.sourceSeq);
          if (row.businessDate !== null) {
            throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `稽核 command ${snapshot.id} 的日期 scope 不一致`);
          }
          const attributed = attributeCloudAuditDate(row);
          if (attributed.attributedDate < range.startDate || attributed.attributedDate > range.endDate) {
            throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `稽核 command ${snapshot.id} 超出伺服器日期查詢界線`);
          }
          return row;
        });
        auditRows.push(...rangeRows);
      } else {
        // the student's commands from the newest back to the start of the range, not the whole history
        const { documents } = await readStudentCommandsNewestFirst(db, input.studentId, context, user, pageSize, {
          before: null, olderThan: taipeiAuditTimestampRange(range).start, afterPageRead: options.afterPageRead,
        });
        for (const snapshot of documents) {
          const row = decodeAuditCommand(snapshot, context.head.sourceSeq);
          if (row.studentId !== input.studentId) {
            throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', `稽核 command ${snapshot.id} 與查詢帳戶不一致`);
          }
          auditRows.push(row);
        }
      }

      assertUniqueAuditRows(auditRows);
      const rows = auditRows
        .map(attributeCloudAuditDate)
        .filter(row => row.attributedDate >= range.startDate && row.attributedDate <= range.endDate)
        .sort(compareAuditSeq);
      if (rows.length > MAX_AUDIT_COMMANDS) {
        throw new CloudReadRepositoryError('INCOMPLETE_SNAPSHOT', `稽核區間超過完整讀取上限 ${MAX_AUDIT_COMMANDS}`);
      }
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
        rows,
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
      } else {
        validateStudentId(input.studentId);
        if (input.beforeSeq !== undefined && !integer(input.beforeSeq, 1)) {
          throw new CloudReadRepositoryError('INVALID_INPUT', '稽核分頁起點不正確');
        }
      }
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      let documents: QueryDocumentSnapshot[];
      let hasMore = false;
      if (isDay) {
        documents = (await readPaged(
          db,
          (cursor, pageLimit) => query(
            collection(db, 'commands'),
            where('businessDate', '==', input.dayId),
            where('seq', '<=', context.head.sourceSeq),
            orderBy('seq'),
            orderBy(documentId()),
            ...(cursor ? [startAfter(cursor)] : []),
            limit(pageLimit),
          ),
          context, user, pageSize, MAX_AUDIT_COMMANDS, 'commands', options.afterPageRead,
        )).documents;
      } else {
        // the newest page of the student's commands; the older ones follow with `beforeSeq` set to the oldest seq shown
        ({ documents, hasMore } = await readStudentCommandsNewestFirst(db, input.studentId, context, user, pageSize, {
          before: input.beforeSeq ?? null, olderThan: null, afterPageRead: options.afterPageRead,
        }));
        documents = [...documents].reverse();
      }
      const rows: CloudAuditRow[] = [];
      let previousSeq = 0;
      for (const snapshot of documents) {
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
        hasMore,
        rows,
      };
    } catch (error) {
      throw readFailure(error);
    }
  }

  async function readAccessEvents(input: CloudSummaryInput): Promise<CloudAccessEventsSnapshot> {
    try {
      validateEpoch(input.leaseEpoch);
      const user = requireGoogleUser(options);
      const context = await readContext(db, user);
      validateSnapshotScope(context, input.leaseEpoch);
      const range = validateRange(input.range);
      const timestamps = taipeiAuditTimestampRange(range);
      const maxEvents = options.maxAccessEvents ?? MAX_ACCESS_EVENTS;
      const queryBase = (cursor: DocumentSnapshot | null, pageLimit: number) => query(
        collection(db, 'accessEvents'),
        where('at', '>=', timestamps.start),
        ...(timestamps.inclusiveEnd ? [where('at', '<=', timestamps.end)] : [where('at', '<', timestamps.end)]),
        orderBy('at'),
        orderBy(documentId()),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(pageLimit),
      );
      const paged = await readPaged(
        db, queryBase, context, user, pageSize, maxEvents, 'accessEvents', options.afterPageRead,
      );
      const events = paged.documents
        .map(decodeAccessEvent)
        .sort((left, right) => left.epoch - right.epoch);
      // A lease that moved on is a stale read, not a malformed event: settle that before judging the epochs.
      await assertContextUnchanged(db, user, context);
      if (events.some(event => event.epoch > context.leaseEpoch)) {
        throw new CloudReadRepositoryError('UNSUPPORTED_SCHEMA', '使用權交接紀錄超過目前租約世代');
      }

      const known = new Map(events.map(event => [event.epoch, event]));
      const predecessorOf = async (epoch: number): Promise<DecodedAccessEvent | null> => {
        if (epoch < 2) return null;
        const inRange = known.get(epoch - 1);
        if (inRange) return inRange;
        const snapshot = await getDocFromServer(doc(db, accessEventPath(epoch - 1)));
        assertServerConfirmed(snapshot, 'accessEvents');
        if (!snapshot.exists()) return null;
        const decoded = decodeAccessEvent(snapshot);
        known.set(decoded.epoch, decoded);
        return decoded;
      };

      const rows: CloudAccessEventRow[] = [];
      for (const event of events) {
        let previousHolderState: CloudAccessEventRow['previousHolderState'] = 'none';
        let previousHolderEmail: string | null = null;
        if (event.previousHolderUid !== null) {
          const predecessor = await predecessorOf(event.epoch);
          // The previous holder's own event names them as actor; anything else is not proof of their email.
          if (predecessor && predecessor.holderUid === event.previousHolderUid
            && predecessor.actorUid === event.previousHolderUid) {
            previousHolderState = 'known';
            previousHolderEmail = predecessor.actorEmail;
          } else {
            previousHolderState = 'unrecorded';
          }
        }
        rows.push({
          epoch: event.epoch,
          kind: event.kind,
          at: event.at.toDate().toISOString(),
          actorEmail: event.actorEmail,
          previousHolderState,
          previousHolderEmail,
        });
      }

      await assertContextUnchanged(db, user, context);
      return {
        datasetId: context.head.datasetId,
        sourceSeq: context.head.sourceSeq,
        goLiveDate: context.head.goLiveDate,
        leaseToday: context.leaseToday,
        leaseEpoch: context.leaseEpoch,
        range,
        complete: true,
        rows,
      };
    } catch (error) {
      throw readFailure(error);
    }
  }

  return { readSummary, readReport, readAccountHistory, readAudit, readAuditRange, readAccessEvents };
}
