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
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import {
  InvalidCloudCommandInput, decodeBackfillDoc, decodePostCloseEntryDoc, decodeSettlementDoc, normalizeEnabledCommandInput,
  settlementExpectedCash, type CanonicalEnabledInput,
} from '../domain/cloudCommandSchema';
import {
  CloudCommandReadError, createCloudCommandRepository, type CloudCommandRepositoryOptions, type PendingIntentCheck,
} from './cloudCommandRepository';
import { cloudPendingJournalForRepository } from './cloudPendingJournal';
import type { CloudRecoveryReader } from './cloudRecoveryReader';
import {
  computeLedgerAnomalies, type LedgerAnomaly, type LedgerAnomalyDay, type PreviousClosedDay,
} from '../domain/ledgerAnomalies';
import { postCloseNet, type PostCloseEntry } from '../domain/postCloseEntries';
import { accessLeasePath, backfillDayPath, dataHeadPath, dayPath, postCloseEntriesCollectionPath, settlementPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

/** P11 settlement versions per day are small; more than this is out of spec and fails closed. */
const MAX_SETTLEMENT_VERSIONS = 200;
/** Unclosed days are closed daily; more than this means the overview cannot be shown completely. */
const MAX_UNCLOSED_DAYS = 200;
/** Business-day documents per page of the anomaly scan (contract §11.2). */
const LEDGER_PAGE_SIZE = 200;
/** Fail-closed ceiling for one full scan (about 55 years of daily documents), never a silent truncation. */
const MAX_SCANNED_DAYS = 20_000;
/** Calendar days per query when walking back to the previous closed day (contract §11.2). */
const PREVIOUS_CLOSED_SEGMENT_DAYS = 31;
/** Fail-closed ceiling for all post-close entries one scan reads (contract §15.3); entries are rare manual fixes. */
const MAX_POST_CLOSE_ENTRIES = 20_000;
/** `in` queries accept at most 30 values; the overview looks up backfill markers in chunks. */
const MARKER_QUERY_CHUNK = 30;

export type CloudDayCloseReadErrorCode = CommandErrorCode | 'INCOMPLETE_SNAPSHOT' | 'STALE_SNAPSHOT';

export class CloudDayCloseRepositoryError extends Error {
  readonly code: CloudDayCloseReadErrorCode;

  constructor(code: CloudDayCloseReadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudDayCloseRepositoryError';
  }
}

/**
 * Thrown by `commitDayCloseIntent` when the caller's guard no longer holds just before the commit. Nothing was
 * written: no journal record, no transaction. The caller decides whether its operation is still pending.
 */
export class CloudDayCloseGuardRejected extends Error {
  constructor() {
    super('命令送出前的條件已改變，這次沒有送出');
    this.name = 'CloudDayCloseGuardRejected';
  }
}

export interface CloudDayTotals {
  activeTransactionCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  retainedReceipts: number;
  cashierIncome: number;
  cashierExpense: number;
  accountRefunds: number;
}

export interface CloudSettlementVersion {
  revision: number;
  status: 'closed' | 'reopened';
  totals: CloudDayTotals;
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
}

export interface CloudDayCloseState {
  dayId: string;
  status: 'open' | 'closed' | 'reopened';
  revision: number;
  openingCash: number | null;
  totals: CloudDayTotals;
  lastSettlementRevision: number;
  /** Spec §7.1 expectedCash; null until openingCash is confirmed (closing is not allowed then). */
  expectedCash: number | null;
  /** Oldest first; versions 1..lastSettlementRevision, all present. */
  settlements: CloudSettlementVersion[];
  /**
   * P11c4a: every post-close entry of this day, oldest first (contract §15). Only those whose
   * `settlementRevision` equals `lastSettlementRevision` count toward `effectiveCash`; older ones are history.
   */
  postCloseEntries: PostCloseEntry[];
  /** Latest counted cash + counted entries' net while the day is closed (contract §15.3); null otherwise. */
  effectiveCash: number | null;
  seq: number;
}

/**
 * How an unclosed day is shown on the close page (contract §7). Only `needs-close` can be closed now;
 * `no-business` is a past day without opening cash or transactions (for example one EnsureDay created
 * for an opening correction) and is not a missing close; `missing-opening` has transactions or is today.
 * A past day without opening cash (either kind) can get its opening cash backfilled with a reason and
 * then be closed (contract §10).
 */
export type UnclosedDayKind = 'needs-close' | 'missing-opening' | 'no-business';

export interface CloudUnclosedDay {
  dayId: string;
  status: 'open' | 'reopened';
  openingCash: number | null;
  activeTransactionCount: number;
  kind: UnclosedDayKind;
  /** The day is being backfilled (contract §12); null for an ordinary day. */
  backfill: CloudBackfillDay | null;
}

/** `backfillDays/{dayId}`: the immutable mark that a past day is being backfilled, with its reason. */
export interface CloudBackfillDay {
  dayId: string;
  reason: string;
  startedBy: string;
  startedAt: Date;
  commandId: string;
}

/**
 * A transaction is backfilled when its day carries a backfill marker and the Taipei date it was created on
 * is later than its business date. Rules guarantee both facts, so no new transaction field exists (contract §12).
 */
export function isBackfilled(
  transaction: { businessDate: string; createdAt: Date | Timestamp },
  backfill: Pick<CloudBackfillDay, 'dayId'> | null,
): boolean {
  if (!backfill || backfill.dayId !== transaction.businessDate) return false;
  const createdAt = transaction.createdAt instanceof Timestamp ? transaction.createdAt : Timestamp.fromDate(transaction.createdAt);
  return taipeiDate(createdAt) > transaction.businessDate;
}

export interface CloudDayCloseOverview {
  /** Taipei date of the server lease time; the browser clock never decides the business day. */
  selectionDate: string;
  goLiveDate: string;
  /** Open or reopened days up to selectionDate, oldest first. Future pre-scheduled days are left out. */
  unclosedDays: CloudUnclosedDay[];
  seq: number;
}

export function classifyUnclosedDay(
  day: { dayId: string; openingCash: number | null; activeTransactionCount: number },
  selectionDate: string,
): UnclosedDayKind {
  if (day.openingCash !== null) return 'needs-close';
  return day.dayId < selectionDate && day.activeTransactionCount === 0 ? 'no-business' : 'missing-opening';
}

export interface CloseCloudDayInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  expectedDayRevision: number;
  expectedSettlementRevision: number;
  expectedCash: number;
  countedCash: number;
  note: string;
  /**
   * P11c3: set only for a back-filled day. The day the close aligns with (the nearest opened day after it,
   * as the day-close page showed it) or null when no later day is opened. Leave it out on ordinary days.
   */
  alignWithDayId?: string | null;
}

