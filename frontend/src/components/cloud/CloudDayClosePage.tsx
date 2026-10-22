import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import { effectiveCashOf, openingDifference, type OpeningMismatchAnomaly } from '../../domain/ledgerAnomalies';
import type { PostCloseDirection } from '../../domain/postCloseEntries';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import {
  createCloudDayCloseRepository,
  type BackfillCloudDayOpeningInput,
  type CloseCloudDayInput,
  type CloudDayCloseCommandIntent,
  type CloudDayCloseSnapshot,
  type CloudDayCloseState,
  type CloudUnclosedDay,
  type EnsureCloudDayInput,
  type RecordCloudPostCloseEntryInput,
  type ReopenCloudDayInput,
  type StartCloudBackfillInput,
} from '../../firebase/cloudDayCloseRepository';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import { BackupScreen } from '../screens/BackupScreen';
import { LedgerUnclosedBanner } from './LedgerUnclosedBanner';
import './CloudDayClosePage.css';

export interface CloudDayClosePageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  /** Tests replace the P14 backup block; the page mounts the real one by default. */
  backupBlock?: ReactNode;
  /** 帳務異常快照（契約 §11）；沒提供時不顯示橫幅。 */
  ledger?: CloudLedgerView;
  onOpenAnomalies?: () => void;
  /** 開帳補登、關帳或重開命令確認成功後呼叫，讓上層重讀帳務異常。 */
  onLedgerChanged?: () => void;
  /** 第一次載入時要選到的營業日（例如從異常頁帶過來）；沒提供則用伺服器租約日期。 */
  initialDayId?: string;
  /** 從帳務異常頁帶來的差額快照；只帶方向與金額，原因仍須由操作者輸入。 */
  initialPostCloseEntry?: OpeningMismatchAnomaly;
  /** 回填中的日子要補登交易時，切到訂餐頁並選到那一天（契約 §13）。 */
  onOpenOrders?: (dayId: string) => void;
  /** Pending command recovery manual continuation never lifts the §7.4 close restriction. */
  hasUnresolvedPendingCommands?: boolean;
}

type PreparedCommand =
  | ({ kind: 'close-day' } & Omit<CloseCloudDayInput, 'leaseEpoch'>)
  | ({ kind: 'record-post-close-entry' } & Omit<RecordCloudPostCloseEntryInput, 'leaseEpoch'>)
  | ({ kind: 'reopen-day' } & Omit<ReopenCloudDayInput, 'leaseEpoch'>)
  | ({ kind: 'backfill-opening' } & Omit<BackfillCloudDayOpeningInput, 'leaseEpoch'>)
  | ({ kind: 'ensure-day' } & Omit<EnsureCloudDayInput, 'leaseEpoch'>)
  | ({ kind: 'start-backfill' } & Omit<StartCloudBackfillInput, 'leaseEpoch'>);

type RecoveryPhase = 'submitting' | 'unknown' | 'checking' | 'receipt' | 'access-lost';

interface RecoveryState {
  commandId: string;
  command?: PreparedCommand;
  phase: RecoveryPhase;
  /** Ten seconds passed without a definite result; the prompt only, never an abort or an unsent proof. */
  timedOut?: boolean;
  /** A fresh settled read-only null allows an explicit retry with the original ID and frozen input. */
  canRetry?: boolean;
  receipt?: CommandReceipt;
}

/**
 * One operation per mounted owner: the frozen command, its canonical typed intent, and the independent liveness of
 * the original submission promise. Nothing else survives an owner change or an unmount.
 */
interface DayCloseCommandOperation {
  token: symbol;
  identityKey: string;
  generation: number;
  db: Firestore;
  app: Firestore['app'];
  uid: string;
  leaseEpoch: number;
  datasetId: string;
  /** The command's own business day; the refreshed page must show exactly this dataset and day. */
  dayId: string;
  command: PreparedCommand | null;
  intent: CloudDayCloseCommandIntent | null;
  attempt: number;
  attemptPromise: Promise<CommandResult> | null;
  attemptSettled: boolean;
  querySequence: number;
  checking: boolean;
  retryAuthorized: boolean;
  receipt: CommandReceipt | null;
  /** The original submission itself returned the receipt; a receipt found by a query never auto-advances a plan. */
  confirmedByResult: boolean;
  /** The backfill plan generation this step belongs to; null for a stand-alone command. */
  planGeneration: number | null;
  completed: boolean;
  timerId: number | null;
  cleanupWarning: string;
}

/**
 * What the operator asked to backfill (contract §13), bound to the mounted owner, the dataset and the day. Which
 * steps are still needed is derived from the server state after every confirmed step, so a retry never creates a
 * day or a marker twice. `generation` identifies one explicitly initiated plan.
 */
interface BackfillPlan {
  generation: number;
  datasetId: string;
  uid: string;
  dayId: string;
  reason: string;
  /** null when the day already has its opening cash. */
  openingCash: number | null;
  /** The reason sent with BackfillOpeningCash: the difference reason, or the backfill reason when none is needed. */
  openingReason: string;
  /** The next step may start by itself once the page has re-read the server; consumed by exactly one continuation. */
  auto: boolean;
}

type DaySnapshot = CloudDayCloseSnapshot;

const CLOSE_BLOCKED_MESSAGE = '尚有待核對命令；依系統關帳規則，先完成結果確認後才能關帳。保留原編號，不要重新收款。';

interface PageState {
  scopeKey: string;
  authorizationRevoked: boolean;
  snapshot: DaySnapshot | null;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  dayIdDraft: string;
  countedText: string;
  note: string;
  reopenOpen: boolean;
  reopenReason: string;
  postCloseDirection: PostCloseDirection;
  postCloseAmountText: string;
  postCloseReason: string;
  postCloseReference: OpeningMismatchAnomaly | null;
  postCloseChecking: boolean;
  postCloseRequiresConfirmation: boolean;
  postCloseConfirmed: boolean;
  postCloseStaleMessage: string;
  backfillText: string;
  backfillReason: string;
  /** The backfill form (contract §13): reason, opening cash (null shows the default) and the difference reason. */
  startReason: string;
  startOpeningText: string | null;
  startOpeningReason: string;
  backfillPlan: BackfillPlan | null;
  recovery: RecoveryState | null;
}

type DraftKey = 'countedText' | 'note' | 'reopenOpen' | 'reopenReason' | 'postCloseDirection' | 'postCloseAmountText'
  | 'postCloseReason' | 'postCloseChecking' | 'postCloseRequiresConfirmation' | 'postCloseConfirmed' | 'postCloseStaleMessage'
  | 'backfillText' | 'backfillReason'
  | 'startReason' | 'startOpeningText' | 'startOpeningReason';

function clearDrafts(): Pick<PageState, DraftKey> {
  return {
    countedText: '', note: '', reopenOpen: false, reopenReason: '', postCloseDirection: 'income', postCloseAmountText: '',
    postCloseReason: '', postCloseChecking: false, postCloseRequiresConfirmation: false, postCloseConfirmed: false, postCloseStaleMessage: '',
    backfillText: '', backfillReason: '',
    startReason: '', startOpeningText: null, startOpeningReason: '',
  };
}

function initialPageState(scopeKey: string): PageState {
  return {
    scopeKey,
    authorizationRevoked: false,
    snapshot: null,
    loading: true,
    loadError: '',
    actionError: '',
    notice: '',
    dayIdDraft: '',
    ...clearDrafts(),
    postCloseReference: null,
    backfillPlan: null,
    recovery: null,
  };
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function errorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'OFFLINE') return '目前無法連線到雲端，沒有顯示本機或不完整資料。請恢復連線後重新載入。';
  if (code === 'LEASE_LOST' || code === 'ACCESS_BUSY') return '目前使用權已變更，雲端日結資料已清除。請重新確認使用權。';
  if (code === 'UNAUTHORIZED') return '目前帳號沒有雲端日結存取權，資料已清除。請重新登入確認權限。';
  if (code === 'QUOTA_EXCEEDED') return '雲端讀取額度不足，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'MAINTENANCE') return '系統正在維護，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'INCOMPLETE_SNAPSHOT') return '伺服器日結資料不完整，沒有顯示部分資料。請聯絡系統維護者。';
  if (code === 'STALE_SNAPSHOT') return '載入期間伺服器資料有變動，沒有顯示部分資料。請重新載入。';
  if (code === 'UNSUPPORTED_SCHEMA') return '伺服器資料格式目前無法安全讀取，沒有顯示部分資料。請聯絡系統維護者。';
  if (code === 'UNKNOWN_RESULT') return '伺服器結果目前無法確認，沒有顯示部分資料。請重新確認命令或重新載入。';
  if (code === 'LOCAL_STORAGE_UNAVAILABLE') return '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。';
  if (code === 'DAY_CLOSED') return '這個營業日已經關帳。';
  if (code === 'REVISION_CONFLICT') return '營業日在你操作期間有新的異動（例如新交易），應有現金可能已改變。';
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return '雲端操作無法完成。請重新載入伺服器資料後再試。';
}

function isAuthorizationLoss(error: unknown): boolean {
  return ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY'].includes(errorCode(error));
}

