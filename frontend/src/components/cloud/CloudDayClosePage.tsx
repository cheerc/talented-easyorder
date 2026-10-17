import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import {
  createCloudDayCloseRepository,
  type BackfillCloudDayOpeningInput,
  type CloseCloudDayInput,
  type CloudDayCloseOverview,
  type CloudDayCloseState,
  type CloudUnclosedDay,
  type ReopenCloudDayInput,
} from '../../firebase/cloudDayCloseRepository';
import { BackupScreen } from '../screens/BackupScreen';
import './CloudDayClosePage.css';

export interface CloudDayClosePageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  /** Tests replace the P14 backup block; the page mounts the real one by default. */
  backupBlock?: ReactNode;
}

type PreparedCommand =
  | ({ kind: 'close-day' } & Omit<CloseCloudDayInput, 'leaseEpoch'>)
  | ({ kind: 'reopen-day' } & Omit<ReopenCloudDayInput, 'leaseEpoch'>)
  | ({ kind: 'backfill-opening' } & Omit<BackfillCloudDayOpeningInput, 'leaseEpoch'>);

type RecoveryPhase = 'submitting' | 'unknown' | 'checking' | 'receipt' | 'access-lost';

interface RecoveryState {
  commandId: string;
  command?: PreparedCommand;
  phase: RecoveryPhase;
  receipt?: CommandReceipt;
}

interface DaySnapshot {
  overview: CloudDayCloseOverview;
  dayId: string;
  /** null when the day document does not exist. */
  day: CloudDayCloseState | null;
}

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
  backfillText: string;
  backfillReason: string;
  recovery: RecoveryState | null;
}

type DraftKey = 'countedText' | 'note' | 'reopenOpen' | 'reopenReason' | 'backfillText' | 'backfillReason';