export interface EnsureCloudDayInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
}

export interface StartCloudBackfillInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  expectedDayRevision: number;
  reason: string;
}

export interface RecordCloudPostCloseEntryInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  expectedDayRevision: number;
  /** The day's `lastSettlementRevision` the entry is recorded against; it must be a closed day (contract §15). */
  expectedSettlementRevision: number;
  direction: 'income' | 'expense';
  amount: number;
  reason: string;
}

export interface ReopenCloudDayInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  expectedDayRevision: number;
  expectedSettlementRevision: number;
  reason: string;
}

export interface BackfillCloudDayOpeningInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  expectedDayRevision: number;
  openingCash: number;
  reason: string;
}

export type CloudDayCloseRepositoryOptions = CloudCommandRepositoryOptions & {
  /** Recovery-only Lite reader; normal writes and full snapshots keep using Firestore SDK. */
  recoveryReader?: CloudRecoveryReader;
};

/** The six command variants the close page sends; each pairs a kind with the typed input the writer takes. */
export type CloudDayCloseCommandIntent =
  | { kind: 'close-day'; input: CloseCloudDayInput }
  | { kind: 'record-post-close-entry'; input: RecordCloudPostCloseEntryInput }
  | { kind: 'reopen-day'; input: ReopenCloudDayInput }
  | { kind: 'backfill-opening'; input: BackfillCloudDayOpeningInput }
  | { kind: 'ensure-day'; input: EnsureCloudDayInput }
  | { kind: 'start-backfill'; input: StartCloudBackfillInput };

/** Checked right before a commit; `false` means the caller's ownership or business precondition no longer holds. */
export type CloudDayCloseCommitGuard = () => boolean | Promise<boolean>;

export type CloudDayClosePreviousLookupView =
  | { status: 'ready'; previous: PreviousClosedDay | null }
  | { status: 'error'; message: string };

export type CloudDayCloseAlignLookupView =
  | { status: 'ready'; next: { dayId: string; openingCash: number } | null }
  | { status: 'error'; message: string };

/** One page read: every part comes from one dataset and one data head seq. */
export interface CloudDayCloseSnapshot {
  datasetId: string;
  overview: CloudDayCloseOverview;
  dayId: string;
  /** null when the day document does not exist. */
  day: CloudDayCloseState | null;
  /** The backfill marker of an open day; null for an ordinary day. */
  backfill: CloudBackfillDay | null;
  /** Only looked up while the backfill form may ask for an opening cash. */
  previous: CloudDayClosePreviousLookupView | null;
  /** Only looked up for a back-filled day that is still open and has its opening cash. */
  align: CloudDayCloseAlignLookupView | null;
}

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function integer(value: unknown, minimum: number, maximum = 1_000_000_000): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
}

function assertServerConfirmed(snapshot: { metadata: { fromCache: boolean; hasPendingWrites: boolean } }, source: string): void {
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
    throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `${source} 含快取或未確認的本機寫入`);
  }
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const TOTALS_KEYS = [
  'activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense', 'accountRefunds',
] as const;

function decodeTotals(value: unknown, label: string): CloudDayTotals {
  if (!plainRecord(value) || Object.keys(value).length !== TOTALS_KEYS.length
    || !TOTALS_KEYS.every(key => integer(value[key], 0))) {
    throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `${label} 統計 schema 不支援`);
  }
  return Object.fromEntries(TOTALS_KEYS.map(key => [key, value[key]])) as unknown as CloudDayTotals;
}

function decodeDay(dayId: string, value: unknown) {
  if (!plainRecord(value) || !['open', 'closed', 'reopened'].includes(String(value.status))
    || !integer(value.revision, 1, Number.MAX_SAFE_INTEGER)
    || !integer(value.lastSettlementRevision, 0, MAX_SETTLEMENT_VERSIONS)
    || (value.openingCash !== null && !integer(value.openingCash, 0, 20_000))) {
    throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日文件 ${dayId} schema 不支援`);
  }
  const totals = decodeTotals(value.totals, `營業日 ${dayId}`);
  return {
    status: value.status as CloudDayCloseState['status'],
    revision: value.revision,
    openingCash: value.openingCash as number | null,
    totals,
    lastSettlementRevision: value.lastSettlementRevision,
  };
}

function toVersion(dayId: string, revision: number, value: unknown): CloudSettlementVersion {
  let settlement: Data;
  try {
    settlement = decodeSettlementDoc(value, dayId, revision);
  } catch (error) {
    if (error instanceof InvalidCloudCommandInput) {
      throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `日結版本 ${dayId}#${revision} schema 不支援`);
    }
    throw error;
  }
  return {
    revision,
    status: settlement.status as CloudSettlementVersion['status'],
    totals: decodeTotals(settlement.totals, `日結版本 ${dayId}#${revision}`),
    openingCash: settlement.openingCash as number,
    expectedCash: settlement.expectedCash as number,
    countedCash: settlement.countedCash as number | null,
    difference: settlement.difference as number | null,
    note: settlement.note as string,
    actorUid: settlement.actorUid as string,
    actorEmail: settlement.actorEmail as string,
    sourceSeq: settlement.sourceSeq as number,
    committedAt: (settlement.committedAt as Timestamp).toDate().toISOString(),
    lastCommandId: settlement.lastCommandId as string,
  };
}

