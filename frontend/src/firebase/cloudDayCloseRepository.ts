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
import { InvalidCloudCommandInput, decodeBackfillDoc, decodeSettlementDoc, settlementExpectedCash } from '../domain/cloudCommandSchema';
import { createCloudCommandRepository, type CloudCommandRepositoryOptions } from './cloudCommandRepository';
import {
  computeLedgerAnomalies, type LedgerAnomaly, type LedgerAnomalyDay, type PreviousClosedDay,
} from '../domain/ledgerAnomalies';
import { accessLeasePath, backfillDayPath, dataHeadPath, dayPath, settlementPath } from './firestorePaths';

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

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function integer(value: unknown, minimum: number, maximum = 1_000_000_000): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
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
    return snapshot.exists() ? decodeBackfill(dayId, snapshot.data()) : null;
  } catch (error) {
    throw readError(error);
  }
}

async function readHeadSeq(db: Firestore): Promise<{ seq: number; datasetId: string; goLiveDate: string }> {
  const snapshot = await getDocFromServer(doc(db, dataHeadPath()));
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
    if (!daySnapshot.exists()) return null;
    const day = decodeDay(dayId, daySnapshot.data());
    const page = await getDocsFromServer(collection(db, dayPath(dayId), 'settlements'));
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
    const after = await readHeadSeq(db);
    if (after.seq !== before.seq || after.datasetId !== before.datasetId) {
      throw new CloudDayCloseRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料有更新，請重新載入日結');
    }
    return {
      dayId,
      ...day,
      expectedCash: day.openingCash === null ? null : settlementExpectedCash(day),
      settlements,
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
        closedDays: days.filter(day => day.status === 'closed').map(day => ({ dayId: day.dayId, countedCash: day.countedCash as number })),
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
            previous = { dayId: snapshot.id, countedCash: await countedCashOf(before.datasetId, snapshot.id, day) };
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

  return { read, findPreviousClosed };
}

export function createCloudDayCloseRepository(db: Firestore, options: CloudCommandRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);
  const ledger = createCloudLedgerReader(db, options);
  return {
    readLedger: () => ledger.read(),
    findPreviousClosed: (dayId: string) => ledger.findPreviousClosed(dayId),
    read: (dayId: string) => readCloudDayClose(db, dayId, options),
    readOverview: () => readCloudDayCloseOverview(db, options),
    readBackfillDay: (dayId: string) => readCloudBackfillDay(db, dayId),
    closeDay(input: CloseCloudDayInput): Promise<CommandResult> {
      const { commandId, leaseEpoch, dayId, expectedDayRevision, expectedSettlementRevision, countedCash, note, expectedCash } = input;
      return commands.commitCommand({
        commandId,
        kind: 'CloseDay',
        leaseEpoch,
        targets: { dayId, settlementRevision: expectedSettlementRevision + 1 },
        expectedRevisions: { day: expectedDayRevision, settlement: expectedSettlementRevision },
        payload: { countedCash, note, expectedCash },
      });
    },
    reopenDay(input: ReopenCloudDayInput): Promise<CommandResult> {
      const { commandId, leaseEpoch, dayId, expectedDayRevision, expectedSettlementRevision, reason } = input;
      return commands.commitCommand({
        commandId,
        kind: 'ReopenDay',
        leaseEpoch,
        targets: { dayId, settlementRevision: expectedSettlementRevision + 1 },
        expectedRevisions: { day: expectedDayRevision, settlement: expectedSettlementRevision },
        payload: { reason },
      });
    },
    backfillOpening(input: BackfillCloudDayOpeningInput): Promise<CommandResult> {
      const { commandId, leaseEpoch, dayId, expectedDayRevision, openingCash, reason } = input;
      return commands.commitCommand({
        commandId,
        kind: 'BackfillOpeningCash',
        leaseEpoch,
        targets: { dayId },
        expectedRevisions: { day: expectedDayRevision },
        payload: { openingCash, reason },
      });
    },
    readCommand(commandId: string): Promise<CommandReceipt | null> {
      return commands.readCommand(commandId);
    },
  };
}