function clientCommandId(): string | null {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sameOpeningMismatch(a: OpeningMismatchAnomaly, b: OpeningMismatchAnomaly): boolean {
  return a.dayId === b.dayId
    && a.openingCash === b.openingCash
    && a.previousClosedDayId === b.previousClosedDayId
    && a.previousCountedCash === b.previousCountedCash
    && a.previousPostCloseNet === b.previousPostCloseNet
    && a.previousEffectiveCash === b.previousEffectiveCash
    && a.difference === b.difference
    && a.daysApart === b.daysApart
    && a.gapDayCount === b.gapDayCount
    && a.gapDays.length === b.gapDays.length
    && a.gapDays.every((dayId, index) => dayId === b.gapDays[index]);
}

function entryDirectionForDifference(difference: number): PostCloseDirection {
  return difference > 0 ? 'income' : 'expense';
}

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}NT$ ${new Intl.NumberFormat('zh-TW').format(Math.abs(amount))}`;
}

function formatDifference(amount: number): string {
  if (amount === 0) return '無差額';
  return amount > 0 ? `多 ${formatMoney(amount)}` : `少 ${formatMoney(-amount)}`;
}

function formatServerTime(value: string | Date): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return value instanceof Date ? '—' : value;
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp);
}

function statusLabel(status: CloudDayCloseState['status']): string {
  return status === 'closed' ? '已關帳' : status === 'reopened' ? '已重開' : '開啟中';
}

const BACKFILL_STEP_LABEL = { 'ensure-day': '建立營業日', 'backfill-opening': '補開帳', 'start-backfill': '標為回填' } as const;

function commandLabel(command: PreparedCommand): string {
  if (command.kind === 'ensure-day' || command.kind === 'start-backfill') return `${command.dayId} ${BACKFILL_STEP_LABEL[command.kind]}`;
  if (command.kind === 'backfill-opening') return `${command.dayId} 補開帳`;
  if (command.kind === 'record-post-close-entry') return `${command.dayId} 關帳後補記`;
  return command.kind === 'close-day' ? `${command.dayId} 關帳` : `${command.dayId} 重開`;
}

function unclosedLabel(day: CloudUnclosedDay, selectionDate: string): string {
  if (day.backfill) return '回填中，補登完成後關帳';
  if (day.kind === 'no-business') return '沒有開帳也沒有交易';
  if (day.kind === 'missing-opening') {
    return day.dayId === selectionDate ? '尚未確認開帳現金' : '缺開帳現金，需補開帳後關帳';
  }
  return day.dayId === selectionDate ? '今天，尚未關帳' : '尚未關帳';
}

/**
 * The next step of a backfill plan, derived from what the server shows now: no day → create it; no opening cash →
 * confirm it; no marker → start the backfill. `null` means every step is done.
 */
function nextBackfillStep(
  plan: BackfillPlan,
  loaded: DaySnapshot,
  newCommandId: () => string | null,
): PreparedCommand | { blocked: string } | null {
  const { day, backfill, dayId } = loaded;
  if (backfill) return null;
  if (day && (day.status !== 'open' || day.lastSettlementRevision !== 0)) {
    return { blocked: `${dayId} 已經關過帳，不能用回填修改。` };
  }
  if (loaded.overview.selectionDate <= dayId) return { blocked: `${dayId} 不是過去的營業日，不能回填；今天請直接登錄。` };
  const commandId = newCommandId();
  if (!commandId) return { blocked: '瀏覽器無法建立安全的命令編號，沒有送出操作。請重新載入安全連線後再試。' };
  if (!day) return { kind: 'ensure-day', commandId, dayId };
  if (day.openingCash === null) {
    if (plan.openingCash === null) return { blocked: `${dayId} 還沒有開帳現金，請重新填寫回填表單。` };
    return { kind: 'backfill-opening', commandId, dayId, expectedDayRevision: day.revision, openingCash: plan.openingCash, reason: plan.openingReason };
  }
  return { kind: 'start-backfill', commandId, dayId, expectedDayRevision: day.revision, reason: plan.reason };
}

function freezeValue<T>(input: T): T {
  const copy = JSON.parse(JSON.stringify(input)) as T;
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

function browserIsOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === true;
}

/** The repository's guard rejection means nothing was written; matched by name so the page needs no class import. */
function isGuardRejected(error: unknown): boolean {
  return error instanceof Error && error.name === 'CloudDayCloseGuardRejected';
}

/** The canonical typed intent of a prepared command: the same mapping the writer and the read-only checks use. */
function intentFor(command: PreparedCommand, leaseEpoch: number): CloudDayCloseCommandIntent {
  if (command.kind === 'ensure-day') {
    return { kind: 'ensure-day', input: { commandId: command.commandId, leaseEpoch, dayId: command.dayId } };
  }
  if (command.kind === 'start-backfill') {
    return {
      kind: 'start-backfill',
      input: {
        commandId: command.commandId, leaseEpoch, dayId: command.dayId,
        expectedDayRevision: command.expectedDayRevision, reason: command.reason,
      },
    };
  }
  if (command.kind === 'backfill-opening') {
    return {
      kind: 'backfill-opening',
      input: {
        commandId: command.commandId, leaseEpoch, dayId: command.dayId, expectedDayRevision: command.expectedDayRevision,
        openingCash: command.openingCash, reason: command.reason,
      },
    };
  }
  const base = {
    commandId: command.commandId, leaseEpoch, dayId: command.dayId,
    expectedDayRevision: command.expectedDayRevision, expectedSettlementRevision: command.expectedSettlementRevision,
  };
  if (command.kind === 'close-day') {
    return {
      kind: 'close-day',
      input: {
        ...base, expectedCash: command.expectedCash, countedCash: command.countedCash, note: command.note,
        ...(command.alignWithDayId !== undefined ? { alignWithDayId: command.alignWithDayId } : {}),
      },
    };
  }
  if (command.kind === 'record-post-close-entry') {
    return { kind: 'record-post-close-entry', input: { ...base, direction: command.direction, amount: command.amount, reason: command.reason } };
  }
  return { kind: 'reopen-day', input: { ...base, reason: command.reason } };
}

/** The day's own cash numbers; the close and reopen forms only send what the server already shows. */
function DayFigures({ day }: { day: CloudDayCloseState }) {
  const t = day.totals;
  return (
    <dl className="cloud-day-close__summary" aria-label="營業日現金統計">
      <dt>開帳現金</dt><dd>{day.openingCash === null ? '尚未確認' : formatMoney(day.openingCash)}</dd>
      <dt>收款留存</dt><dd>{formatMoney(t.retainedReceipts)}</dd>
      <dt>櫃台收入</dt><dd>{formatMoney(t.cashierIncome)}</dd>
      <dt>櫃台支出</dt><dd>{formatMoney(t.cashierExpense)}</dd>
      <dt>帳戶退款</dt><dd>{formatMoney(t.accountRefunds)}</dd>
      <dt>應有現金</dt><dd>{day.expectedCash === null ? '需先確認開帳現金' : formatMoney(day.expectedCash)}</dd>
      {day.status === 'closed' && <><dt>有效關帳現金</dt><dd aria-label="有效關帳現金">{day.effectiveCash === null ? '尚未計算' : formatMoney(day.effectiveCash)}</dd></>}
      <dt>有效交易</dt><dd>{t.activeTransactionCount} 筆</dd>
      <dt>份數</dt><dd>今日餐點 {t.bentoCount} · 其他餐點 {t.otherMealCount}</dd>
      <dt>餐費</dt><dd>{formatMoney(t.mealTotal)}</dd>
    </dl>
  );
}

export function CloudDayClosePage({
  db, leaseEpoch, identityKey, onNavigationStateChange, backupBlock, ledger, onOpenAnomalies, onLedgerChanged, initialDayId,
  initialPostCloseEntry, onOpenOrders, hasUnresolvedPendingCommands = false,
}: CloudDayClosePageProps) {
  const onLedgerChangedRef = useRef(onLedgerChanged);
  useEffect(() => { onLedgerChangedRef.current = onLedgerChanged; }, [onLedgerChanged]);
  // The shared §7.4 flag is read at the moment of submission, never from a stale closure.
  const hasUnresolvedRef = useRef(hasUnresolvedPendingCommands);
  useEffect(() => { hasUnresolvedRef.current = hasUnresolvedPendingCommands; }, [hasUnresolvedPendingCommands]);
  const recoveryReader = useMemo(() => getCloudRecoveryReader(db), [db]);
  const repository = useMemo(() => createCloudDayCloseRepository(db, { recoveryReader }), [db, recoveryReader]);
  let currentUid: string | null = null;
  try { currentUid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
  const authorizationScopeKey = `${identityKey}:${leaseEpoch}`;
  const authorizationScopeRef = useRef(authorizationScopeKey);
  const revokedScopeRef = useRef<string | null>(null);
  const pendingCommandIdRef = useRef<string | null>(null);
  const postClosePreflightRef = useRef(false);
  const backfillPlanRef = useRef<BackfillPlan | null>(null);
  const planGenerationRef = useRef(0);
  // A plan generation whose confirmed refresh failed never advances by itself again; only an explicit continue may.
  const autoBlockedGenerationsRef = useRef<Set<number>>(new Set());
  if (authorizationScopeRef.current !== authorizationScopeKey) {
    authorizationScopeRef.current = authorizationScopeKey;
    revokedScopeRef.current = null;
    pendingCommandIdRef.current = null;
  }
  const bindingRef = useRef({ db, uid: currentUid, identityKey, leaseEpoch, version: 0 });
  const operationRef = useRef<DayCloseCommandOperation | null>(null);
  if (bindingRef.current.db !== db || bindingRef.current.uid !== currentUid
    || bindingRef.current.identityKey !== identityKey || bindingRef.current.leaseEpoch !== leaseEpoch) {
    const oldOperation = operationRef.current;
    if (oldOperation?.timerId !== null && oldOperation?.timerId !== undefined) window.clearTimeout(oldOperation.timerId);
    if (oldOperation) {
      oldOperation.completed = true;
      oldOperation.command = null;
      oldOperation.intent = null;
      oldOperation.attemptPromise = null;
    }
    operationRef.current = null;
    backfillPlanRef.current = null;
    postClosePreflightRef.current = false;
    bindingRef.current = { db, uid: currentUid, identityKey, leaseEpoch, version: bindingRef.current.version + 1 };
  }
  const scopeKey = `${identityKey}:${leaseEpoch}:${bindingRef.current.version}`;
  // Only the first owner's first load starts at the requested day; a replayed effect for that same owner keeps it.
  const firstLoadRef = useRef<{ scopeKey: string; dayId: string | undefined; entry: OpeningMismatchAnomaly | undefined } | null>({
    scopeKey, dayId: initialDayId, entry: initialPostCloseEntry,
  });
  const [pageState, setPageStateRaw] = useState<PageState>(() => initialPageState(scopeKey));
  const scopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const readRequestRef = useRef(0);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    readRequestRef.current += 1;
  }

  // The first committed render of a new owner shows nothing of the previous one.
  const currentPage = pageState.scopeKey === scopeKey ? pageState : initialPageState(scopeKey);
  const page = revokedScopeRef.current === authorizationScopeKey
    ? {
      ...currentPage,
      authorizationRevoked: true,
      loading: false,
      loadError: currentPage.loadError || errorMessage({ code: 'LEASE_LOST' }),
      recovery: currentPage.recovery ?? (pendingCommandIdRef.current
        ? { commandId: pendingCommandIdRef.current, phase: 'access-lost' as const }
        : null),
    }
    : currentPage;

  // Event handlers and awaited continuations read the latest committed page, never a stale render closure.
  const latestPageRef = useRef(page);
  useEffect(() => { latestPageRef.current = page; });

  const isCurrent = useCallback((key: string, generation: number) => (
    scopeRef.current === key && generationRef.current === generation
  ), []);

  const ownsOperation = useCallback((operation: DayCloseCommandOperation): operation is DayCloseCommandOperation & {
    command: PreparedCommand;
    intent: CloudDayCloseCommandIntent;
  } => {
    let authenticatedUid: string | null = null;
    try { authenticatedUid = getAuth(operation.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
    return operationRef.current === operation
      && !operation.completed
      && operation.command !== null
      && operation.intent !== null
      && isCurrent(operation.identityKey, operation.generation)
      && bindingRef.current.db === operation.db
      && bindingRef.current.uid === operation.uid
      && bindingRef.current.identityKey === identityKey
      && bindingRef.current.leaseEpoch === operation.leaseEpoch
      && operation.db === db
      && operation.db.app === operation.app
      && operation.uid === authenticatedUid
      && operation.leaseEpoch === leaseEpoch;
  }, [db, identityKey, isCurrent, leaseEpoch]);

  const updateFor = useCallback((key: string, generation: number, update: (previous: PageState) => PageState) => {
    setPageStateRaw(previous => {
      if (!isCurrent(key, generation)) return previous;
      const current = previous.scopeKey === key ? previous : initialPageState(key);
      return update(current);
    });
  }, [isCurrent]);

  const dropOperation = (operation: DayCloseCommandOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
    operation.completed = true;
    operation.command = null;
    operation.intent = null;
    operation.attemptPromise = null;
    if (operationRef.current === operation) operationRef.current = null;
  };

  const revokeAuthorization = useCallback((key: string, generation: number, commandId: string | null, error: unknown) => {
    if (!isCurrent(key, generation)) return;

    // Invalidate all pending reads, writes, and receipt lookups before React commits.
    revokedScopeRef.current = authorizationScopeKey;
    generationRef.current += 1;
    readRequestRef.current += 1;
    const operation = operationRef.current;
    if (operation?.timerId !== null && operation?.timerId !== undefined) window.clearTimeout(operation.timerId);
    if (operation) {
      operation.completed = true;
      operation.command = null;
      operation.intent = null;
      operation.attemptPromise = null;
    }
    operationRef.current = null;
    backfillPlanRef.current = null;
    postClosePreflightRef.current = false;
    const retainedCommandId = commandId ?? pendingCommandIdRef.current;
    pendingCommandIdRef.current = retainedCommandId;
    onNavigationStateChange?.(identityKey, 'revoked');

    setPageStateRaw(previous => {
      if (previous.scopeKey !== key) return previous;
      return {
        ...initialPageState(key),
        authorizationRevoked: true,
        loading: false,
        loadError: errorMessage(error),
        recovery: retainedCommandId ? { commandId: retainedCommandId, phase: 'access-lost' } : null,
      };
    });
  }, [authorizationScopeKey, identityKey, isCurrent, onNavigationStateChange]);

  const loadSnapshot = useCallback(async (
    targetDayId?: string,
    confirmedReceipt?: CommandReceipt,
    confirmedOperation?: DayCloseCommandOperation,
    initialEntry?: OpeningMismatchAnomaly,
  ) => {
    const key = scopeKey;
    const generation = generationRef.current;
    if (revokedScopeRef.current === authorizationScopeKey) return;
    const operation = confirmedOperation ?? operationRef.current;
    if (operation && !ownsOperation(operation)) return;
    if (confirmedReceipt && (!operation || operation.command.commandId !== confirmedReceipt.commandId)) return;
    const requestedDayId = operation?.dayId ?? targetDayId;
    const requestId = ++readRequestRef.current;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: true,
      loadError: '',
      actionError: operation?.receipt ? previous.actionError : '',
      notice: confirmedReceipt ? '已找到伺服器回執，正在重新讀取日結資料…' : '',
      ...(requestedDayId ? { dayIdDraft: requestedDayId } : {}),
    }));

    try {
      const snapshot = await repository.loadSnapshot(requestedDayId);
      if (!isCurrent(key, generation) || requestId !== readRequestRef.current) return;
      const currentOperation = operationRef.current;
      const boundOperation = operation ?? currentOperation;
      const resolvesOperation = confirmedReceipt
        && boundOperation === currentOperation
        && boundOperation?.command?.commandId === confirmedReceipt.commandId
        && boundOperation.receipt?.commandId === confirmedReceipt.commandId
        && ownsOperation(boundOperation);
      if (boundOperation && ownsOperation(boundOperation)
        && (snapshot.datasetId !== boundOperation.datasetId || snapshot.dayId !== boundOperation.dayId)) {
        // Never expose another dataset's or another day's data, and never unlock the original operation.
        const confirmed = !!boundOperation.receipt;
        backfillPlanRef.current = null;
        updateFor(key, generation, previous => ({
          ...previous,
          ...clearDrafts(),
          snapshot: null,
          loading: false,
          loadError: '',
          actionError: confirmed
            ? '命令回執已確認，但伺服器資料集或營業日已變更；已確認狀態仍保留，請勿重送命令。'
            : '目前伺服器資料集或營業日已變更；原命令仍待確認，不能重試。',
          backfillPlan: null,
          recovery: {
            commandId: boundOperation.command.commandId,
            command: boundOperation.command,
            phase: confirmed ? 'receipt' : 'unknown',
            ...(confirmed && boundOperation.receipt ? { receipt: boundOperation.receipt } : {}),
            canRetry: false,
          },
          notice: '',
        }));
        return;
      }
      if (confirmedReceipt && !resolvesOperation) return;
      let acceptedCommand: PreparedCommand | null = null;
      let planFollowUp: BackfillPlan | null = backfillPlanRef.current;
      if (planFollowUp && snapshot.datasetId !== planFollowUp.datasetId) planFollowUp = null;
      let planDone = false;
      if (resolvesOperation && boundOperation) {
        const completedOperation: DayCloseCommandOperation = boundOperation;
        acceptedCommand = boundOperation.command;
        const stepOfPlan = planFollowUp !== null && completedOperation.planGeneration === planFollowUp.generation
          && planFollowUp.dayId === snapshot.dayId;
        if (stepOfPlan && planFollowUp) {
          planDone = snapshot.backfill !== null;
          // The next step may start by itself only after the original submission itself returned this receipt.
          planFollowUp = planDone ? null : {
            ...planFollowUp,
            auto: completedOperation.confirmedByResult && completedOperation.attemptSettled
              && !completedOperation.cleanupWarning && !autoBlockedGenerationsRef.current.has(planFollowUp.generation),
          };
        }
        dropOperation(completedOperation);
        if (confirmedReceipt!.commandId === pendingCommandIdRef.current) pendingCommandIdRef.current = null;
      }
      backfillPlanRef.current = planFollowUp;
      const nextPlan = planFollowUp;
      updateFor(key, generation, previous => {
        const confirmsPending = !!resolvesOperation && !!confirmedReceipt;
        const confirmedCommand = confirmsPending ? acceptedCommand : null;
        const confirmedText = confirmsPending
          ? `已確認 ${confirmedCommand ? commandLabel(confirmedCommand) : '雲端操作'} 完成；伺服器資料已重新讀取（命令序號 ${confirmedReceipt.seq}）。${boundOperation?.cleanupWarning ? ' ' + boundOperation.cleanupWarning : ''}`
          : '';
        const dayId = snapshot.dayId;
        return {
          ...previous,
          ...clearDrafts(),
          snapshot,
          dayIdDraft: dayId,
          loading: false,
          loadError: '',
          actionError: '',
          backfillPlan: nextPlan,
          recovery: confirmsPending ? null : previous.recovery,
          postCloseReference: confirmedReceipt?.kind === 'RecordPostCloseEntry'
            ? null
            : initialEntry ?? (previous.postCloseReference?.previousClosedDayId === dayId ? previous.postCloseReference : null),
          postCloseDirection: initialEntry
            ? initialEntry.difference > 0 ? 'income' : 'expense'
            : previous.postCloseDirection,
          postCloseAmountText: initialEntry
            ? String(Math.abs(initialEntry.difference))
            : previous.postCloseReference?.previousClosedDayId === dayId ? String(Math.abs(previous.postCloseReference.difference)) : '',
          postCloseReason: '',
          notice: planDone ? `${confirmedText}${dayId} 已標為回填，可以到訂餐頁補登交易。` : confirmedText,
        };
      });
      // Once, after the accepted same-owner, same-dataset, same-day snapshot.
      if (resolvesOperation && confirmedReceipt) onLedgerChangedRef.current?.();
    } catch (error) {
      if (!isCurrent(key, generation) || requestId !== readRequestRef.current) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, operation?.command.commandId ?? confirmedReceipt?.commandId ?? null, error);
        return;
      }
      // A failed page read stops all automatic progress of the plan; a later manual reload only reads.
      const failedPlan = backfillPlanRef.current;
      if (failedPlan) {
        autoBlockedGenerationsRef.current.add(failedPlan.generation);
        backfillPlanRef.current = { ...failedPlan, auto: false };
      }
      const heldOperation = operationRef.current;
      const heldRecovery: RecoveryState | null = heldOperation && ownsOperation(heldOperation)
        ? {
          commandId: heldOperation.command.commandId,
          command: heldOperation.command,
          phase: heldOperation.receipt ? 'receipt' as const : 'unknown' as const,
          ...(heldOperation.receipt ? { receipt: heldOperation.receipt } : {}),
          canRetry: false,
        }
        : null;
      updateFor(key, generation, previous => {
        const recovery = heldRecovery ?? previous.recovery;
        return {
          ...previous,
          ...clearDrafts(),
          snapshot: null,
          loading: false,
          loadError: errorMessage(error),
          backfillPlan: previous.backfillPlan ? { ...previous.backfillPlan, auto: false } : null,
          actionError: operation?.receipt
            ? '已找到命令回執，但伺服器資料尚未重新讀取；請只重新讀取資料，不要重送命令。'
            : heldOperation
              ? '目前無法安全重新讀取原日結資料；原命令仍維持鎖定狀態。'
              : '',
          recovery,
          notice: '',
        };
      });
    }
  }, [authorizationScopeKey, isCurrent, ownsOperation, repository, revokeAuthorization, scopeKey, updateFor]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const latched = revokedScopeRef.current === authorizationScopeKey;
    const initial = initialPageState(scopeKey);
    setPageStateRaw(latched ? {
      ...initial,
      authorizationRevoked: true,
      loading: false,
      loadError: errorMessage({ code: 'LEASE_LOST' }),
      recovery: pendingCommandIdRef.current
        ? { commandId: pendingCommandIdRef.current, phase: 'access-lost' }
        : null,
    } : initial);
    const first = firstLoadRef.current?.scopeKey === scopeKey ? firstLoadRef.current : null;
    if (first === null) firstLoadRef.current = null;
    if (!latched) void loadSnapshot(first?.dayId, undefined, undefined, first?.entry);
    return () => {
      readRequestRef.current += 1;
      const operation = operationRef.current;
      if (operation?.generation === generation) dropOperation(operation);
      // The plan, its pending continuation and the preflight lock die with the mounted owner.
      backfillPlanRef.current = null;
      postClosePreflightRef.current = false;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [authorizationScopeKey, loadSnapshot, scopeKey]);

  const hasRecovery = page.recovery !== null;
  useEffect(() => {
    onNavigationStateChange?.(
      identityKey,
      page.authorizationRevoked ? 'revoked' : hasRecovery ? 'recovering' : 'resolved',
    );
  }, [hasRecovery, identityKey, onNavigationStateChange, page.authorizationRevoked]);

  const clearOperationTimer = (operation: DayCloseCommandOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
  };

  const showUnknownResult = (operation: DayCloseCommandOperation, message: string) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    const command = operation.command;
    clearOperationTimer(operation);
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous, snapshot: null, loading: false, loadError: '', actionError: message,
      recovery: {
        commandId: command.commandId, command,
        phase: operation.checking ? 'checking' : 'unknown', timedOut: false, canRetry: false,
      },
    }));
  };

  const beginAttempt = (operation: DayCloseCommandOperation) => {
    clearOperationTimer(operation);
    operation.attempt += 1;
    operation.attemptPromise = null;
    operation.attemptSettled = false;
    operation.retryAuthorized = false;
    operation.querySequence += 1;
    operation.checking = false;
    const attempt = operation.attempt;
    const promptCommandId = operation.command?.commandId ?? '';
    // The ten-second mark is only a status prompt: no abort, no new ID, no automatic retry.
    operation.timerId = window.setTimeout(() => {
      if (!ownsOperation(operation) || operation.attempt !== attempt || operation.attemptSettled || operation.receipt) return;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        recovery: previous.recovery !== null && previous.recovery.commandId === promptCommandId
          ? { ...previous.recovery, phase: 'submitting' as const, timedOut: true, canRetry: false }
          : previous.recovery,
      }));
    }, 10_000);
  };

  const settleWithReceipt = async (operation: DayCloseCommandOperation, receipt: CommandReceipt) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    const command = operation.command;
    const intent = operation.intent;
    if (receipt.commandId !== command.commandId) {
      showUnknownResult(operation, '伺服器回執命令編號不符；保留原命令編號，尚未確認完成。');
      return;
    }
    clearOperationTimer(operation);
    operation.receipt = receipt;
    operation.retryAuthorized = false;
    operation.checking = false;
    operation.querySequence += 1;
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous, actionError: '',
      recovery: { commandId: command.commandId, command, phase: 'receipt', receipt },
    }));
    try {
      const cleared = await repository.cleanupConfirmedIntent(
        intent, operation.datasetId, operation.uid, () => {
          let uid: string | null = null;
          try { uid = getAuth(operation.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
          return operationRef.current === operation && !operation.completed
            && generationRef.current === operation.generation && scopeRef.current === operation.identityKey
            && bindingRef.current.db === operation.db && bindingRef.current.uid === operation.uid
            && bindingRef.current.identityKey === identityKey
            && bindingRef.current.leaseEpoch === operation.leaseEpoch && uid === operation.uid
            && typeof navigator !== 'undefined' && navigator.onLine;
        },
      );
      if (!cleared && ownsOperation(operation)) operation.cleanupWarning = '本機命令追蹤尚未清理；伺服器回執仍已確認。';
    } catch (error) {
      if (!ownsOperation(operation)) return;
      if (isAuthorizationLoss(error)) {
        // Observed authority loss ends this operation before any snapshot or callback, even if the parent lags.
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
        return;
      }
      operation.cleanupWarning = '本機命令追蹤清理未完成；伺服器回執仍已確認。';
    }
    if (ownsOperation(operation)) await loadSnapshot(operation.dayId, receipt, operation);
  };

  const finishCommandResult = async (operation: DayCloseCommandOperation, result: CommandResult, attempt: number) => {
    if (!ownsOperation(operation) || operation.attempt !== attempt) return;
    operation.attemptSettled = true;
    clearOperationTimer(operation);
    if (operation.receipt || operation.completed) return;
    if (!result.ok) {
      if (isAuthorizationLoss(result.error)) {
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, result.error);
        return;
      }
      if (result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
        showUnknownResult(operation, '操作回應不確定；請唯讀查詢原命令結果。查詢錯誤或找不到結果都不會自動重送。');
        return;
      }
      const failedCommand = operation.command;
      const failedPlanGeneration = operation.planGeneration;
      dropOperation(operation);
      pendingCommandIdRef.current = null;
      // A definite refusal stops all automatic progress; the plan stays for an explicit continue.
      const stoppedPlan = backfillPlanRef.current && failedPlanGeneration === backfillPlanRef.current.generation
        ? { ...backfillPlanRef.current, auto: false }
        : backfillPlanRef.current;
      backfillPlanRef.current = stoppedPlan;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        ...clearDrafts(),
        snapshot: null,
        loading: false,
        loadError: `${commandLabel(failedCommand)}未完成：${errorMessage(result.error)}請重新載入伺服器資料後再確認。${
          stoppedPlan && failedPlanGeneration === stoppedPlan.generation
            ? `回填 ${stoppedPlan.dayId} 停在這一步；已完成的步驟不會重做，重新載入後可以按「繼續回填」從這一步接著做。`
            : ''}`,
        actionError: result.error.code === 'LOCAL_STORAGE_UNAVAILABLE' ? errorMessage(result.error) : '',
        backfillPlan: stoppedPlan,
        recovery: null,
        notice: '',
      }));
      return;
    }
    operation.confirmedByResult = true;
    await settleWithReceipt(operation, result.receipt);
  };

  const runPreparedCommand = async (
    command: PreparedCommand,
    retryOperation?: DayCloseCommandOperation,
    planGeneration: number | null = null,
  ) => {
    let operation = retryOperation;
    if (!browserIsOnline()) {
      if (operation) operation.retryAuthorized = false;
      updateFor(scopeKey, generationRef.current, previous => ({
        ...previous,
        actionError: '目前離線，沒有送出或重試命令；請恢復連線後重新查詢原命令。',
        recovery: previous.recovery ? { ...previous.recovery, canRetry: false } : null,
      }));
      return;
    }
    if (operation) {
      if (!ownsOperation(operation) || !operation.attemptSettled || !operation.retryAuthorized
        || operation.receipt || operation.checking) return;
      operation.retryAuthorized = false;
      if (command.kind === 'close-day') {
        // A same-ID retry resolves its own original operation; any other pending identity still blocks closing.
        operation.checking = true;
        const retrying = operation;
        updateFor(retrying.identityKey, retrying.generation, previous => ({
          ...previous, actionError: '',
          recovery: previous.recovery ? { ...previous.recovery, phase: 'checking', canRetry: false } : previous.recovery,
        }));
        // Unreadable or incomplete journal state counts as another unresolved identity.
        const others = await repository.hasOtherUnresolvedCommands(command.commandId).catch(() => true);
        if (!ownsOperation(retrying)) return;
        retrying.checking = false;
        if (others) {
          updateFor(retrying.identityKey, retrying.generation, previous => ({
            ...previous, actionError: '尚有其他待核對命令；依系統關帳規則，先完成它們的結果確認後才能重試關帳。保留原編號，不要重新收款。',
            recovery: { commandId: command.commandId, command, phase: 'unknown', canRetry: false },
          }));
          return;
        }
      }
    } else {
      const latest = latestPageRef.current;
      if (operationRef.current || latest.recovery || !latest.snapshot) return;
      const loadedSnapshot = latest.snapshot;
      const key = scopeKey;
      const generation = generationRef.current;
      if (revokedScopeRef.current === authorizationScopeKey) return;
      if (!identityKey || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1) {
        revokeAuthorization(key, generation, command.commandId, {
          code: 'LEASE_LOST', message: '目前沒有有效的操作使用權，雲端資料已清除。請重新確認使用權。',
        });
        return;
      }
      if (command.kind === 'close-day' && hasUnresolvedRef.current) {
        // No path (button, form submit, keyboard, workflow) can bypass the shared §7.4 restriction.
        updateFor(key, generation, previous => ({ ...previous, actionError: CLOSE_BLOCKED_MESSAGE }));
        return;
      }
      let uid: string | null = null;
      try { uid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
      if (!uid) {
        revokeAuthorization(key, generation, command.commandId, {
          code: 'UNAUTHORIZED', message: '目前登入身分尚未確認，雲端資料已清除。請重新登入操作員帳號。',
        });
        return;
      }
      const frozen = freezeValue(command);
      operation = {
        token: Symbol('cloud-day-close-operation'), identityKey: key, generation, db, app: db.app,
        uid, leaseEpoch, datasetId: loadedSnapshot.datasetId, dayId: frozen.dayId,
        command: frozen, intent: freezeValue(intentFor(frozen, leaseEpoch)), attempt: 0,
        attemptPromise: null, attemptSettled: false,
        querySequence: 0, checking: false, retryAuthorized: false, receipt: null,
        confirmedByResult: false, planGeneration, completed: false, timerId: null, cleanupWarning: '',
      };
      operationRef.current = operation;
      pendingCommandIdRef.current = frozen.commandId;
      onNavigationStateChange?.(identityKey, 'recovering');
    }
    if (!ownsOperation(operation)) return;
    beginAttempt(operation);
    const submittedCommand = operation.command;
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous, snapshot: null, loading: false, loadError: '', actionError: '', notice: '',
      recovery: {
        commandId: submittedCommand.commandId, command: submittedCommand,
        phase: 'submitting', timedOut: false, canRetry: false,
      },
      postCloseChecking: false,
    }));
    const attempt = operation.attempt;
    const active = operation;
    const isRetry = attempt > 1;
    const guard = async (): Promise<boolean> => {
      if (!ownsOperation(active) || active.attempt !== attempt) return false;
      if (active.command.kind !== 'close-day') return true;
      if (!isRetry) return !hasUnresolvedRef.current;
      const others = await repository.hasOtherUnresolvedCommands(active.command.commandId);
      return !others && ownsOperation(active) && active.attempt === attempt;
    };
    const attemptPromise = repository.commitDayCloseIntent(operation.intent, guard);
    operation.attemptPromise = attemptPromise;
    try {
      const result = await attemptPromise;
      if (!ownsOperation(operation) || operation.attempt !== attempt) return;
      operation.attemptSettled = true;
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
      await finishCommandResult(operation, result, attempt);
    } catch (error) {
      if (!ownsOperation(operation) || operation.attempt !== attempt) return;
      operation.attemptSettled = true;
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
      clearOperationTimer(operation);
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
      } else if (isGuardRejected(error)) {
        // Rejected before any journal write or transaction: a first attempt never reached the server.
        if (!isRetry) {
          const refusedCommand = operation.command;
          const refusedPlanGeneration = operation.planGeneration;
          dropOperation(operation);
          pendingCommandIdRef.current = null;
          const stoppedPlan = backfillPlanRef.current && refusedPlanGeneration === backfillPlanRef.current.generation
            ? { ...backfillPlanRef.current, auto: false }
            : backfillPlanRef.current;
          backfillPlanRef.current = stoppedPlan;
          updateFor(operation.identityKey, operation.generation, previous => ({
            ...previous, ...clearDrafts(), snapshot: null, loading: false, loadError: '',
            actionError: refusedCommand.kind === 'close-day'
              ? CLOSE_BLOCKED_MESSAGE
              : `${commandLabel(refusedCommand)}沒有送出：送出前的條件已改變。請重新載入伺服器資料後再確認。`,
            backfillPlan: stoppedPlan, recovery: null, notice: '',
          }));
        } else {
          const heldCommand = operation.command;
          updateFor(operation.identityKey, operation.generation, previous => ({
            ...previous, snapshot: null, loading: false, loadError: '',
            actionError: '尚有其他待核對命令，或送出前的條件已改變；這次沒有送出。請重新查詢原命令結果，不要重新收款。',
            recovery: { commandId: heldCommand.commandId, command: heldCommand, phase: 'unknown', canRetry: false },
          }));
        }
      } else {
        showUnknownResult(operation, '操作回應不確定；請唯讀查詢原命令結果。查詢錯誤或找不到結果都不會自動重送。');
      }
    } finally {
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
    }
  };

  const checkPendingCommand = async () => {
    const recovery = page.recovery;
    const operation = operationRef.current;
    if (revokedScopeRef.current === authorizationScopeKey || !recovery?.command || !operation
      || operation.command?.commandId !== recovery.commandId || operation.checking || operation.receipt
      || (recovery.phase === 'submitting' && !recovery.timedOut) || !ownsOperation(operation)) return;
    if (!browserIsOnline()) {
      operation.retryAuthorized = false;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        actionError: '目前離線；查詢錯誤不代表命令不存在，暫不可重試。',
        recovery: { ...recovery, canRetry: false },
      }));
      return;
    }
    operation.checking = true;
    const command = operation.command;
    const intent = operation.intent;
    const attemptAtStart = operation.attempt;
    const attemptPromiseAtStart = operation.attemptPromise;
    const settledAtStart = operation.attemptSettled && attemptPromiseAtStart === null;
    operation.retryAuthorized = false;
    const querySequence = ++operation.querySequence;
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous, actionError: '', recovery: { ...recovery, phase: 'checking', canRetry: false },
    }));
    try {
      const check = await repository.confirmPendingIntent(intent, operation.datasetId, operation.uid);
      if (!ownsOperation(operation) || operation.querySequence !== querySequence
        || operation.attempt !== attemptAtStart || operation.receipt) return;
      if (check.status === 'matched') {
        await settleWithReceipt(operation, check.receipt);
        return;
      }
      if (check.status === 'different-dataset') {
        updateFor(operation.identityKey, operation.generation, previous => ({
          ...previous, ...clearDrafts(), snapshot: null, loading: false, loadError: '',
          actionError: '目前伺服器資料集已變更；原操作尚未確認，請聯絡維護者，不可重試。',
          recovery: { commandId: command.commandId, command, phase: 'unknown', canRetry: false },
        }));
        return;
      }
      // Only a successful fresh null that began after the same attempt settled can allow an explicit retry.
      const mayRetry = settledAtStart && operation.attemptSettled && operation.attemptPromise === null;
      operation.retryAuthorized = mayRetry;
      const settledNow = operation.attemptSettled;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous, snapshot: null, loading: false, loadError: '',
        actionError: mayRetry
          ? '伺服器目前尚未找到這筆命令。沒有產生新的命令編號；確認後可明確選擇同編號重試。'
          : settledAtStart
            ? '原命令狀態在查詢期間改變；這次查詢不能授權重試。請重新查詢原命令。'
            : settledNow
              ? '這次查詢開始時原命令仍在送出中；未找到結果不能授權重試。請在原命令結束後重新查詢。'
              : '查詢尚未找到回執，但原命令仍在送出中；目前不能重試。請等待原命令結束後再查詢。',
        recovery: {
          commandId: command.commandId, command,
          phase: settledNow ? 'unknown' : 'submitting', timedOut: !settledNow,
          canRetry: mayRetry,
        },
      }));
    } catch (error) {
      if (!ownsOperation(operation) || operation.querySequence !== querySequence || operation.receipt) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
        return;
      }
      operation.retryAuthorized = false;
      const settledNow = operation.attemptSettled;
      const code = errorCode(error);
      const message = code === 'MAINTENANCE'
        ? '系統維護中，暫停同編號重試；請稍後重新查詢。'
        : code === 'QUOTA_EXCEEDED'
          ? '查詢次數已達限制，尚未確認命令不存在；請稍後重新查詢，不可重試。'
          : code === 'UNSUPPORTED_SCHEMA'
            ? '雲端命令格式不支援，尚未確認操作結果；請聯絡維護者，不可重試。'
            : code === 'INVALID_INPUT'
              ? '命令編號已存在，但伺服器內容與原操作不符；仍未確認完成，不可重試。'
              : '目前無法安全確認原命令；查詢錯誤不代表命令不存在，暫不可重試。';
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous, snapshot: null, loading: false, loadError: '', actionError: message,
        recovery: {
          commandId: command.commandId, command,
          phase: settledNow ? 'unknown' : 'submitting',
          timedOut: !settledNow, canRetry: false,
        },
      }));
    } finally {
      if (operationRef.current === operation && operation.querySequence === querySequence) operation.checking = false;
    }
  };

  const retryPendingCommand = (operation: DayCloseCommandOperation) => {
    if (!ownsOperation(operation)) return;
    void runPreparedCommand(operation.command, operation, operation.planGeneration);
  };


  const updatePage = (action: SetStateAction<PageState>) => updateFor(scopeKey, generationRef.current, previous => (
    typeof action === 'function' ? action(previous) : action
  ));

  const makeCommandId = (): string | null => {
    const commandId = clientCommandId();
    if (commandId) return commandId;
    updatePage(previous => ({
      ...previous,
      actionError: '瀏覽器無法建立安全的命令編號，沒有送出操作。請重新載入安全連線後再試。',
    }));
    return null;
  };

  const submitDateSelection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const snapshot = page.snapshot;
    if (page.recovery || operationRef.current || !snapshot) return;
    if (!isBusinessDate(page.dayIdDraft) || page.dayIdDraft < snapshot.overview.goLiveDate) {
      updatePage(previous => ({ ...previous, actionError: `日期必須是 ${snapshot.overview.goLiveDate} 或之後的有效日期。` }));
      return;
    }
    if (page.dayIdDraft === snapshot.dayId) return;
    void loadSnapshot(page.dayIdDraft);
  };

  const snapshot = page.snapshot;
  const day = snapshot?.day ?? null;
  const selectionDate = snapshot?.overview.selectionDate ?? '';
  // Contract §14: a back-filled day closes with no difference, aligned to the next opened day's opening cash.
  const backfillClose = !!snapshot?.backfill && !!day && day.status !== 'closed';
  const alignLookup = backfillClose ? snapshot?.align ?? null : null;
  const alignNext = alignLookup?.status === 'ready' ? alignLookup.next : null;
  const alignTarget = alignNext ? alignNext.openingCash : day?.expectedCash ?? null;
  const alignGap = alignLookup?.status === 'ready' && day?.expectedCash !== null && day?.expectedCash !== undefined && alignTarget !== null
    ? day.expectedCash - alignTarget
    : null;
  const countedText = backfillClose && page.countedText === '' && alignTarget !== null ? String(alignTarget) : page.countedText;
  const countedCash = /^\d+$/.test(countedText) ? Number(countedText) : null;
  const difference = countedCash !== null && day?.expectedCash !== null && day?.expectedCash !== undefined
    ? countedCash - day.expectedCash
    : null;
  const canClose = !!snapshot && !!day && day.status !== 'closed' && day.expectedCash !== null && snapshot.dayId <= selectionDate;
  const closeBlocked = hasUnresolvedPendingCommands || backfillClose && (alignLookup?.status !== 'ready' || alignGap !== 0);
  // A past day that never confirmed its opening cash (for example the network was down) can get it backfilled.
  const canBackfill = !!snapshot && !!day && day.status !== 'closed' && day.openingCash === null && snapshot.dayId < selectionDate;
  const backfillCash = /^\d+$/.test(page.backfillText) ? Number(page.backfillText) : null;

  const submitClose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || operationRef.current || !snapshot || !day || !canClose || day.expectedCash === null) return;
    if (hasUnresolvedPendingCommands || hasUnresolvedRef.current) {
      updatePage(previous => ({ ...previous, actionError: CLOSE_BLOCKED_MESSAGE }));
      return;
    }
    if (closeBlocked) {
      updatePage(previous => ({ ...previous, actionError: alignLookup?.status !== 'ready'
        ? '還沒查到要對齊的開帳日，請重新載入後再關帳。'
        : `回填日的應有現金還差 ${Math.abs(alignGap ?? 0)} 元，請先回訂餐頁補登交易或收支，再回來關帳。` }));
      return;
    }
    if (countedCash === null || !Number.isSafeInteger(countedCash) || countedCash > 1_000_000_000) {
      updatePage(previous => ({ ...previous, actionError: '實點現金必須明確輸入 0 至 1,000,000,000 元的整數；空白、負數與小數均不接受。' }));
      return;
    }
    const note = page.note.trim();
    if (backfillClose && (countedCash !== day.expectedCash || countedCash !== alignTarget)) {
      updatePage(previous => ({ ...previous, actionError: `回填日的實點必須等於 ${alignTarget === null ? '應有現金' : formatMoney(alignTarget)}，不接受差額說明。` }));
      return;
    }
    if (countedCash !== day.expectedCash && note.length < 1) {
      updatePage(previous => ({ ...previous, actionError: '實點與應有現金不同，請填寫差額原因後再關帳。' }));
      return;
    }
    if (note.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '差額原因最多 500 個字元。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'close-day',
      commandId,
      dayId: snapshot.dayId,
      expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision,
      expectedCash: day.expectedCash,
      countedCash,
      note,
      ...(backfillClose ? { alignWithDayId: alignNext?.dayId ?? null } : {}),
    });
  };

  const submitReopen = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || operationRef.current || !snapshot || !day || day.status !== 'closed') return;
    const reason = page.reopenReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '重開原因必須為 1 至 500 個字元。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'reopen-day',
      commandId,
      dayId: snapshot.dayId,
      expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision,
      reason,
    });
  };

  const submitPostCloseEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || operationRef.current || page.postCloseChecking || postClosePreflightRef.current
      || !snapshot || !day || day.status !== 'closed') return;
    const amountText = page.postCloseAmountText.trim();
    const amount = /^\d+$/.test(amountText) ? Number(amountText) : null;
    if (amount === null || !Number.isSafeInteger(amount) || amount < 1 || amount > 20_000) {
      updatePage(previous => ({ ...previous, actionError: '關帳後補記金額必須明確輸入 1 至 20,000 元的整數；空白、零、負數與小數均不接受。' }));
      return;
    }
    const reason = page.postCloseReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '關帳後補記原因必須為 1 至 500 個字元。' }));
      return;
    }
    if (page.postCloseRequiresConfirmation && !page.postCloseConfirmed) {
      updatePage(previous => ({ ...previous, actionError: '請先核對更新後的差額與關帳現金，再確認補記。' }));
      return;
    }

    const reference = page.postCloseReference;
    if (reference) {
      if (postClosePreflightRef.current) return;
      postClosePreflightRef.current = true;
      const key = scopeKey;
      const generation = generationRef.current;
      const readId = readRequestRef.current;
      const preflightUid = bindingRef.current.uid;
      // After every await: same owner, same signed-in user, and no other page read replaced the one we validated.
      const stillCurrent = () => {
        let uid: string | null = null;
        try { uid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
        return isCurrent(key, generation) && readRequestRef.current === readId && uid !== null && uid === preflightUid
          && operationRef.current === null;
      };
      updatePage(previous => ({ ...previous, postCloseChecking: true, actionError: '', postCloseStaleMessage: '' }));
      try {
        const [freshDay, freshLedger] = await Promise.all([
          repository.read(snapshot.dayId),
          repository.readLedger(),
        ]);
        if (!stillCurrent()) return;
        const latestMismatch = freshLedger.anomalies.find((anomaly): anomaly is OpeningMismatchAnomaly => (
          anomaly.kind === 'opening-mismatch' && anomaly.dayId === reference.dayId
        ));
        const targetDayId = latestMismatch && latestMismatch.gapDayCount === 0
          ? latestMismatch.previousClosedDayId
          : snapshot.dayId;
        const targetDay = targetDayId === snapshot.dayId ? freshDay : await repository.read(targetDayId);
        if (!stillCurrent()) return;

        const unchanged = freshDay !== null
          && freshDay.status === 'closed'
          && freshDay.revision === day.revision
          && freshDay.lastSettlementRevision === day.lastSettlementRevision
          && latestMismatch !== undefined
          && latestMismatch.gapDayCount === 0
          && latestMismatch.previousClosedDayId === snapshot.dayId
          && sameOpeningMismatch(reference, latestMismatch);
        if (!unchanged) {
          const refreshedReference = latestMismatch && latestMismatch.gapDayCount === 0 && targetDay?.status === 'closed'
            ? latestMismatch
            : null;
          const refreshedDaySnapshot: DaySnapshot = {
            ...snapshot,
            dayId: targetDayId,
            day: targetDay,
            backfill: null,
            previous: null,
            align: null,
          };
          updatePage(previous => ({
            ...previous,
            snapshot: refreshedDaySnapshot,
            dayIdDraft: targetDayId,
            postCloseDirection: refreshedReference ? entryDirectionForDifference(refreshedReference.difference) : 'income',
            postCloseAmountText: refreshedReference ? String(Math.abs(refreshedReference.difference)) : '',
            postCloseReason: '',
            postCloseReference: refreshedReference,
            postCloseChecking: false,
            postCloseRequiresConfirmation: refreshedReference !== null,
            postCloseConfirmed: false,
            postCloseStaleMessage: refreshedReference
              ? '資料已更新，補記沒有送出。請核對更新後的差額與關帳現金，勾選確認後再送出。'
              : '資料已更新，補記沒有送出。差額異常已消失或目前無法補記，請回帳務異常重新確認。',
            actionError: '',
          }));
          onLedgerChangedRef.current?.();
          return;
        }
      } catch (error) {
        if (!isCurrent(key, generation)) return;
        if (isAuthorizationLoss(error)) {
          revokeAuthorization(key, generation, null, error);
          return;
        }
        if (!stillCurrent()) {
          updatePage(previous => ({ ...previous, postCloseChecking: false }));
          return;
        }
        updatePage(previous => ({
          ...previous,
          postCloseChecking: false,
          actionError: `送出前無法重新確認關帳版本與差額，補記沒有送出。${errorMessage(error)}請重新載入後再核對。`,
        }));
        return;
      } finally {
        postClosePreflightRef.current = false;
      }
      if (!stillCurrent()) {
        updatePage(previous => ({ ...previous, postCloseChecking: false }));
        return;
      }
      updatePage(previous => ({ ...previous, postCloseChecking: false }));
    }

    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'record-post-close-entry',
      commandId,
      dayId: snapshot.dayId,
      expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision,
      direction: page.postCloseDirection,
      amount,
      reason,
    });
  };

  const submitBackfill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || operationRef.current || !snapshot || !day || !canBackfill) return;
    if (backfillCash === null || !Number.isSafeInteger(backfillCash) || backfillCash > 20_000) {
      updatePage(previous => ({ ...previous, actionError: '開帳現金必須明確輸入 0 至 20,000 元的整數；空白、負數與小數均不接受。' }));
      return;
    }
    const reason = page.backfillReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '補開帳原因必須為 1 至 500 個字元。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'backfill-opening',
      commandId,
      dayId: snapshot.dayId,
      expectedDayRevision: day.revision,
      openingCash: backfillCash,
      reason,
    });
  };

  // The backfill form (contract §13): reason, opening cash where the day has none, and a difference reason.
  const startOpeningNeeded = !!snapshot && (!day || day.openingCash === null);
  const previousClosed = snapshot?.previous?.status === 'ready' ? snapshot.previous.previous : null;
  const defaultOpeningText = previousClosed ? String(effectiveCashOf(previousClosed)) : '';
  const startOpeningText = (page.startOpeningText ?? defaultOpeningText).trim();
  const startOpeningCash = /^\d+$/.test(startOpeningText) ? Number(startOpeningText) : null;
  const startDifference = startOpeningNeeded && startOpeningCash !== null ? openingDifference(previousClosed, startOpeningCash) : null;
  const canStartBackfill = !!snapshot && !snapshot.backfill && snapshot.dayId < selectionDate
    && snapshot.dayId >= snapshot.overview.goLiveDate && (!day || (day.status === 'open' && day.lastSettlementRevision === 0));


  const abandonBackfill = () => {
    backfillPlanRef.current = null;
    updatePage(previous => ({ ...previous, backfillPlan: null, actionError: '' }));
  };

  /**
   * Run the next needed step of an explicitly initiated plan. Which step is needed comes only from the freshly
   * loaded server state of the same dataset and day; every step gets its own command ID exactly once.
   */
  const runBackfillStep = (plan: BackfillPlan, loaded: DaySnapshot) => {
    if (operationRef.current || latestPageRef.current.recovery) return;
    let uid: string | null = null;
    try { uid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
    if (loaded.datasetId !== plan.datasetId || loaded.dayId !== plan.dayId || uid === null || uid !== plan.uid
      || bindingRef.current.uid !== plan.uid) {
      backfillPlanRef.current = null;
      updatePage(previous => ({
        ...previous, backfillPlan: null,
        actionError: '伺服器資料集、營業日或登入身分已改變，回填計畫已取消；沒有送出任何步驟。請重新載入後再開始。',
      }));
      return;
    }
    const step = nextBackfillStep(plan, loaded, clientCommandId);
    if (step === null) {
      backfillPlanRef.current = null;
      updatePage(previous => ({ ...previous, backfillPlan: null }));
      return;
    }
    if ('blocked' in step) {
      backfillPlanRef.current = null;
      updatePage(previous => ({ ...previous, backfillPlan: null, actionError: step.blocked }));
      return;
    }
    // The continuation token is consumed here: a rerender, an effect replay or a second click cannot start another step.
    const consumed: BackfillPlan = { ...plan, auto: false };
    backfillPlanRef.current = consumed;
    updatePage(previous => ({ ...previous, backfillPlan: consumed }));
    void runPreparedCommand(step, undefined, consumed.generation);
  };

  const submitStartBackfill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || operationRef.current || !snapshot || !canStartBackfill) return;
    const reason = page.startReason.trim();
    if (reason.length < 1 || reason.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '回填原因必須為 1 至 500 個字元。' }));
      return;
    }
    let openingCash: number | null = null;
    let openingReason = reason;
    if (startOpeningNeeded) {
      if (snapshot.previous?.status !== 'ready') {
        updatePage(previous => ({ ...previous, actionError: '還沒有確認上一個已關帳日的實點現金，請重新載入伺服器資料後再回填。' }));
        return;
      }
      if (startOpeningCash === null || !Number.isSafeInteger(startOpeningCash) || startOpeningCash > 20_000) {
        updatePage(previous => ({ ...previous, actionError: '開帳現金必須明確輸入 0 至 20,000 元的整數；空白、負數與小數均不接受。' }));
        return;
      }
      openingCash = startOpeningCash;
      if (startDifference !== null) {
        openingReason = page.startOpeningReason.trim();
        if (openingReason.length < 1 || openingReason.length > 500) {
          updatePage(previous => ({ ...previous, actionError: '開帳現金與上次關帳實點不同，必須填寫 1 至 500 字的差額原因。' }));
          return;
        }
      }
    }
    const uid = bindingRef.current.uid;
    if (!uid) return;
    runBackfillStep({
      generation: ++planGenerationRef.current, datasetId: snapshot.datasetId, uid, dayId: snapshot.dayId,
      reason, openingCash, openingReason, auto: false,
    }, snapshot);
  };

  const continueBackfill = () => {
    const plan = backfillPlanRef.current;
    if (page.recovery || operationRef.current || !snapshot || !plan || plan.dayId !== snapshot.dayId) return;
    runBackfillStep(plan, snapshot);
  };

  const advanceBackfillRef = useRef(continueBackfill);
  useEffect(() => { advanceBackfillRef.current = continueBackfill; });
  const autoPlan = page.backfillPlan;
  const autoGeneration = autoPlan?.generation ?? null;
  const autoAdvance = autoPlan?.auto === true && !!snapshot && !page.loading && page.recovery === null
    && snapshot.dayId === autoPlan.dayId && snapshot.datasetId === autoPlan.datasetId;
  useEffect(() => {
    if (!autoAdvance) return undefined;
    // The confirmed step's command flight is already released when this effect runs. Replays of the effect (StrictMode,
    // rerenders) cancel the earlier continuation, and the plan's own token is consumed by the step it starts.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const plan = backfillPlanRef.current;
      if (!plan || !plan.auto || plan.generation !== autoGeneration || operationRef.current) return;
      advanceBackfillRef.current();
    });
    return () => { cancelled = true; };
  }, [autoAdvance, autoGeneration, snapshot]);

  const busy = page.recovery !== null || page.postCloseChecking;
  const needsAttention = snapshot?.overview.unclosedDays.filter(item => item.kind !== 'no-business') ?? [];
  const noBusiness = snapshot?.overview.unclosedDays.filter(item => item.kind === 'no-business') ?? [];
  const currentKind = snapshot && day && day.status !== 'closed' && day.openingCash === null
    ? (snapshot.dayId < selectionDate && day.totals.activeTransactionCount === 0 ? 'no-business' : 'missing-opening')
    : null;

  return (
    <main className="cloud-day-close" aria-label="雲端日結">
      <header className="cloud-day-close__header">
        <div>
          <p className="cloud-day-close__eyebrow">雲端資料 · 線上操作</p>
          <h1>日結、關帳與重開</h1>
          <p className="cloud-day-close__intro">應有現金由伺服器依營業日統計計算：開帳現金＋收款留存＋櫃台收入－櫃台支出－帳戶退款。每次關帳或重開都新增一個不能修改的日結版本。</p>
        </div>
        <button
          type="button"
          className="cloud-day-close__secondary"
          onClick={() => void loadSnapshot((snapshot?.dayId ?? page.dayIdDraft) || undefined, page.recovery?.phase === 'receipt' ? page.recovery.receipt : undefined)}
          disabled={page.loading || !identityKey || page.authorizationRevoked}
        >
          {page.loading ? '載入中…' : '重新載入伺服器資料'}
        </button>
      </header>

      <LedgerUnclosedBanner ledger={ledger} onOpenAnomalies={onOpenAnomalies} />
      {page.loadError && <div className="cloud-day-close__alert" role="alert">{page.loadError}</div>}
      {page.actionError && <div className="cloud-day-close__alert" role="alert">{page.actionError}</div>}
      {page.authorizationRevoked && (
        <div className="cloud-day-close__notice" role="status">
          授權狀態已失效。日結資料與操作草稿已清除；請重新登入並取得有效使用權。
        </div>
      )}
      {page.notice && <div className="cloud-day-close__notice" role="status">{page.notice}</div>}

      {page.recovery && (
        <section className="cloud-day-close__recovery" aria-label="命令結果確認" role="alert">
          <strong>{page.recovery.phase === 'receipt'
            ? '已找到伺服器回執，資料尚待再次讀取。'
            : page.recovery.phase === 'access-lost'
              ? '使用權已變更；操作內容已清除。'
              : page.recovery.phase === 'checking'
                ? '正在查詢原命令結果…'
                : page.recovery.phase === 'submitting'
                  ? page.recovery.timedOut ? '結果確認中，勿重新收款' : '命令送出中，請勿重複操作。'
                  : '結果確認中，請勿重複操作。'}</strong>
          <span>{page.recovery.command ? `${commandLabel(page.recovery.command)} · 命令編號 ${page.recovery.commandId}` : `命令編號 ${page.recovery.commandId}`}</span>
          {page.recovery.phase === 'access-lost' && <span>只保留命令編號；請先重新確認登入帳號與使用權，再依現場流程核對。</span>}
          {page.recovery.phase === 'receipt' && page.recovery.receipt && <span>伺服器命令序號 {page.recovery.receipt.seq}</span>}
          <div className="cloud-day-close__actions">
            {page.recovery.command && (page.recovery.phase === 'unknown' || (page.recovery.phase === 'submitting' && page.recovery.timedOut)) && (
              <button type="button" className="cloud-day-close__primary" onClick={() => void checkPendingCommand()}>
                查詢原命令結果
              </button>
            )}
            {page.recovery.canRetry && page.recovery.command && (
              <button
                type="button"
                className="cloud-day-close__secondary"
                onClick={() => { const operation = operationRef.current; if (operation) retryPendingCommand(operation); }}
              >
                以相同命令編號重試
              </button>
            )}
            {page.recovery.phase === 'receipt' && page.recovery.command && (
              <button
                type="button"
                className="cloud-day-close__secondary"
                onClick={() => void loadSnapshot(page.recovery!.command!.dayId, page.recovery?.receipt)}
                disabled={page.loading}
              >
                重新讀取伺服器資料
              </button>
            )}
          </div>
        </section>
      )}

      {page.loading && <div className="cloud-day-close__loading" role="status">正在從伺服器載入日結資料…</div>}

      {snapshot && !page.loading && (
        <>
          <section className="cloud-day-close__date-panel" aria-label="未關帳營業日">
            <h2>未關帳營業日</h2>
            {needsAttention.length === 0 ? (
              <p>到伺服器使用權日期 {selectionDate} 為止，沒有需要關帳的營業日。</p>
            ) : (
              <ul className="cloud-day-close__list">
                {needsAttention.map(item => (
                  <li key={item.dayId} data-testid={`cloud-unclosed-${item.dayId}`}>
                    <span className="cloud-day-close__mono">{item.dayId}</span>
                    <span>{unclosedLabel(item, selectionDate)}{item.status === 'reopened' ? '（已重開）' : ''} · {item.activeTransactionCount} 筆交易</span>
                    {item.backfill && <span className="cloud-day-close__status cloud-day-close__status--open" data-testid={`cloud-unclosed-backfill-${item.dayId}`}>回填中</span>}
                    <button type="button" className="cloud-day-close__secondary" onClick={() => void loadSnapshot(item.dayId)} disabled={busy || item.dayId === snapshot.dayId}>
                      查看
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {noBusiness.length > 0 && (
              <div className="cloud-day-close__help" data-testid="cloud-no-business-days">
                <p>
                  沒有開帳也沒有交易的過去日期（例如為更正期初建立的營業日）。那天沒有營業就不需處理；
                  如果其實有營業但沒開帳（例如網路斷線），可以查看該日補開帳後再關帳。
                </p>
                <ul className="cloud-day-close__list">
                  {noBusiness.map(item => (
                    <li key={item.dayId} data-testid={`cloud-no-business-${item.dayId}`}>
                      <span className="cloud-day-close__mono">{item.dayId}</span>
                      <button type="button" className="cloud-day-close__secondary" onClick={() => void loadSnapshot(item.dayId)} disabled={busy || item.dayId === snapshot.dayId}>
                        查看
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="cloud-day-close__date-panel" aria-label="日期選擇">
            <form className="cloud-day-close__date-form" onSubmit={submitDateSelection}>
              <label htmlFor="cloud-day-close-date">查看日期</label>
              <input
                id="cloud-day-close-date"
                className="cloud-day-close__input cloud-day-close__mono"
                type="date"
                min={snapshot.overview.goLiveDate}
                value={page.dayIdDraft || snapshot.dayId}
                onChange={event => updatePage(previous => ({ ...previous, dayIdDraft: event.target.value, actionError: '' }))}
                disabled={busy}
                required
              />
              <button type="submit" className="cloud-day-close__secondary" disabled={busy || page.dayIdDraft === snapshot.dayId}>
                載入日期
              </button>
            </form>
            <div className="cloud-day-close__date-meta">
              <span>伺服器使用權日期：{selectionDate}</span>
              <span>資料序號：{snapshot.overview.seq}</span>
            </div>
          </section>

          <section className="cloud-day-close__day-section" aria-label="指定營業日日結">
            <div className="cloud-day-close__section-heading">
              <div>
                <h2>{snapshot.dayId} 日結</h2>
                {day ? (
                  <p>
                    <span className={`cloud-day-close__status cloud-day-close__status--${day.status}`}>{statusLabel(day.status)}</span>
                    {' '}· 日結版本 {day.lastSettlementRevision}
                  </p>
                ) : <p>{canStartBackfill ? '伺服器沒有這個日期的營業日。如果那天其實有營業，可以在下方回填。' : '伺服器沒有這個日期的營業日，不需關帳。'}</p>}
              </div>
            </div>

            {snapshot.backfill && (
              <section className="cloud-day-close__card" aria-label="回填中" data-testid="backfill-info">
                <h3>回填中</h3>
                <p>
                  {snapshot.dayId} 正在回填（原因：{snapshot.backfill.reason}）。補登的訂餐、繳費與櫃台收支都記在這一天並標為「回填」；
                  補完後在這一頁核對現金再關帳。
                </p>
                {onOpenOrders && day?.status === 'open' && (
                  <button type="button" className="cloud-day-close__primary" onClick={() => onOpenOrders(snapshot.dayId)} disabled={busy}>
                    到訂餐頁補登 {snapshot.dayId}
                  </button>
                )}
              </section>
            )}

            {page.backfillPlan && page.backfillPlan.dayId === snapshot.dayId && !snapshot.backfill && (
              <section className="cloud-day-close__recovery" aria-label="回填進度" role="alert" data-testid="backfill-plan-panel">
                <strong>回填 {snapshot.dayId} 還沒完成。</strong>
                <span>已經在伺服器上確認的步驟不會重做，下一步會依伺服器現況決定。</span>
                <div className="cloud-day-close__actions">
                  <button type="button" className="cloud-day-close__primary" onClick={continueBackfill} disabled={busy} data-testid="backfill-continue">
                    繼續回填
                  </button>
                  <button
                    type="button"
                    className="cloud-day-close__secondary"
                    onClick={abandonBackfill}
                    disabled={busy}
                  >
                    放棄回填
                  </button>
                </div>
              </section>
            )}

            {canStartBackfill && !page.backfillPlan && (
              <section className="cloud-day-close__card" aria-label="回填這一天" data-testid="backfill-start">
                <h3>{day ? '標為回填，補登剩下的交易' : '回填這一天'}</h3>
                <form
                  className="cloud-day-close__form"
                  aria-label={`${snapshot.dayId} ${day ? '標為回填' : '回填'}`}
                  onSubmit={submitStartBackfill}
                >
                  <label>
                    回填原因（必填，最多 500 字）
                    <textarea
                      className="cloud-day-close__input"
                      rows={2}
                      maxLength={500}
                      value={page.startReason}
                      onChange={event => updatePage(previous => ({ ...previous, startReason: event.target.value, actionError: '' }))}
                      disabled={busy}
                      required
                    />
                  </label>
                  {startOpeningNeeded && (
                    <>
                      <label>
                        開帳現金（元）{previousClosed ? `，預設為 ${previousClosed.dayId} 關帳的${(previousClosed.postCloseNet ?? 0) !== 0 ? '有效現金（含關帳後補記）' : '實點'}` : ''}
                        <input
                          className="cloud-day-close__input cloud-day-close__mono"
                          inputMode="numeric"
                          value={page.startOpeningText ?? defaultOpeningText}
                          onChange={event => updatePage(previous => ({ ...previous, startOpeningText: event.target.value.trim(), actionError: '' }))}
                          disabled={busy || snapshot.previous?.status !== 'ready'}
                          required
                        />
                      </label>
                      {snapshot.previous?.status === 'error' && (
                        <div className="cloud-day-close__alert" role="alert" data-testid="backfill-previous-error">
                          無法查詢上一個已關帳日的實點現金：{snapshot.previous.message}
                          <button
                            type="button"
                            className="cloud-day-close__secondary"
                            onClick={() => void loadSnapshot(snapshot.dayId)}
                            disabled={busy || page.loading}
                            data-testid="backfill-previous-retry"
                          >
                            重新查詢
                          </button>
                        </div>
                      )}
                      {startDifference !== null && (
                        <label>
                          開帳現金與上次關帳實點不同（{formatDifference(startDifference)}），差額原因（必填，最多 500 字）
                          <textarea
                            className="cloud-day-close__input"
                            rows={2}
                            maxLength={500}
                            value={page.startOpeningReason}
                            onChange={event => updatePage(previous => ({ ...previous, startOpeningReason: event.target.value, actionError: '' }))}
                            disabled={busy}
                            required
                          />
                        </label>
                      )}
                    </>
                  )}
                  <div className="cloud-day-close__actions">
                    <button
                      type="submit"
                      className="cloud-day-close__primary"
                      disabled={busy || (startOpeningNeeded && snapshot.previous?.status !== 'ready')}
                    >
                      {day ? '確認標為回填' : '確認回填這一天'}
                    </button>
                  </div>
                  <p className="cloud-day-close__help">
                    {day
                      ? '標記後這一天可以補登訂餐、繳費與櫃台收支，原因與操作者會留下紀錄。'
                      : '會依序建立營業日、補開帳、標為回填；任何一步失敗都會停在那一步，已完成的步驟不會重做。'}
                    已經關過帳的日子不能回填。
                  </p>
                </form>
              </section>
            )}

            {day && (
              <>
                <section className="cloud-day-close__card" aria-label="現金統計">
                  <DayFigures day={day} />
                </section>

                {snapshot.dayId > selectionDate && day.status !== 'closed' && (
                  <p className="cloud-day-close__warning">未來日期只能預排菜單，不能關帳。</p>
                )}
                {currentKind === 'no-business' && (
                  <p className="cloud-day-close__notice" role="status">這天沒有開帳現金，也沒有任何交易。那天沒有營業就不需關帳；如果其實有營業但沒開帳，可以在下方補開帳後再關帳。</p>
                )}
                {currentKind === 'missing-opening' && snapshot.dayId <= selectionDate && (
                  <p className="cloud-day-close__warning">
                    {snapshot.dayId === selectionDate
                      ? '尚未確認開帳現金，不能關帳。請先到「日期與供應商」確認開帳現金。'
                      : '這天有交易但沒有開帳現金，要先補開帳才能關帳。'}
                  </p>
                )}

                {canBackfill && (
                  <section className="cloud-day-close__card" aria-label="補開帳">
                    <h3>補開帳</h3>
                    <form className="cloud-day-close__form" aria-label={`${snapshot.dayId} 補開帳`} onSubmit={submitBackfill}>
                      <label>
                        開帳現金（元）
                        <input
                          className="cloud-day-close__input cloud-day-close__mono"
                          inputMode="numeric"
                          value={page.backfillText}
                          onChange={event => updatePage(previous => ({ ...previous, backfillText: event.target.value.trim(), actionError: '' }))}
                          disabled={busy}
                          required
                        />
                      </label>
                      <label>
                        補開帳原因（必填，最多 500 字）
                        <textarea
                          className="cloud-day-close__input"
                          rows={2}
                          maxLength={500}
                          value={page.backfillReason}
                          onChange={event => updatePage(previous => ({ ...previous, backfillReason: event.target.value, actionError: '' }))}
                          disabled={busy}
                          required
                        />
                      </label>
                      <div className="cloud-day-close__actions">
                        <button type="submit" className="cloud-day-close__primary" disabled={busy}>確認補開帳</button>
                      </div>
                      <p className="cloud-day-close__help">填那天開店時抽屜裡的現金。補開帳會留下操作者、時間與原因，之後不能用補開帳修改；補完後在這一頁點現金關帳。</p>
                    </form>
                  </section>
                )}

                {canClose && (
                  <section className="cloud-day-close__card" aria-label="全日點現金與關帳">
                    <h3>全日點現金與關帳</h3>
                    <form className="cloud-day-close__form" aria-label={`${snapshot.dayId} 關帳`} onSubmit={submitClose}>
                      {backfillClose && alignLookup?.status === 'ready' && (
                        <div className="cloud-day-close__notice" data-testid="backfill-align">
                          <p data-testid="backfill-align-target">
                            {alignNext
                              ? `須等於 ${alignNext.dayId} 的開帳現金 ${formatMoney(alignNext.openingCash)}`
                              : `${snapshot.dayId} 之後沒有已開帳的日子，不需對齊其他日子；實點只要等於應有現金。`}
                          </p>
                          <p>
                            目前應有現金 {formatMoney(day.expectedCash!)}
                            {alignNext && `，與對齊金額${alignGap === 0 ? '相符' : `差 ${formatMoney(Math.abs(alignGap ?? 0))}（${(alignGap ?? 0) < 0 ? '少' : '多'}）`}`}。
                          </p>
                          {alignGap !== null && alignGap !== 0 && (
                            <p role="alert" data-testid="backfill-align-gap">
                              差 {formatMoney(Math.abs(alignGap))}，不能關帳。請回到訂餐頁的回填模式，補登 {snapshot.dayId} 缺的交易，或補記收支（含呆帳）後再回來。
                              {onOpenOrders && (
                                <button type="button" className="cloud-day-close__secondary" onClick={() => onOpenOrders(snapshot.dayId)} disabled={busy} data-testid="backfill-align-orders">
                                  到訂餐頁補登 {snapshot.dayId}
                                </button>
                              )}
                            </p>
                          )}
                        </div>
                      )}
                      {backfillClose && alignLookup?.status === 'error' && (
                        <div className="cloud-day-close__alert" role="alert" data-testid="backfill-align-error">
                          無法查詢要對齊的開帳日：{alignLookup.message}
                          <button type="button" className="cloud-day-close__secondary" onClick={() => void loadSnapshot(snapshot.dayId)} disabled={busy || page.loading} data-testid="backfill-align-retry">
                            重新查詢
                          </button>
                        </div>
                      )}
                      <label>
                        實點現金（元）
                        <input
                          className="cloud-day-close__input cloud-day-close__mono"
                          inputMode="numeric"
                          value={countedText}
                          onChange={event => updatePage(previous => ({ ...previous, countedText: event.target.value.trim(), actionError: '' }))}
                          disabled={busy}
                          required
                        />
                      </label>
                      {difference !== null && (
                        <p
                          className={`cloud-day-close__difference cloud-day-close__difference--${difference === 0 ? 'zero' : 'nonzero'}`}
                          role="status"
                        >
                          應有 {formatMoney(day.expectedCash!)}，實點 {formatMoney(countedCash!)}，{formatDifference(difference)}
                        </p>
                      )}
                      <label>
                        {!backfillClose && difference !== null && difference !== 0 ? '差額原因（必填，最多 500 字）' : '備註（選填，最多 500 字）'}
                        <textarea
                          className="cloud-day-close__input"
                          rows={2}
                          maxLength={500}
                          value={page.note}
                          onChange={event => updatePage(previous => ({ ...previous, note: event.target.value, actionError: '' }))}
                          disabled={busy}
                        />
                      </label>
                      <div className="cloud-day-close__actions">
                        <button type="submit" className="cloud-day-close__primary" disabled={busy || closeBlocked} data-testid="close-submit">確認關帳</button>
                      </div>
                      {hasUnresolvedPendingCommands && (
                        <p className="cloud-day-close__alert" role="alert" data-testid="pending-close-block">
                          尚有待核對命令；依關帳規則，先完成結果確認後才能關帳。保留原編號，不要重新收款。
                        </p>
                      )}
                      <p className="cloud-day-close__help">關帳後不能再新增或更正交易、菜單與開帳現金。一般現金差額可在下方留下有原因的關帳後補記；若要更正關帳版本，仍須填原因重開後重新關帳。</p>
                    </form>
                  </section>
                )}

                {(day.status === 'closed' || day.status === 'reopened') && (
                  <section className="cloud-day-close__card" aria-label="關帳後補記與歷史">
                    <h3>關帳後補記與歷史</h3>
                    {day.status === 'closed' && <p className="cloud-day-close__help">
                      補記只記錄關帳後的現金收入或支出，不修改學生訂餐、繳費、交易或原關帳實點。差額超過 20,000 元時需依現場流程處理，不可拆成多筆補記。
                    </p>}
                    {day.status === 'closed' && <p className="cloud-day-close__help">
                      另一個視窗仍可能同時補記。同一筆差額請只在一個視窗操作，送出前先核對補記歷史。
                    </p>}
                    {page.postCloseReference && (
                      <p className="cloud-day-close__difference cloud-day-close__difference--nonzero" role="status" data-testid="post-close-anomaly-preview">
                        由 {page.postCloseReference.dayId} 的開帳差額帶入：開帳現金 {formatMoney(page.postCloseReference.openingCash)}，
                        {page.postCloseReference.previousClosedDayId} 有效關帳現金 {formatMoney(page.postCloseReference.previousEffectiveCash)}，
                        差 {formatMoney(Math.abs(page.postCloseReference.difference))}。
                      </p>
                    )}
                    {page.postCloseStaleMessage && <p className="cloud-day-close__warning" role="alert">{page.postCloseStaleMessage}</p>}
                    {page.postCloseReference && Math.abs(page.postCloseReference.difference) > 20_000 && (
                      <p className="cloud-day-close__warning" role="alert">此差額超過單筆補記上限 NT$ 20,000，沒有拆單或送出補記功能。</p>
                    )}
                    {day.status === 'closed' && <form
                      className="cloud-day-close__form"
                      aria-label={`${snapshot.dayId} 關帳後補記`}
                      onSubmit={submitPostCloseEntry}
                    >
                      <label>
                        收支方向
                        <select
                          className="cloud-day-close__input"
                          value={page.postCloseDirection}
                          onChange={event => updatePage(previous => ({ ...previous, postCloseDirection: event.target.value as PostCloseDirection, actionError: '' }))}
                          disabled={busy}
                        >
                          <option value="income">收入</option>
                          <option value="expense">支出</option>
                        </select>
                      </label>
                      <label>
                        金額（元）
                        <input
                          className="cloud-day-close__input cloud-day-close__mono"
                          inputMode="numeric"
                          value={page.postCloseAmountText}
                          onChange={event => updatePage(previous => ({ ...previous, postCloseAmountText: event.target.value.trim(), actionError: '' }))}
                          disabled={busy}
                          required
                        />
                      </label>
                      <label>
                        原因（必填，最多 500 字）
                        <textarea
                          className="cloud-day-close__input"
                          rows={2}
                          maxLength={500}
                          value={page.postCloseReason}
                          onChange={event => updatePage(previous => ({ ...previous, postCloseReason: event.target.value, actionError: '' }))}
                          disabled={busy}
                          required
                        />
                      </label>
                      {page.postCloseRequiresConfirmation && (
                        <label className="cloud-day-close__confirmation">
                          <input
                            type="checkbox"
                            checked={page.postCloseConfirmed}
                            onChange={event => updatePage(previous => ({ ...previous, postCloseConfirmed: event.target.checked, actionError: '' }))}
                            disabled={busy}
                          />
                          我已核對更新後的差額與關帳現金
                        </label>
                      )}
                      <div className="cloud-day-close__actions">
                        <button
                          type="submit"
                          className="cloud-day-close__primary"
                          disabled={busy || (page.postCloseRequiresConfirmation && !page.postCloseConfirmed)
                            || (page.postCloseReference !== null && Math.abs(page.postCloseReference.difference) > 20_000)}
                        >
                          {page.postCloseChecking ? '重新核對中…' : '確認補記'}
                        </button>
                      </div>
                    </form>}
                    <h4>關帳後補記歷史</h4>
                    {day.postCloseEntries.length === 0 ? (
                      <p>這個關帳版本還沒有補記。</p>
                    ) : (
                      <div className="cloud-day-close__table-wrap">
                        <table>
                          <thead>
                            <tr><th>方向</th><th>金額</th><th>原因</th><th>操作者</th><th>時間（臺北）</th><th>關帳版本</th><th>計算狀態</th></tr>
                          </thead>
                          <tbody>
                            {day.postCloseEntries.map(entry => {
                              const effective = day.status === 'closed' && entry.settlementRevision === day.lastSettlementRevision;
                              return (
                                <tr key={entry.entryId} data-testid={`post-close-entry-${entry.entryId}`}>
                                  <td>{entry.direction === 'income' ? '收入' : '支出'}</td>
                                  <td className="cloud-day-close__mono">{formatMoney(entry.amount)}</td>
                                  <td>{entry.reason}</td>
                                  <td>{entry.createdBy}</td>
                                  <td>{formatServerTime(entry.createdAt)}</td>
                                  <td className="cloud-day-close__mono">{entry.settlementRevision}</td>
                                  <td>{effective ? '已計入有效關帳現金' : '舊關帳版本，僅供歷史查閱'}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}

                {day.status === 'closed' && (
                  <section className="cloud-day-close__card" aria-label="重開營業日">
                    <h3>重開</h3>
                    {page.reopenOpen ? (
                      <form className="cloud-day-close__form" aria-label={`${snapshot.dayId} 重開`} onSubmit={submitReopen}>
                        <label>
                          重開原因（必填，最多 500 字）
                          <textarea
                            className="cloud-day-close__input"
                            rows={2}
                            maxLength={500}
                            value={page.reopenReason}
                            onChange={event => updatePage(previous => ({ ...previous, reopenReason: event.target.value, actionError: '' }))}
                            disabled={busy}
                            required
                          />
                        </label>
                        <div className="cloud-day-close__actions">
                          <button type="submit" className="cloud-day-close__danger" disabled={busy}>確認重開</button>
                          <button type="button" className="cloud-day-close__secondary" onClick={() => updatePage(previous => ({ ...previous, reopenOpen: false, reopenReason: '', actionError: '' }))} disabled={busy}>取消</button>
                        </div>
                        <p className="cloud-day-close__help">重開會新增一個版本，舊的關帳版本保留不變；修正後要重新關帳。</p>
                      </form>
                    ) : (
                      <button type="button" className="cloud-day-close__secondary" onClick={() => updatePage(previous => ({ ...previous, reopenOpen: true, actionError: '' }))} disabled={busy}>
                        重開這一天
                      </button>
                    )}
                  </section>
                )}

                <section className="cloud-day-close__card" aria-label="日結版本">
                  <h3>日結版本</h3>
                  {day.settlements.length === 0 ? (
                    <p>這天還沒有日結版本。</p>
                  ) : (
                    <div className="cloud-day-close__table-wrap">
                      <table>
                        <thead>
                          <tr><th>版本</th><th>狀態</th><th>應有</th><th>實點</th><th>差額</th><th>說明／原因</th><th>操作者</th><th>時間（臺北）</th></tr>
                        </thead>
                        <tbody>
                          {[...day.settlements].reverse().map(version => (
                            <tr key={version.revision} data-testid={`cloud-settlement-${version.revision}`}>
                              <td className="cloud-day-close__mono">{version.revision}</td>
                              <td>{version.status === 'closed' ? '關帳' : '重開'}</td>
                              <td className="cloud-day-close__mono">{formatMoney(version.expectedCash)}</td>
                              <td className="cloud-day-close__mono">{version.countedCash === null ? '—' : formatMoney(version.countedCash)}</td>
                              <td className="cloud-day-close__mono">{version.difference === null ? '—' : formatDifference(version.difference)}</td>
                              <td>{version.note || '—'}</td>
                              <td>{version.actorEmail}</td>
                              <td>{formatServerTime(version.committedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </>
      )}

      {!snapshot && !page.loading && !page.recovery && (
        <section className="cloud-day-close__unavailable" aria-label="雲端資料未載入">
          <p>日結資料尚未從伺服器完整載入，沒有顯示空白或本機資料。</p>
          <button type="button" className="cloud-day-close__primary" onClick={() => void loadSnapshot(page.dayIdDraft || undefined)} disabled={!identityKey || page.authorizationRevoked}>
            重新載入伺服器資料
          </button>
        </section>
      )}

      {!page.authorizationRevoked && (
        <section className="cloud-day-close__backup" aria-label="關帳後備份">
          <h2>關帳後備份</h2>
          <p className="cloud-day-close__help">每天最後一次關帳後，在這裡下載加密增量備份，並重新選取檔案完成驗證。</p>
          {backupBlock ?? <BackupScreen />}
        </section>
      )}
    </main>
  );
}

export default CloudDayClosePage;