function decodePostCloseEntry(entryId: string, value: unknown): PostCloseEntry {
  try {
    const entry = decodePostCloseEntryDoc(value, entryId);
    return {
      entryId,
      dayId: entry.dayId as string,
      settlementRevision: entry.settlementRevision as number,
      direction: entry.direction as PostCloseEntry['direction'],
      amount: entry.amount as number,
      reason: entry.reason as string,
      createdBy: entry.createdBy as string,
      createdAt: (entry.createdAt as Timestamp).toDate(),
      commandId: entry.commandId as string,
    };
  } catch (error) {
    if (error instanceof InvalidCloudCommandInput) {
      throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `關帳後補記 ${entryId} schema 不支援`);
    }
    throw error;
  }
}

/**
 * Post-close entries from the server, one page at a time in document-ID order (`startAfter`), for one day or
 * all days. `afterPage` runs after every page (the head comparison); any failure fails the whole read.
 */
async function readPostCloseEntries(
  db: Firestore,
  dayId: string | null,
  pageSize: number,
  afterPage?: () => Promise<void>,
): Promise<PostCloseEntry[]> {
  const entries: PostCloseEntry[] = [];
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const page: QuerySnapshot<DocumentData> = await getDocsFromServer(query(
      collection(db, postCloseEntriesCollectionPath()),
      ...(dayId ? [where('dayId', '==', dayId)] : []),
      orderBy(documentId()),
      ...(last ? [startAfter(last)] : []),
      limit(pageSize),
    ));
    assertServerConfirmed(page, '關帳後補記');
    for (const snapshot of page.docs) assertServerConfirmed(snapshot, '關帳後補記');
    for (const snapshot of page.docs) {
      if (entries.length >= MAX_POST_CLOSE_ENTRIES) {
        throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `關帳後補記超過 ${MAX_POST_CLOSE_ENTRIES} 筆，無法完整計算有效關帳現金`);
      }
      const entry = decodePostCloseEntry(snapshot.id, snapshot.data());
      if (dayId !== null && entry.dayId !== dayId) {
        throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `關帳後補記 ${snapshot.id} 的日期與查詢不一致`);
      }
      entries.push(entry);
    }
    if (afterPage) await afterPage();
    if (page.size < pageSize) break;
    last = page.docs[page.docs.length - 1] ?? null;
  }
  return entries;
}

function readError(error: unknown): CloudDayCloseRepositoryError {
  if (error instanceof CloudDayCloseRepositoryError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return new CloudDayCloseRepositoryError('LEASE_LOST', '目前帳號沒有讀取日結的有效使用權');
  if (code.includes('unauthenticated')) return new CloudDayCloseRepositoryError('UNAUTHORIZED', '請重新登入 Google 操作員帳號');
  if (code.includes('resource-exhausted')) return new CloudDayCloseRepositoryError('QUOTA_EXCEEDED', '目前讀取次數已達服務限制');
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) {
    return new CloudDayCloseRepositoryError('OFFLINE', '無法連線確認雲端日結');
  }
  return new CloudDayCloseRepositoryError('UNKNOWN_RESULT', '無法從伺服器確認日結');
}

