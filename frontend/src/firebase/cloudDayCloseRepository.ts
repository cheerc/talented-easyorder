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
  where,
  type Firestore,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import { InvalidCloudCommandInput, decodeSettlementDoc, settlementExpectedCash } from '../domain/cloudCommandSchema';
import { createCloudCommandRepository, type CloudCommandRepositoryOptions } from './cloudCommandRepository';
import {
  computeLedgerAnomalies, type LedgerAnomaly, type LedgerAnomalyDay, type PreviousClosedDay,
} from '../domain/ledgerAnomalies';
import { accessLeasePath, dataHeadPath, dayPath, settlementPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

/** P11 settlement versions per day are small; more than this is out of spec and fails closed. */
const MAX_SETTLEMENT_VERSIONS = 200;
/** Unclosed days are closed daily; more than this means the overview cannot be shown completely. */
const MAX_UNCLOSED_DAYS = 200;
/** Business-day documents between goLiveDate and today that the anomaly scan reads (contract §11). */
const MAX_ANOMALY_DAYS = 400;

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
        return { ...entry, kind: classifyUnclosedDay(entry, selectionDate) };
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

/**
 * Server-only anomaly scan (contract §11): reads goLiveDate..today business days in ascending document-ID
 * order and the latest settlement of each closed day. Settlement versions are immutable, so a reader keeps
 * them in memory by (datasetId, dayId, revision) to spare Spark reads. More than MAX_ANOMALY_DAYS documents
 * or a head that moves during the read fails closed instead of truncating.
 */
export function createCloudLedgerReader(db: Firestore, options: CloudCommandRepositoryOptions = {}) {
  const settlementCache = new Map<string, number>();
  async function read(): Promise<CloudLedgerSnapshot> {
    try {
      const user = assertAuthenticated(options);
      const before = await readHeadSeq(db);
      const today = await readLeaseDate(db, user);
      const page = await getDocsFromServer(query(
        collection(db, 'days'),
        where(documentId(), '>=', before.goLiveDate),
        where(documentId(), '<=', today),
        orderBy(documentId()),
        limit(MAX_ANOMALY_DAYS + 1),
      ));
      if (page.size > MAX_ANOMALY_DAYS) {
        throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `營業日超過 ${MAX_ANOMALY_DAYS} 天，無法完整檢查帳務異常`);
      }
      const days: LedgerAnomalyDay[] = [];
      for (const snapshot of page.docs) {
        if (!validDate(snapshot.id)) throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 路徑不支援`);
        const day = decodeDay(snapshot.id, snapshot.data());
        let countedCash: number | null = null;
        if (day.status === 'closed') {
          if (day.lastSettlementRevision < 1) {
            throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `已關帳營業日 ${snapshot.id} 沒有日結版本`);
          }
          const key = `${before.datasetId}/${snapshot.id}/${day.lastSettlementRevision}`;
          let cached = settlementCache.get(key);
          if (cached === undefined) {
            const latest = await getDocFromServer(doc(db, settlementPath(snapshot.id, day.lastSettlementRevision)));
            if (!latest.exists()) {
              throw new CloudDayCloseRepositoryError('INCOMPLETE_SNAPSHOT', `營業日 ${snapshot.id} 缺少最新日結版本`);
            }
            const version = toVersion(snapshot.id, day.lastSettlementRevision, latest.data());
            if (version.status !== 'closed' || version.countedCash === null) {
              throw new CloudDayCloseRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${snapshot.id} 最新日結版本不是關帳版本`);
            }
            cached = version.countedCash;
            settlementCache.set(key, cached);
          }
          countedCash = cached;
        }
        days.push({
          dayId: snapshot.id,
          status: day.status,
          openingCash: day.openingCash,
          activeTransactionCount: day.totals.activeTransactionCount,
          countedCash,
        });
      }
      const after = await readHeadSeq(db);
      if (after.seq !== before.seq || after.datasetId !== before.datasetId) {
        throw new CloudDayCloseRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料有更新，請重新載入帳務異常');
      }
      return {
        today,
        goLiveDate: before.goLiveDate,
        anomalies: computeLedgerAnomalies(days, today),
        closedDays: days.filter(day => day.status === 'closed').map(day => ({ dayId: day.dayId, countedCash: day.countedCash as number })),
        seq: after.seq,
      };
    } catch (error) {
      throw readError(error);
    }
  }
  return { read };
}

export function createCloudDayCloseRepository(db: Firestore, options: CloudCommandRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);
  const ledger = createCloudLedgerReader(db, options);
  return {
    readLedger: () => ledger.read(),
    read: (dayId: string) => readCloudDayClose(db, dayId, options),
    readOverview: () => readCloudDayCloseOverview(db, options),
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