function clearDrafts(): Pick<PageState, DraftKey> {
  return { countedText: '', note: '', reopenOpen: false, reopenReason: '', backfillText: '', backfillReason: '' };
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

function formatMoney(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}NT$ ${new Intl.NumberFormat('zh-TW').format(Math.abs(amount))}`;
}

function formatDifference(amount: number): string {
  if (amount === 0) return '無差額';
  return amount > 0 ? `多 ${formatMoney(amount)}` : `少 ${formatMoney(-amount)}`;
}

function formatServerTime(value: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp);
}

function statusLabel(status: CloudDayCloseState['status']): string {
  return status === 'closed' ? '已關帳' : status === 'reopened' ? '已重開' : '開啟中';
}

function commandLabel(command: PreparedCommand): string {
  if (command.kind === 'backfill-opening') return `${command.dayId} 補開帳`;
  return command.kind === 'close-day' ? `${command.dayId} 關帳` : `${command.dayId} 重開`;
}

function unclosedLabel(day: CloudUnclosedDay, selectionDate: string): string {
  if (day.kind === 'no-business') return '沒有開帳也沒有交易';
  if (day.kind === 'missing-opening') {
    return day.dayId === selectionDate ? '尚未確認開帳現金' : '缺開帳現金，需補開帳後關帳';
  }
  return day.dayId === selectionDate ? '今天，尚未關帳' : '尚未關帳';
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
      <dt>有效交易</dt><dd>{t.activeTransactionCount} 筆</dd>
      <dt>份數</dt><dd>今日餐點 {t.bentoCount} · 其他餐點 {t.otherMealCount}</dd>
      <dt>餐費</dt><dd>{formatMoney(t.mealTotal)}</dd>
    </dl>
  );
}

export function CloudDayClosePage({ db, leaseEpoch, identityKey, onNavigationStateChange, backupBlock }: CloudDayClosePageProps) {
  const repository = useMemo(() => createCloudDayCloseRepository(db), [db]);
  const scopeKey = `${identityKey}:${leaseEpoch}`;
  const [pageState, setPageStateRaw] = useState<PageState>(() => initialPageState(scopeKey));
  const scopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const readRequestRef = useRef(0);
  const commandFlightRef = useRef<symbol | null>(null);
  const revokedScopeRef = useRef<string | null>(null);
  const pendingCommandIdRef = useRef<string | null>(null);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    readRequestRef.current += 1;
    commandFlightRef.current = null;
    revokedScopeRef.current = null;
    pendingCommandIdRef.current = null;
  }

  const page = pageState.scopeKey === scopeKey ? pageState : initialPageState(scopeKey);

  const isCurrent = useCallback((key: string, generation: number) => (
    scopeRef.current === key && generationRef.current === generation
  ), []);

  const updateFor = useCallback((key: string, generation: number, update: (previous: PageState) => PageState) => {
    setPageStateRaw(previous => {
      if (!isCurrent(key, generation)) return previous;
      const current = previous.scopeKey === key ? previous : initialPageState(key);
      return update(current);
    });
  }, [isCurrent]);

  const revokeAuthorization = useCallback((key: string, generation: number, commandId: string | null, error: unknown) => {
    if (!isCurrent(key, generation)) return;
    // Invalidate all pending reads, writes, and receipt lookups before React commits.
    revokedScopeRef.current = key;
    generationRef.current += 1;
    readRequestRef.current += 1;
    commandFlightRef.current = null;
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
  }, [identityKey, isCurrent, onNavigationStateChange]);

  const loadSnapshot = useCallback(async (targetDayId?: string, confirmedReceipt?: CommandReceipt) => {
    const key = scopeKey;
    const generation = generationRef.current;
    if (revokedScopeRef.current === key) return;
    const requestId = ++readRequestRef.current;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: true,
      loadError: '',
      actionError: '',
      notice: confirmedReceipt ? '已找到伺服器回執，正在重新讀取日結資料…' : '',
      ...(targetDayId ? { dayIdDraft: targetDayId } : {}),
    }));

    try {
      const overview = await repository.readOverview();
      const dayId = targetDayId ?? overview.selectionDate;
      const day = await repository.read(dayId);
      if (!isCurrent(key, generation) || requestId !== readRequestRef.current) return;
      if (confirmedReceipt?.commandId === pendingCommandIdRef.current) pendingCommandIdRef.current = null;
      updateFor(key, generation, previous => {
        const confirmsPending = confirmedReceipt
          && previous.recovery?.commandId === confirmedReceipt.commandId
          && previous.recovery.command !== undefined;
        const confirmedCommand = confirmsPending ? previous.recovery?.command : null;
        return {
          ...previous,
          ...clearDrafts(),
          snapshot: { overview, dayId, day },
          dayIdDraft: dayId,
          loading: false,
          loadError: '',
          actionError: '',
          recovery: confirmsPending ? null : previous.recovery,
          notice: confirmsPending
            ? `已確認 ${confirmedCommand ? commandLabel(confirmedCommand) : '雲端操作'} 完成；伺服器資料已重新讀取（命令序號 ${confirmedReceipt.seq}）。`
            : '',
        };
      });
    } catch (error) {
      if (!isCurrent(key, generation) || requestId !== readRequestRef.current) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, confirmedReceipt?.commandId ?? null, error);
        return;
      }
      updateFor(key, generation, previous => {
        const recovery = confirmedReceipt && previous.recovery?.commandId === confirmedReceipt.commandId
          ? { ...previous.recovery, phase: 'receipt' as const, receipt: confirmedReceipt }
          : previous.recovery;
        return {
          ...previous,
          ...clearDrafts(),
          snapshot: null,
          loading: false,
          loadError: errorMessage(error),
          actionError: confirmedReceipt
            ? '已找到命令回執，但伺服器資料尚未重新讀取；請只重新讀取資料，不要重送命令。'
            : '',
          recovery,
          notice: '',
        };
      });
    }
  }, [isCurrent, repository, revokeAuthorization, scopeKey, updateFor]);

  useEffect(() => {
    const generation = ++generationRef.current;
    setPageStateRaw(initialPageState(scopeKey));
    void loadSnapshot();
    return () => {
      readRequestRef.current += 1;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [loadSnapshot, scopeKey]);

  const hasRecovery = page.recovery !== null;
  useEffect(() => {
    onNavigationStateChange?.(
      identityKey,
      page.authorizationRevoked ? 'revoked' : hasRecovery ? 'recovering' : 'resolved',
    );
  }, [hasRecovery, identityKey, onNavigationStateChange, page.authorizationRevoked]);

  const dispatch = (command: PreparedCommand): Promise<CommandResult> => {
    if (command.kind === 'backfill-opening') {
      const { commandId, dayId, expectedDayRevision, openingCash, reason } = command;
      return repository.backfillOpening({ commandId, leaseEpoch, dayId, expectedDayRevision, openingCash, reason });
    }
    const { commandId, dayId, expectedDayRevision, expectedSettlementRevision } = command;
    const base = { commandId, leaseEpoch, dayId, expectedDayRevision, expectedSettlementRevision };
    if (command.kind === 'close-day') {
      return repository.closeDay({ ...base, expectedCash: command.expectedCash, countedCash: command.countedCash, note: command.note });
    }
    return repository.reopenDay({ ...base, reason: command.reason });
  };

  const finishCommandResult = async (command: PreparedCommand, result: CommandResult, key: string, generation: number) => {
    if (!isCurrent(key, generation)) return;
    if (!result.ok) {
      if (isAuthorizationLoss(result.error)) {
        revokeAuthorization(key, generation, command.commandId, result.error);
        return;
      }
      if (result.error.code === 'UNKNOWN_RESULT') {
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          loadError: '',
          actionError: '',
          recovery: { commandId: command.commandId, command, phase: 'unknown' },
        }));
        return;
      }
      pendingCommandIdRef.current = null;
      updateFor(key, generation, previous => ({
        ...previous,
        ...clearDrafts(),
        snapshot: null,
        loading: false,
        loadError: `${commandLabel(command)}未完成：${errorMessage(result.error)}請重新載入伺服器資料後再確認。`,
        actionError: '',
        recovery: null,
        notice: '',
      }));
      return;
    }
    if (result.receipt.commandId !== command.commandId) {
      updateFor(key, generation, previous => ({
        ...previous,
        snapshot: null,
        loading: false,
        actionError: '',
        recovery: { commandId: command.commandId, command, phase: 'unknown' },
        loadError: '伺服器回執命令編號不符；保留原命令編號，尚未確認完成。',
      }));
      return;
    }
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: false,
      loadError: '',
      actionError: '',
      recovery: { commandId: command.commandId, command, phase: 'receipt', receipt: result.receipt },
    }));
    await loadSnapshot(command.dayId, result.receipt);
  };

  const runPreparedCommand = async (command: PreparedCommand) => {
    const key = scopeKey;
    const generation = generationRef.current;
    onNavigationStateChange?.(identityKey, 'recovering');
    if (revokedScopeRef.current === key) return;
    if (!identityKey || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1) {
      revokeAuthorization(key, generation, command.commandId, {
        code: 'LEASE_LOST',
        message: '目前沒有有效的操作使用權，雲端資料已清除。請重新確認使用權。',
      });
      return;
    }
    if (commandFlightRef.current) return;
    const flightToken = Symbol('cloud-day-close-command');
    commandFlightRef.current = flightToken;
    pendingCommandIdRef.current = command.commandId;
    const releaseFlight = () => {
      if (commandFlightRef.current === flightToken) commandFlightRef.current = null;
    };

    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: false,
      loadError: '',
      actionError: '',
      notice: '',
      recovery: { commandId: command.commandId, command, phase: 'submitting' },
    }));

    let result: CommandResult;
    try {
      result = await dispatch(command);
    } catch (error) {
      releaseFlight();
      if (!isCurrent(key, generation)) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, command.commandId, error);
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        snapshot: null,
        loading: false,
        loadError: '',
        actionError: '',
        recovery: { commandId: command.commandId, command, phase: 'unknown' },
      }));
      return;
    }

    if (!isCurrent(key, generation)) {
      releaseFlight();
      return;
    }
    await finishCommandResult(command, result, key, generation);
    releaseFlight();
  };

  const checkPendingCommand = async () => {
    const recovery = page.recovery;
    if (revokedScopeRef.current === scopeKey) return;
    if (!recovery?.command || recovery.phase === 'submitting' || recovery.phase === 'checking') return;
    if (recovery.phase === 'receipt') {
      if (recovery.receipt) await loadSnapshot(recovery.command.dayId, recovery.receipt);
      return;
    }

    const key = scopeKey;
    const generation = generationRef.current;
    updateFor(key, generation, previous => ({ ...previous, actionError: '', recovery: { ...recovery, phase: 'checking' } }));
    try {
      const receipt = await repository.readCommand(recovery.commandId);
      if (!isCurrent(key, generation)) return;
      if (!receipt) {
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loadError: '',
          actionError: '伺服器目前尚未找到這筆命令。沒有產生新的命令編號；可用相同編號與原資料重試。',
          recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
        }));
        return;
      }
      if (receipt.commandId !== recovery.commandId) {
        throw new Error('伺服器回傳的命令編號不符，無法確認結果。');
      }
      // The ID alone is insufficient: replay the frozen input with the same command ID so the
      // repository verifies the stored command is exactly this close or reopen.
      let verification: CommandResult;
      try {
        verification = await dispatch(recovery.command);
      } catch (error) {
        if (!isCurrent(key, generation)) return;
        if (isAuthorizationLoss(error)) {
          revokeAuthorization(key, generation, recovery.commandId, error);
          return;
        }
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          actionError: `已找到回執，但同命令編號語義核對結果仍不明。${errorMessage(error)}`,
          recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
        }));
        return;
      }
      if (!isCurrent(key, generation)) return;
      if (!verification.ok && isAuthorizationLoss(verification.error)) {
        revokeAuthorization(key, generation, recovery.commandId, verification.error);
        return;
      }
      if (!verification.ok) {
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          actionError: verification.error.code === 'UNKNOWN_RESULT'
            ? '已找到命令回執，但語義比對結果不明；請使用相同命令編號再查詢。'
            : `命令編號已存在，但伺服器內容與原操作不符，仍未確認完成。${verification.error.message}`,
          recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
        }));
        return;
      }
      await finishCommandResult(recovery.command, verification, key, generation);
    } catch (error) {
      if (!isCurrent(key, generation)) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, recovery.commandId, error);
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        snapshot: null,
        loading: false,
        loadError: '',
        actionError: `目前無法確認命令結果。${errorMessage(error)}`,
        recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
      }));
    }
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
    if (page.recovery || !snapshot) return;
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
  const countedCash = /^\d+$/.test(page.countedText) ? Number(page.countedText) : null;
  const difference = countedCash !== null && day?.expectedCash !== null && day?.expectedCash !== undefined
    ? countedCash - day.expectedCash
    : null;
  const canClose = !!snapshot && !!day && day.status !== 'closed' && day.expectedCash !== null && snapshot.dayId <= selectionDate;
  // A past day that never confirmed its opening cash (for example the network was down) can get it backfilled.
  const canBackfill = !!snapshot && !!day && day.status !== 'closed' && day.openingCash === null && snapshot.dayId < selectionDate;
  const backfillCash = /^\d+$/.test(page.backfillText) ? Number(page.backfillText) : null;

  const submitClose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || !snapshot || !day || !canClose || day.expectedCash === null) return;
    if (countedCash === null || !Number.isSafeInteger(countedCash) || countedCash > 1_000_000_000) {
      updatePage(previous => ({ ...previous, actionError: '實點現金必須明確輸入 0 至 1,000,000,000 元的整數；空白、負數與小數均不接受。' }));
      return;
    }
    const note = page.note.trim();
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
    });
  };

  const submitReopen = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || !snapshot || !day || day.status !== 'closed') return;
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

  const submitBackfill = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (page.recovery || !snapshot || !day || !canBackfill) return;
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

  const busy = page.recovery !== null;
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
                  ? '命令送出中，請勿重複操作。'
                  : '結果確認中，請勿重複操作。'}</strong>
          <span>{page.recovery.command ? `${commandLabel(page.recovery.command)} · 命令編號 ${page.recovery.commandId}` : `命令編號 ${page.recovery.commandId}`}</span>
          {page.recovery.phase === 'access-lost' && <span>只保留命令編號；請先重新確認登入帳號與使用權，再依現場流程核對。</span>}
          {page.recovery.phase === 'receipt' && page.recovery.receipt && <span>伺服器命令序號 {page.recovery.receipt.seq}</span>}
          <div className="cloud-day-close__actions">
            {page.recovery.command && page.recovery.phase !== 'submitting' && page.recovery.phase !== 'checking' && page.recovery.phase !== 'receipt' && (
              <button type="button" className="cloud-day-close__primary" onClick={() => void checkPendingCommand()}>
                查詢原命令結果
              </button>
            )}
            {page.recovery.phase === 'unknown' && page.recovery.command && page.actionError.includes('尚未找到') && (
              <button type="button" className="cloud-day-close__secondary" onClick={() => void runPreparedCommand(page.recovery!.command!)}>
                以相同命令編號重試
              </button>
            )}
            {page.recovery.phase === 'receipt' && (
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
                ) : <p>伺服器沒有這個日期的營業日，不需關帳。</p>}
              </div>
            </div>

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
                      <label>
                        實點現金（元）
                        <input
                          className="cloud-day-close__input cloud-day-close__mono"
                          inputMode="numeric"
                          value={page.countedText}
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
                        {difference !== null && difference !== 0 ? '差額原因（必填，最多 500 字）' : '備註（選填，最多 500 字）'}
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
                        <button type="submit" className="cloud-day-close__primary" disabled={busy}>確認關帳</button>
                      </div>
                      <p className="cloud-day-close__help">關帳後這天不能再新增或更正交易、菜單與開帳現金；要修正必須先填原因重開，再重新關帳。</p>
                    </form>
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