function assertAuthenticated(options: CloudCommandRepositoryOptions): CurrentUser {
  let user: CurrentUser | null;
  try {
    user = options.currentUser ? options.currentUser() : getAuth().currentUser;
  } catch {
    user = null;
  }
  if (!user || !user.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new CloudDayCloseRepositoryError('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
  return user;
}

function decodeBackfill(dayId: string, value: unknown): CloudBackfillDay {
  const decoded = decodeBackfillDoc(value, dayId) as {
    reason: string; startedBy: string; startedAt: Timestamp; commandId: string;
  };
  return { dayId, reason: decoded.reason, startedBy: decoded.startedBy, startedAt: decoded.startedAt.toDate(), commandId: decoded.commandId };
}

/** Server-only read of one day's backfill marker; null when the day is not being backfilled. */
export async function readCloudBackfillDay(db: Firestore, dayId: string): Promise<CloudBackfillDay | null> {
  try {
    if (!validDate(dayId)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', '營業日格式不支援');
    const snapshot = await getDocFromServer(doc(db, backfillDayPath(dayId)));
    assertServerConfirmed(snapshot, `回填標記 ${dayId}`);
    return snapshot.exists() ? decodeBackfill(dayId, snapshot.data()) : null;
  } catch (error) {
    throw readError(error);
  }
}

async function readHeadSeq(db: Firestore): Promise<{ seq: number; datasetId: string; goLiveDate: string }> {
  const snapshot = await getDocFromServer(doc(db, dataHeadPath()));
  assertServerConfirmed(snapshot, 'dataHead');
  const value: unknown = snapshot.exists() ? snapshot.data() : null;
  if (!plainRecord(value) || !integer(value.seq, 0, Number.MAX_SAFE_INTEGER) || typeof value.datasetId !== 'string') {
    throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 尚未初始化或 schema 不支援');
  }
  if (value.maintenance === true) throw new CloudDayCloseRepositoryError('MAINTENANCE', '系統正在維護，暫停讀取日結');
  if (!validDate(value.goLiveDate)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 缺少系統啟用日期');
  return { seq: value.seq, datasetId: value.datasetId, goLiveDate: value.goLiveDate };
}

function taipeiDate(timestamp: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp.toDate());
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function readLeaseDate(db: Firestore, user: CurrentUser): Promise<string> {
  const lease = await getDocFromServer(doc(db, accessLeasePath()));
  assertServerConfirmed(lease, 'accessLease');
  const leaseValue: unknown = lease.exists() ? lease.data() : null;
  if (!plainRecord(leaseValue) || leaseValue.holderUid !== user.uid || !(leaseValue.updatedAt instanceof Timestamp)) {
    throw new CloudDayCloseRepositoryError('LEASE_LOST', '目前沒有有效的伺服器使用權租約');
  }
  return taipeiDate(leaseValue.updatedAt);
}

/**
 * Server-only list of every open or reopened day up to the lease date, classified for the close page.
 * More than MAX_UNCLOSED_DAYS such days, or a head that moves during the read, fails closed.
 */
export async function readCloudDayCloseOverview(
  db: Firestore,
  options: CloudCommandRepositoryOptions = {},
): Promise<CloudDayCloseOverview> {
  try {
    const user = assertAuthenticated(options);
    const before = await readHeadSeq(db);
    const selectionDate = await readLeaseDate(db, user);
    const page = await getDocsFromServer(query(
      collection(db, 'days'),
      where('status', 'in', ['open', 'reopened']),
      limit(MAX_UNCLOSED_DAYS + 1),
    ));
    if (page.size > MAX_UNCLOSED_DAYS) {
      throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `未關帳營業日超過 ${MAX_UNCLOSED_DAYS} 天，無法完整列出`);
    }
    const markers = new Map<string, CloudBackfillDay>();
    const candidateIds = page.docs.map(snapshot => snapshot.id).filter(id => validDate(id) && id < selectionDate);
    for (let index = 0; index < candidateIds.length; index += MARKER_QUERY_CHUNK) {
      const chunk = await getDocsFromServer(query(
        collection(db, 'backfillDays'),
        where(documentId(), 'in', candidateIds.slice(index, index + MARKER_QUERY_CHUNK)),
      ));
      for (const snapshot of chunk.docs) markers.set(snapshot.id, decodeBackfill(snapshot.id, snapshot.data()));
    }
    const unclosedDays = page.docs
      .map(snapshot => {
        if (!validDate(snapshot.id)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 路徑不支援`);
        const day = decodeDay(snapshot.id, snapshot.data());
        if (day.status === 'closed') throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 狀態不符查詢條件`);
        const entry = {
          dayId: snapshot.id,
          status: day.status,
          openingCash: day.openingCash,
          activeTransactionCount: day.totals.activeTransactionCount,
        };
        return { ...entry, kind: classifyUnclosedDay(entry, selectionDate), backfill: markers.get(snapshot.id) ?? null };
      })
      .filter(day => day.dayId <= selectionDate)
      .sort((left, right) => left.dayId.localeCompare(right.dayId));
    const after = await readHeadSeq(db);
    if (after.seq !== before.seq || after.datasetId !== before.datasetId) {
      throw new CloudDayCloseRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料有更新，請重新載入日結');
    }
    return { selectionDate, goLiveDate: before.goLiveDate, unclosedDays, seq: after.seq };
  } catch (error) {
    throw readError(error);
  }
}

/**
 * Days that are being backfilled right now and can still take transactions: marker present, day open and never
 * closed (a reopened day was closed once, so Rules refuse transactions on it). Oldest first.
 */
export async function listCloudBackfillingDays(
  db: Firestore,
  options: CloudCommandRepositoryOptions = {},
): Promise<CloudBackfillDay[]> {
  const overview = await readCloudDayCloseOverview(db, options);
  return overview.unclosedDays
    .filter(day => day.backfill !== null && day.status === 'open')
    .map(day => day.backfill as CloudBackfillDay);
}

/**
 * Server-only read of one day's close state and its complete settlement history. The versions must be
 * exactly 1..lastSettlementRevision, and the head must not move during the read; otherwise fail closed.
 * Returns null when the day document does not exist.
 */
export async function readCloudDayClose(
  db: Firestore,
  dayId: string,
  options: CloudCommandRepositoryOptions = {},
): Promise<CloudDayCloseState | null> {
  try {
    assertAuthenticated(options);
    if (!validDate(dayId)) throw new CloudDayCloseRepositoryError('INVALID_INPUT', '營業日日期格式不正確');
    const before = await readHeadSeq(db);
    const daySnapshot = await getDocFromServer(doc(db, dayPath(dayId)));
    assertServerConfirmed(daySnapshot, `營業日 ${dayId}`);
    if (!daySnapshot.exists()) return null;
    const day = decodeDay(dayId, daySnapshot.data());
    const page = await getDocsFromServer(collection(db, dayPath(dayId), 'settlements'));
    assertServerConfirmed(page, `營業日 ${dayId} 日結版本`);
    for (const snapshot of page.docs) assertServerConfirmed(snapshot, `營業日 ${dayId} 日結版本`);
    if (page.size !== day.lastSettlementRevision) {
      throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${dayId} 的日結版本數與版號不一致`);
    }
    const settlements = page.docs
      .map(snapshot => {
        const revision = Number(snapshot.id);
        if (!integer(revision, 1, day.lastSettlementRevision) || String(revision) !== snapshot.id) {
          throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `日結版本 ${dayId}/${snapshot.id} 路徑不支援`);
        }
        return toVersion(dayId, revision, snapshot.data());
      })
      .sort((left, right) => left.revision - right.revision);
    if (settlements.some((version, index) => version.revision !== index + 1)) {
      throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${dayId} 的日結版本不連續`);
    }
    const latest = settlements.at(-1);
    if (latest && latest.status !== (day.status === 'closed' ? 'closed' : 'reopened')) {
      throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 狀態與最新日結版本不一致`);
    }
    const postCloseEntries = day.lastSettlementRevision > 0
      ? (await readPostCloseEntries(db, dayId, LEDGER_PAGE_SIZE))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.entryId.localeCompare(right.entryId))
      : [];
    if (postCloseEntries.some(entry => entry.settlementRevision > day.lastSettlementRevision)) {
      throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 有補記指向不存在的日結版本`);
    }
    const after = await readHeadSeq(db);
    if (after.seq !== before.seq || after.datasetId !== before.datasetId) {
      throw new CloudDayCloseRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料有更新，請重新載入日結');
    }
    const closedCount = day.status === 'closed' ? latest?.countedCash ?? null : null;
    return {
      dayId,
      ...day,
      expectedCash: day.openingCash === null ? null : settlementExpectedCash(day),
      settlements,
      postCloseEntries,
      effectiveCash: closedCount === null ? null : closedCount + postCloseNet(postCloseEntries, day.lastSettlementRevision),
      seq: after.seq,
    };
  } catch (error) {
    throw readError(error);
  }
}

export interface CloudLedgerSnapshot {
  /** Taipei date of the server lease time. */
  today: string;
  goLiveDate: string;
  /** Sorted by date; see `computeLedgerAnomalies`. */
  anomalies: LedgerAnomaly[];
  /** Every closed day up to today with its latest settlement's counted cash, oldest first. */
  closedDays: PreviousClosedDay[];
  seq: number;
}

export interface CloudPreviousClosedLookup {
  /** The latest closed day dated before the asked day, or null when none exists back to goLiveDate. */
  previous: PreviousClosedDay | null;
  seq: number;
}

export interface CloudNextOpenedLookup {
  /** The nearest day dated after the asked day whose opening cash is confirmed, or null when none exists up to today. */
  next: { dayId: string; openingCash: number } | null;
  seq: number;
}

export interface CloudLedgerReaderTuning {
  /** Documents per scan page (default 200). */
  pageSize?: number;
  /** Calendar days per previous-closed-day segment (default 31). */
  segmentDays?: number;
}

/** Settlement versions are immutable, so closed days' latest counted cash is kept per Firestore instance. */
const settlementCaches = new WeakMap<object, Map<string, number>>();

function settlementCacheFor(db: Firestore): Map<string, number> {
  let cache = settlementCaches.get(db);
  if (!cache) {
    cache = new Map();
    settlementCaches.set(db, cache);
  }
  return cache;
}

function addCalendarDays(dayId: string, days: number): string {
  return new Date(Date.parse(`${dayId}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Server-only ledger reads (contract §11.2). `read()` is the full anomaly scan: business-day documents from
 * goLiveDate to the lease date, in ascending document-ID order, one page at a time with `startAfter`; the
 * data head is compared after every page, so a change during the scan is `STALE_SNAPSHOT`, and the number of
 * reads is about the number of business days. `findPreviousClosed(dayId)` is the cheap lookup the opening
 * form and the `SetOpeningCash` writer share: it walks back from dayId in segments of calendar days and
 * stops at the first closed day, so it never depends on how long the history is. Settlement versions are
 * immutable, so the latest counted cash of a closed day is cached per Firestore instance.
 */
export function createCloudLedgerReader(
  db: Firestore,
  options: CloudCommandRepositoryOptions = {},
  tuning: CloudLedgerReaderTuning = {},
) {
  const pageSize = tuning.pageSize ?? LEDGER_PAGE_SIZE;
  const segmentDays = tuning.segmentDays ?? PREVIOUS_CLOSED_SEGMENT_DAYS;
  const settlementCache = settlementCacheFor(db);

  async function countedCashOf(datasetId: string, dayId: string, day: ReturnType<typeof decodeDay>): Promise<number> {
    if (day.lastSettlementRevision < 1) {
      throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `已關帳營業日 ${dayId} 沒有日結版本`);
    }
    const key = `${datasetId}/${dayId}/${day.lastSettlementRevision}`;
    let cached = settlementCache.get(key);
    if (cached === undefined) {
      const latest = await getDocFromServer(doc(db, settlementPath(dayId, day.lastSettlementRevision)));
      if (!latest.exists()) {
        throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${dayId} 缺少最新日結版本`);
      }
      const version = toVersion(dayId, day.lastSettlementRevision, latest.data());
      if (version.status !== 'closed' || version.countedCash === null) {
        throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${dayId} 最新日結版本不是關帳版本`);
      }
      cached = version.countedCash;
      settlementCache.set(key, cached);
    }
    return cached;
  }

  function assertHeadUnchanged(before: { seq: number; datasetId: string }, after: { seq: number; datasetId: string }, what: string) {
    if (after.seq !== before.seq || after.datasetId !== before.datasetId) {
      throw new CloudDayCloseRepositoryError('STALE_SNAPSHOT', `讀取期間雲端資料有更新，請重新載入${what}`);
    }
  }

  async function read(): Promise<CloudLedgerSnapshot> {
    try {
      const user = assertAuthenticated(options);
      const before = await readHeadSeq(db);
      const today = await readLeaseDate(db, user);
      const days: LedgerAnomalyDay[] = [];
      // Entries are rare manual fixes, so one paged scan of the whole collection (grouped by day) replaces a query per closed day.
      const entriesByDay = new Map<string, PostCloseEntry[]>();
      for (const entry of await readPostCloseEntries(db, null, pageSize, async () => assertHeadUnchanged(before, await readHeadSeq(db), '帳務異常'))) {
        entriesByDay.set(entry.dayId, [...entriesByDay.get(entry.dayId) ?? [], entry]);
      }
      let last: QueryDocumentSnapshot | null = null;
      for (;;) {
        const page: QuerySnapshot<DocumentData> = await getDocsFromServer(query(
          collection(db, 'days'),
          where(documentId(), '>=', before.goLiveDate),
          where(documentId(), '<=', today),
          orderBy(documentId()),
          ...(last ? [startAfter(last)] : []),
          limit(pageSize),
        ));
        for (const snapshot of page.docs) {
          if (days.length >= MAX_SCANNED_DAYS) {
            throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `營業日超過 ${MAX_SCANNED_DAYS} 天，無法完整檢查帳務異常`);
          }
          if (!validDate(snapshot.id)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 路徑不支援`);
          const day = decodeDay(snapshot.id, snapshot.data());
          days.push({
            dayId: snapshot.id,
            status: day.status,
            openingCash: day.openingCash,
            activeTransactionCount: day.totals.activeTransactionCount,
            countedCash: day.status === 'closed' ? await countedCashOf(before.datasetId, snapshot.id, day) : null,
            postCloseNet: day.status === 'closed' ? postCloseNet(entriesByDay.get(snapshot.id) ?? [], day.lastSettlementRevision) : 0,
          });
        }
        assertHeadUnchanged(before, await readHeadSeq(db), '帳務異常');
        if (page.size < pageSize) break;
        last = page.docs[page.docs.length - 1] ?? null;
      }
      return {
        today,
        goLiveDate: before.goLiveDate,
        anomalies: computeLedgerAnomalies(days, today),
        closedDays: days.filter(day => day.status === 'closed')
          .map(day => ({ dayId: day.dayId, countedCash: day.countedCash as number, postCloseNet: day.postCloseNet ?? 0 })),
        seq: before.seq,
      };
    } catch (error) {
      throw readError(error);
    }
  }

  async function findPreviousClosed(dayId: string): Promise<CloudPreviousClosedLookup> {
    try {
      assertAuthenticated(options);
      if (!validDate(dayId)) throw new CloudDayCloseRepositoryError('INVALID_INPUT', '營業日日期格式不正確');
      const before = await readHeadSeq(db);
      let end = dayId;
      let previous: PreviousClosedDay | null = null;
      while (end > before.goLiveDate) {
        const candidate = addCalendarDays(end, -segmentDays);
        const start = candidate > before.goLiveDate ? candidate : before.goLiveDate;
        const page: QuerySnapshot<DocumentData> = await getDocsFromServer(query(
          collection(db, 'days'),
          where(documentId(), '>=', start),
          where(documentId(), '<', end),
          orderBy(documentId()),
          limit(segmentDays),
        ));
        for (let index = page.docs.length - 1; index >= 0; index -= 1) {
          const snapshot = page.docs[index];
          if (!snapshot) continue;
          if (!validDate(snapshot.id)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 路徑不支援`);
          const day = decodeDay(snapshot.id, snapshot.data());
          if (day.status === 'closed') {
            const countedCash = await countedCashOf(before.datasetId, snapshot.id, day);
            const entries = await readPostCloseEntries(db, snapshot.id, pageSize);
            previous = { dayId: snapshot.id, countedCash, postCloseNet: postCloseNet(entries, day.lastSettlementRevision) };
            break;
          }
        }
        assertHeadUnchanged(before, await readHeadSeq(db), '上一個已關帳日');
        if (previous) break;
        end = start;
      }
      return { previous, seq: before.seq };
    } catch (error) {
      throw readError(error);
    }
  }

  /**
   * P11c3: the nearest opened day after `dayId` (contract §14.2), the day a back-filled close must align with.
   * Forward segments of calendar days up to the lease date; the first day with a confirmed openingCash wins, so
   * the number of reads follows the gap and never the length of the history.
   */
  async function findNextOpened(dayId: string): Promise<CloudNextOpenedLookup> {
    try {
      const user = assertAuthenticated(options);
      if (!validDate(dayId)) throw new CloudDayCloseRepositoryError('INVALID_INPUT', '營業日日期格式不正確');
      const before = await readHeadSeq(db);
      const today = await readLeaseDate(db, user);
      let start = dayId;
      let next: CloudNextOpenedLookup['next'] = null;
      while (start < today && !next) {
        const candidate = addCalendarDays(start, segmentDays);
        const end = candidate < today ? candidate : today;
        const page: QuerySnapshot<DocumentData> = await getDocsFromServer(query(
          collection(db, 'days'),
          where(documentId(), '>', start),
          where(documentId(), '<=', end),
          orderBy(documentId()),
          limit(segmentDays),
        ));
        for (const snapshot of page.docs) {
          if (!validDate(snapshot.id)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 路徑不支援`);
          const day = decodeDay(snapshot.id, snapshot.data());
          if (day.openingCash !== null) {
            next = { dayId: snapshot.id, openingCash: day.openingCash };
            break;
          }
        }
        assertHeadUnchanged(before, await readHeadSeq(db), '下一個已開帳日');
        start = end;
      }
      return { next, seq: before.seq };
    } catch (error) {
      throw readError(error);
    }
  }

  return { read, findPreviousClosed, findNextOpened };
}

function refused(code: CommandErrorCode, message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

/**
 * The single mapping from a typed intent to the canonical command. The writer and the read-only expected-intent
 * checks both use it, so a receipt proof compares exactly what a write would have sent.
 */
function buildDayCloseCommand(intent: CloudDayCloseCommandIntent): CanonicalEnabledInput {
  if (intent.kind === 'ensure-day') {
    const { commandId, leaseEpoch, dayId } = intent.input;
    return normalizeEnabledCommandInput({
      commandId, kind: 'EnsureDay', leaseEpoch, targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId },
    });
  }
  if (intent.kind === 'start-backfill') {
    const { commandId, leaseEpoch, dayId, expectedDayRevision, reason } = intent.input;
    return normalizeEnabledCommandInput({
      commandId, kind: 'StartBackfill', leaseEpoch, targets: { dayId }, expectedRevisions: { day: expectedDayRevision }, payload: { reason },
    });
  }
  if (intent.kind === 'backfill-opening') {
    const { commandId, leaseEpoch, dayId, expectedDayRevision, openingCash, reason } = intent.input;
    return normalizeEnabledCommandInput({
      commandId, kind: 'BackfillOpeningCash', leaseEpoch, targets: { dayId }, expectedRevisions: { day: expectedDayRevision },
      payload: { openingCash, reason },
    });
  }
  if (intent.kind === 'record-post-close-entry') {
    const { commandId, leaseEpoch, dayId, expectedDayRevision, expectedSettlementRevision, direction, amount, reason } = intent.input;
    return normalizeEnabledCommandInput({
      commandId, kind: 'RecordPostCloseEntry', leaseEpoch, targets: { dayId },
      expectedRevisions: { day: expectedDayRevision, settlement: expectedSettlementRevision },
      payload: { direction, amount, reason },
    });
  }
  if (intent.kind === 'reopen-day') {
    const { commandId, leaseEpoch, dayId, expectedDayRevision, expectedSettlementRevision, reason } = intent.input;
    return normalizeEnabledCommandInput({
      commandId, kind: 'ReopenDay', leaseEpoch, targets: { dayId, settlementRevision: expectedSettlementRevision + 1 },
      expectedRevisions: { day: expectedDayRevision, settlement: expectedSettlementRevision },
      payload: { reason },
    });
  }
  const { commandId, leaseEpoch, dayId, expectedDayRevision, expectedSettlementRevision, countedCash, note, expectedCash, alignWithDayId } = intent.input;
  return normalizeEnabledCommandInput({
    commandId, kind: 'CloseDay', leaseEpoch, targets: { dayId, settlementRevision: expectedSettlementRevision + 1 },
    expectedRevisions: { day: expectedDayRevision, settlement: expectedSettlementRevision },
    payload: alignWithDayId === undefined ? { countedCash, note, expectedCash } : { countedCash, note, expectedCash, alignWithDayId },
  });
}

function expectedIntentCommand(intent: CloudDayCloseCommandIntent): CanonicalEnabledInput {
  try {
    return buildDayCloseCommand(intent);
  } catch (error) {
    if (error instanceof InvalidCloudCommandInput) throw new CloudCommandReadError('INVALID_INPUT', '原命令內容不符合正式命令格式');
    throw error;
  }
}

export function createCloudDayCloseRepository(db: Firestore, options: CloudDayCloseRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);
  const ledger = createCloudLedgerReader(db, options);

  async function runGuard(guard: CloudDayCloseCommitGuard | undefined): Promise<void> {
    if (guard && (await guard()) !== true) throw new CloudDayCloseGuardRejected();
  }

  async function commitCanonical(intent: CloudDayCloseCommandIntent, guard: CloudDayCloseCommitGuard | undefined): Promise<CommandResult> {
    let command: CanonicalEnabledInput;
    try {
      command = buildDayCloseCommand(intent);
    } catch (error) {
      if (error instanceof InvalidCloudCommandInput) return refused('INVALID_INPUT', error.message);
      throw error;
    }
    await runGuard(guard);
    return commands.commitCommand(command);
  }

  function signedInUid(): string | null {
    try {
      return assertAuthenticated(options).uid;
    } catch {
      return null;
    }
  }

  async function closeDay(input: CloseCloudDayInput, guard?: CloudDayCloseCommitGuard): Promise<CommandResult> {
    const intent: CloudDayCloseCommandIntent = { kind: 'close-day', input };
    const { commandId, dayId, alignWithDayId } = input;
    if (alignWithDayId !== undefined) {
      const startedAs = signedInUid();
      // Rules cannot prove that no nearer opened day exists, so the writer does (contract §14.2). A command
      // with this ID that already committed is answered from its receipt by `commitCommand`, so a retry
      // after an unknown result keeps working even if the scan now differs.
      const receipt = await commands.readCommand(commandId).catch(() => null);
      if (!receipt) {
        let lookup: CloudNextOpenedLookup;
        try {
          lookup = await ledger.findNextOpened(dayId);
        } catch (error) {
          const stale = error instanceof CloudDayCloseRepositoryError && error.code === 'STALE_SNAPSHOT';
          return refused(stale ? 'REVISION_CONFLICT' : 'INVALID_INPUT', error instanceof Error ? error.message : '讀取下一個已開帳日失敗');
        }
        const nearest = lookup.next?.dayId ?? null;
        if (nearest !== alignWithDayId) {
          return refused('REVISION_CONFLICT', nearest
            ? `最近的已開帳日是 ${nearest}，不是 ${alignWithDayId ?? '（無）'}；請重新載入日結頁後再關帳`
            : `${dayId} 之後沒有已開帳的日子，不能對齊 ${alignWithDayId}；請重新載入日結頁後再關帳`);
        }
      }
      // The preflight awaited: the intent keeps the identity that started it, never a newly signed-in user.
      if (startedAs === null || signedInUid() !== startedAs) throw new CloudDayCloseGuardRejected();
    }
    return commitCanonical(intent, guard);
  }

  async function commitDayCloseIntent(intent: CloudDayCloseCommandIntent, guard?: CloudDayCloseCommitGuard): Promise<CommandResult> {
    if (intent.kind === 'close-day') return closeDay(intent.input, guard);
    return commitCanonical(intent, guard);
  }

  /** One page read under one head fence (dataset and seq stable across the whole composition). */
  async function loadSnapshot(targetDayId?: string): Promise<CloudDayCloseSnapshot> {
    try {
      const user = assertAuthenticated(options);
      const before = await readHeadSeq(db);
      const overview = await readCloudDayCloseOverview(db, options);
      const dayId = targetDayId ?? overview.selectionDate;
      if (!validDate(dayId)) throw new CloudDayCloseRepositoryError('INVALID_INPUT', '營業日日期格式不正確');
      const day = await readCloudDayClose(db, dayId, options);
      const backfill = overview.unclosedDays.find(item => item.dayId === dayId)?.backfill ?? null;
      const seqs = [overview.seq, ...(day ? [day.seq] : [])];

      // Optional lookups only disable the form that needs them; the head moving or an authority error never does.
      const optional = async <T extends { seq: number }>(lookup: () => Promise<T>): Promise<T | { error: string }> => {
        try {
          const found = await lookup();
          seqs.push(found.seq);
          return found;
        } catch (error) {
          const failure = readError(error);
          if (['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY', 'STALE_SNAPSHOT'].includes(failure.code)) throw failure;
          return { error: failure.message };
        }
      };
      let previous: CloudDayClosePreviousLookupView | null = null;
      if (dayId < overview.selectionDate && dayId >= overview.goLiveDate && !backfill
        && (!day || (day.status === 'open' && day.lastSettlementRevision === 0 && day.openingCash === null))) {
        const found = await optional(() => ledger.findPreviousClosed(dayId));
        previous = 'error' in found ? { status: 'error', message: found.error } : { status: 'ready', previous: found.previous };
      }
      let align: CloudDayCloseAlignLookupView | null = null;
      if (backfill && day && day.status !== 'closed' && day.openingCash !== null) {
        const found = await optional(() => ledger.findNextOpened(dayId));
        align = 'error' in found ? { status: 'error', message: found.error } : { status: 'ready', next: found.next };
      }

      const after = await readHeadSeq(db);
      if (after.datasetId !== before.datasetId || after.seq !== before.seq || seqs.some(seq => seq !== before.seq)) {
        throw new CloudDayCloseRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料有更新，請重新載入日結');
      }
      // The reads awaited: a different signed-in user must never receive this operator's page.
      if (assertAuthenticated(options).uid !== user.uid) {
        throw new CloudDayCloseRepositoryError('LEASE_LOST', '登入身分在讀取期間已變更');
      }
      return { datasetId: before.datasetId, overview, dayId, day, backfill, previous, align };
    } catch (error) {
      throw readError(error);
    }
  }

  /**
   * True when the pending-command journal holds anything but `ownCommandId`, or cannot be read completely.
   * A same-ID close retry resolves its own original operation; any other pending identity still blocks closing,
   * and nothing is ever cleared or ignored here.
   */
  async function hasOtherUnresolvedCommands(ownCommandId: string): Promise<boolean> {
    try {
      const journal = options.pendingJournal ?? cloudPendingJournalForRepository(db);
      const snapshot = await journal.readAll();
      if (!snapshot.complete || snapshot.total !== snapshot.records.length) return true;
      return snapshot.records.some(record => record.commandId !== ownCommandId);
    } catch {
      return true;
    }
  }

  return {
    loadSnapshot,
    readLedger: () => ledger.read(),
    findPreviousClosed: (dayId: string) => ledger.findPreviousClosed(dayId),
    findNextOpened: (dayId: string) => ledger.findNextOpened(dayId),
    read: (dayId: string) => readCloudDayClose(db, dayId, options),
    readOverview: () => readCloudDayCloseOverview(db, options),
    readBackfillDay: (dayId: string) => readCloudBackfillDay(db, dayId),
    commitDayCloseIntent,
    async confirmPendingIntent(intent: CloudDayCloseCommandIntent, expectedDatasetId: string, expectedUid: string): Promise<PendingIntentCheck> {
      return commands.confirmPendingIntent(
        expectedIntentCommand(intent), intent.input.leaseEpoch, expectedDatasetId, expectedUid, options.recoveryReader,
      );
    },
    async cleanupConfirmedIntent(
      intent: CloudDayCloseCommandIntent,
      expectedDatasetId: string,
      expectedUid: string,
      isCurrent: () => boolean,
    ): Promise<boolean> {
      return commands.cleanupConfirmedIntent(
        expectedIntentCommand(intent), intent.input.leaseEpoch, expectedDatasetId, expectedUid, options.recoveryReader, isCurrent,
      );
    },
    hasOtherUnresolvedCommands,
    ensureDay: (input: EnsureCloudDayInput) => commitCanonical({ kind: 'ensure-day', input }, undefined),
    startBackfill: (input: StartCloudBackfillInput) => commitCanonical({ kind: 'start-backfill', input }, undefined),
    closeDay: (input: CloseCloudDayInput) => closeDay(input),
    recordPostCloseEntry: (input: RecordCloudPostCloseEntryInput) => commitCanonical({ kind: 'record-post-close-entry', input }, undefined),
    reopenDay: (input: ReopenCloudDayInput) => commitCanonical({ kind: 'reopen-day', input }, undefined),
    backfillOpening: (input: BackfillCloudDayOpeningInput) => commitCanonical({ kind: 'backfill-opening', input }, undefined),
    readCommand(commandId: string): Promise<CommandReceipt | null> {
      return commands.readCommand(commandId);
    },
  };
}
