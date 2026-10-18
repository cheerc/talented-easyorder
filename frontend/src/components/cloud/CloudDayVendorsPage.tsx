import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import {
  createCloudDayVendorRepository,
  type CloudDayVendorSnapshot,
  type CloudVendorRecord,
  type EnsureDayInput,
  type RemoveVendorInput,
  type SaveVendorInput,
  type SetDayMenuInput,
  type SetOpeningCashInput,
} from '../../firebase/cloudDayVendorRepository';
import {
  CloudDayMenuForm,
  CloudDayOpeningCashForm,
  CloudDayVendorForm,
  type CloudDayMenuDraft,
  type CloudDayVendorDraft,
} from './CloudDayVendorForms';
import { openingDifference, type PreviousClosedDay } from '../../domain/ledgerAnomalies';
import type { CloudLedgerView } from '../../hooks/useCloudLedger';
import { LedgerUnclosedBanner } from './LedgerUnclosedBanner';
import './CloudDayVendorsPage.css';

type PreviousClosedLookupView =
  | { status: 'idle' }
  | { status: 'ready'; dayId: string; previous: PreviousClosedDay | null }
  | { status: 'error'; dayId: string; message: string };

export interface CloudDayVendorsPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  /** 帳務異常快照（契約 §11）；沒提供時不顯示橫幅，也不要求開帳差額原因。 */
  ledger?: CloudLedgerView;
  onOpenAnomalies?: () => void;
  /** 開帳現金命令確認成功後呼叫，讓上層重讀帳務異常。 */
  onLedgerChanged?: () => void;
}

type PreparedCommand =
  | { kind: 'ensure-day'; commandId: string; dayId: string }
  | ({ kind: 'save-vendor'; commandId: string; viewDayId: string } & Omit<SaveVendorInput, 'commandId' | 'leaseEpoch'>)
  | ({ kind: 'remove-vendor'; commandId: string; viewDayId: string } & Omit<RemoveVendorInput, 'commandId' | 'leaseEpoch'>)
  | ({ kind: 'set-day-menu'; commandId: string } & Omit<SetDayMenuInput, 'commandId' | 'leaseEpoch'>)
  | ({ kind: 'set-opening-cash'; commandId: string } & Omit<SetOpeningCashInput, 'commandId' | 'leaseEpoch'>);

type RecoveryPhase = 'submitting' | 'unknown' | 'checking' | 'receipt' | 'access-lost';

interface RecoveryState {
  commandId: string;
  command?: PreparedCommand;
  phase: RecoveryPhase;
  receipt?: CommandReceipt;
}

interface PageState {
  scopeKey: string;
  authorizationRevoked: boolean;
  snapshot: CloudDayVendorSnapshot | null;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  dayIdDraft: string;
  createVendorOpen: boolean;
  vendorDraft: CloudDayVendorDraft;
  editingVendorId: string | null;
  removingVendorId: string | null;
  removeReason: string;
  menuDraft: CloudDayMenuDraft;
  inheritedFromDate: string | null;
  openingCashText: string;
  openingReasonText: string;
  recovery: RecoveryState | null;
}

const freshVendorDraft = (): CloudDayVendorDraft => ({
  vendorId: '',
  name: '',
  phone: '',
  note: '',
  status: 'active',
});

const freshMenuDraft = (): CloudDayMenuDraft => ({ itemName: '', priceText: '', vendorId: '' });

function formDraftsFor(snapshot: CloudDayVendorSnapshot): Pick<PageState,
  'createVendorOpen' | 'vendorDraft' | 'editingVendorId' | 'removingVendorId' | 'removeReason' | 'menuDraft' | 'inheritedFromDate' | 'openingCashText' | 'openingReasonText'> {
  return {
    createVendorOpen: false,
    vendorDraft: freshVendorDraft(),
    editingVendorId: null,
    removingVendorId: null,
    removeReason: '',
    menuDraft: snapshot.day?.menu
      ? {
        itemName: snapshot.day.menu.itemName,
        priceText: String(snapshot.day.menu.price),
        vendorId: snapshot.day.menu.vendorId,
      }
      : freshMenuDraft(),
    // Any new write from an existing menu is an explicit direct assignment.
    // Inheritance is selected only from the current, strictly decoded source below.
    inheritedFromDate: null,
    openingCashText: snapshot.day?.openingCash === null || snapshot.day?.openingCash === undefined
      ? ''
      : String(snapshot.day.openingCash),
    openingReasonText: '',
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
    createVendorOpen: false,
    vendorDraft: freshVendorDraft(),
    editingVendorId: null,
    removingVendorId: null,
    removeReason: '',
    menuDraft: freshMenuDraft(),
    inheritedFromDate: null,
    openingCashText: '',
    openingReasonText: '',
    recovery: null,
  };
}

function clearFormDrafts(): Pick<PageState,
  'createVendorOpen' | 'vendorDraft' | 'editingVendorId' | 'removingVendorId' | 'removeReason' | 'menuDraft' | 'inheritedFromDate' | 'openingCashText' | 'openingReasonText'> {
  return {
    createVendorOpen: false,
    vendorDraft: freshVendorDraft(),
    editingVendorId: null,
    removingVendorId: null,
    removeReason: '',
    menuDraft: freshMenuDraft(),
    inheritedFromDate: null,
    openingCashText: '',
    openingReasonText: '',
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
  if (code === 'LEASE_LOST' || code === 'ACCESS_BUSY') return '目前使用權已變更，雲端日期與供應商資料已清除。請重新確認使用權。';
  if (code === 'UNAUTHORIZED') return '目前帳號沒有雲端日期與供應商資料存取權，資料已清除。請重新登入確認權限。';
  if (code === 'QUOTA_EXCEEDED') return '雲端讀取額度不足，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'MAINTENANCE') return '系統正在維護，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'INCOMPLETE_SNAPSHOT') return '伺服器資料超過完整讀取範圍，沒有顯示部分資料。請聯絡系統維護者。';
  if (code === 'STALE_SNAPSHOT') return '載入期間伺服器資料有變動，沒有顯示部分資料。請重新載入。';
  if (code === 'UNSUPPORTED_SCHEMA') return '伺服器資料格式目前無法安全讀取，沒有顯示部分資料。請聯絡系統維護者。';
  if (code === 'UNKNOWN_RESULT') return '伺服器結果目前無法確認，沒有顯示部分資料。請重新確認命令或重新載入。';
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
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
  return `NT$ ${new Intl.NumberFormat('zh-TW').format(amount)}`;
}

function formatServerTime(value: string | null): string {
  if (!value) return '—';
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp);
}

function commandLabel(command: PreparedCommand): string {
  if (command.kind === 'ensure-day') return `建立營業日 ${command.dayId}`;
  if (command.kind === 'save-vendor') return `${command.expectedRevision === 0 ? '新增' : '修改'}供應商 ${command.vendorId}`;
  if (command.kind === 'remove-vendor') return `移除供應商 ${command.vendorId}`;
  if (command.kind === 'set-day-menu') return `設定 ${command.dayId} 菜單`;
  return `確認 ${command.dayId} 開帳現金`;
}

function commandDayId(command: PreparedCommand): string {
  return command.kind === 'save-vendor' || command.kind === 'remove-vendor' ? command.viewDayId : command.dayId;
}

function blockedInheritanceMessage(blocked: string): string {
  if (blocked === 'vendor-missing') return '最近一筆較早菜單的供應商已不存在，不能自動沿用；請直接確認菜單與使用中的供應商。';
  if (blocked === 'vendor-inactive') return '最近一筆較早菜單的供應商已停用，不能沿用；請先恢復供應商或直接選擇使用中的供應商。';
  if (blocked === 'vendor-deleted') return '最近一筆較早菜單的供應商已移除，不能沿用；請直接確認菜單與使用中的供應商。';
  return '最近一筆較早菜單的供應商名稱已變更，不能沿用舊快照；請直接確認菜單與使用中的供應商。';
}

function dispatchPreparedCommand(
  repository: ReturnType<typeof createCloudDayVendorRepository>,
  command: PreparedCommand,
  leaseEpoch: number,
): Promise<CommandResult> {
  if (command.kind === 'ensure-day') {
    const input: EnsureDayInput = { commandId: command.commandId, leaseEpoch, dayId: command.dayId };
    return repository.ensureDay(input);
  }
  if (command.kind === 'save-vendor') {
    const input: SaveVendorInput = {
      commandId: command.commandId,
      leaseEpoch,
      vendorId: command.vendorId,
      expectedRevision: command.expectedRevision,
      name: command.name,
      phone: command.phone,
      note: command.note,
      status: command.status,
    };
    return repository.saveVendor(input);
  }
  if (command.kind === 'remove-vendor') {
    const input: RemoveVendorInput = {
      commandId: command.commandId,
      leaseEpoch,
      vendorId: command.vendorId,
      expectedRevision: command.expectedRevision,
      reason: command.reason,
    };
    return repository.removeVendor(input);
  }
  if (command.kind === 'set-day-menu') {
    const input: SetDayMenuInput = {
      commandId: command.commandId,
      leaseEpoch,
      dayId: command.dayId,
      selectionDate: command.selectionDate,
      expectedRevision: command.expectedRevision,
      expectedHeadSeq: command.expectedHeadSeq,
      itemName: command.itemName,
      price: command.price,
      vendorId: command.vendorId,
      vendorNameSnapshot: command.vendorNameSnapshot,
      inheritedFromDate: command.inheritedFromDate,
    };
    return repository.setDayMenu(input);
  }
  const input: SetOpeningCashInput = {
    commandId: command.commandId,
    leaseEpoch,
    dayId: command.dayId,
    expectedRevision: command.expectedRevision,
    openingCash: command.openingCash,
    ...(command.reason === undefined ? {} : { reason: command.reason }),
  };
  return repository.setOpeningCash(input);
}

export function CloudDayVendorsPage({
  db, leaseEpoch, identityKey, onNavigationStateChange, ledger, onOpenAnomalies, onLedgerChanged,
}: CloudDayVendorsPageProps) {
  const repository = useMemo(() => createCloudDayVendorRepository(db), [db]);
  const onLedgerChangedRef = useRef(onLedgerChanged);
  useEffect(() => { onLedgerChangedRef.current = onLedgerChanged; }, [onLedgerChanged]);
  const [previousLookup, setPreviousLookup] = useState<PreviousClosedLookupView>({ status: 'idle' });
  /** Bumped by the retry button so a failed previous-closed-day lookup can run again without reloading the page. */
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const scopeKey = `${identityKey}:${leaseEpoch}`;
  const [pageState, setPageStateRaw] = useState<PageState>(() => initialPageState(scopeKey));
  const scopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const listRequestRef = useRef(0);
  const commandFlightRef = useRef<symbol | null>(null);
  const revokedScopeRef = useRef<string | null>(null);
  const pendingCommandIdRef = useRef<string | null>(null);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    listRequestRef.current += 1;
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
    listRequestRef.current += 1;
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
    const requestId = ++listRequestRef.current;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: true,
      loadError: '',
      actionError: '',
      notice: confirmedReceipt ? '已找到伺服器回執，正在重新讀取營業日與供應商資料…' : '',
      ...(targetDayId ? { dayIdDraft: targetDayId } : {}),
    }));

    try {
      const snapshot = await repository.loadSnapshot(targetDayId);
      if (!isCurrent(key, generation) || requestId !== listRequestRef.current) return;
      if (confirmedReceipt?.commandId === pendingCommandIdRef.current) pendingCommandIdRef.current = null;
      if (confirmedReceipt?.kind === 'SetOpeningCash') onLedgerChangedRef.current?.();
      updateFor(key, generation, previous => {
        const confirmsPending = confirmedReceipt
          && previous.recovery?.commandId === confirmedReceipt.commandId
          && previous.recovery.command !== undefined;
        const confirmedCommand = confirmsPending ? previous.recovery?.command : null;
        return {
          ...previous,
          ...formDraftsFor(snapshot),
          snapshot,
          dayIdDraft: snapshot.dayId,
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
      if (!isCurrent(key, generation) || requestId !== listRequestRef.current) return;
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
          ...clearFormDrafts(),
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
      listRequestRef.current += 1;
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
        ...clearFormDrafts(),
        snapshot: null,
        loading: false,
        loadError: `操作未完成：${errorMessage(result.error)}請重新載入伺服器資料後繼續。`,
        actionError: command.kind === 'set-day-menu' && ['REVISION_CONFLICT', 'INVALID_INPUT'].includes(result.error.code)
          ? '本次菜單命令未成功，輸入與來源日期沒有自動改寫。請重新載入並確認最新菜單來源及伺服器使用權日期；若已跨過臺北午夜，請先取得更新的使用權。'
          : '',
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
    await loadSnapshot(commandDayId(command) || undefined, result.receipt);
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
    const flightToken = Symbol('cloud-day-vendor-command');
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
      result = await dispatchPreparedCommand(repository, command, leaseEpoch);
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
      if (recovery.receipt) await loadSnapshot(commandDayId(recovery.command) || undefined, recovery.receipt);
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

      // The ID alone is insufficient: replay the frozen semantic input with the
      // same command ID so the repository verifies exact command identity.
      let verification: CommandResult;
      try {
        verification = await dispatchPreparedCommand(repository, recovery.command, leaseEpoch);
      } catch (error) {
        if (!isCurrent(key, generation)) return;
        if (isAuthorizationLoss(error)) {
          revokeAuthorization(key, generation, recovery.commandId, error);
          return;
        }
        updateFor(key, generation, previous => ({
          ...previous,
          ...clearFormDrafts(),
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
      if (!verification.ok && verification.error.code !== 'UNKNOWN_RESULT') {
        updateFor(key, generation, previous => ({
          ...previous,
          ...clearFormDrafts(),
          snapshot: null,
          loading: false,
          actionError: `命令編號已存在，但伺服器內容與原操作不符，仍未確認完成。${verification.error.message}`,
          recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
        }));
        return;
      }
      if (!verification.ok) {
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          actionError: '已找到命令回執，但語義比對結果不明；請使用相同命令編號再查詢。',
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
        ...clearFormDrafts(),
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

  const makePreparedCommandId = (): string | null => {
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
    if (page.recovery || !page.snapshot) return;
    if (!isBusinessDate(page.dayIdDraft) || page.dayIdDraft < page.snapshot.goLiveDate) {
      updatePage(previous => ({ ...previous, actionError: `營業日必須是 ${page.snapshot!.goLiveDate} 或之後的有效日期。` }));
      return;
    }
    if (page.dayIdDraft === page.snapshot.dayId) return;
    void loadSnapshot(page.dayIdDraft);
  };

  const submitEnsureDay = () => {
    const snapshot = page.snapshot;
    if (!snapshot || snapshot.day || page.recovery) return;
    if (snapshot.dayId < snapshot.goLiveDate) {
      updatePage(previous => ({ ...previous, actionError: '不能在系統啟用日期之前建立營業日。' }));
      return;
    }
    const commandId = makePreparedCommandId();
    if (!commandId) return;
    void runPreparedCommand({ kind: 'ensure-day', commandId, dayId: snapshot.dayId });
  };

  const openVendorCreate = () => updatePage(previous => ({
    ...previous,
    createVendorOpen: !previous.createVendorOpen,
    editingVendorId: null,
    removingVendorId: null,
    vendorDraft: freshVendorDraft(),
    actionError: '',
  }));

  const beginVendorEdit = (vendor: CloudVendorRecord) => updatePage(previous => ({
    ...previous,
    createVendorOpen: false,
    editingVendorId: vendor.vendorId,
    removingVendorId: null,
    vendorDraft: {
      vendorId: vendor.vendorId,
      name: vendor.name,
      phone: vendor.phone,
      note: vendor.note,
      status: vendor.status,
    },
    actionError: '',
  }));

  const submitVendor = (draft: CloudDayVendorDraft) => {
    const snapshot = page.snapshot;
    if (!snapshot || page.recovery) return;
    const isCreate = page.editingVendorId === null;
    if (!draft.vendorId.length || draft.vendorId.length > 64 || draft.vendorId.includes('/')) {
      updatePage(previous => ({ ...previous, actionError: '供應商編號必須為 1 至 64 個字元，且不能包含斜線。' }));
      return;
    }
    if (draft.name.length < 1 || draft.name.length > 100) {
      updatePage(previous => ({ ...previous, actionError: '供應商名稱必須為 1 至 100 個字元。' }));
      return;
    }
    if (draft.phone.length > 100 || draft.note.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '電話最多 100 個字元，備註最多 500 個字元。' }));
      return;
    }
    if (isCreate && snapshot.vendors.some(vendor => vendor.vendorId === draft.vendorId)) {
      updatePage(previous => ({ ...previous, actionError: `供應商編號 ${draft.vendorId} 已存在，不能重複使用。` }));
      return;
    }
    const current = isCreate ? null : snapshot.vendors.find(vendor => vendor.vendorId === page.editingVendorId) ?? null;
    if (!isCreate && !current) {
      updatePage(previous => ({ ...previous, actionError: '這家供應商已不在最新伺服器名單，請重新載入。' }));
      return;
    }
    const commandId = makePreparedCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'save-vendor',
      commandId,
      viewDayId: snapshot.dayId,
      vendorId: draft.vendorId,
      expectedRevision: current?.revision ?? 0,
      name: draft.name,
      phone: draft.phone,
      note: draft.note,
      status: isCreate ? 'active' : draft.status,
    });
  };

  const beginVendorRemoval = (vendor: CloudVendorRecord) => {
    if (vendor.status !== 'inactive' || vendor.deleted) return;
    updatePage(previous => ({
      ...previous,
      createVendorOpen: false,
      editingVendorId: null,
      removingVendorId: vendor.vendorId,
      removeReason: '',
      actionError: '',
    }));
  };

  const submitVendorRemoval = (event: FormEvent<HTMLFormElement>, vendor: CloudVendorRecord) => {
    event.preventDefault();
    if (page.recovery || !page.snapshot || vendor.status !== 'inactive' || vendor.deleted) return;
    if (page.removeReason.length < 1 || page.removeReason.length > 500) {
      updatePage(previous => ({ ...previous, actionError: '移除原因必須為 1 至 500 個字元。' }));
      return;
    }
    const commandId = makePreparedCommandId();
    if (!commandId) return;
    const input: Omit<RemoveVendorInput, 'commandId' | 'leaseEpoch'> = {
      vendorId: vendor.vendorId,
      expectedRevision: vendor.revision,
      reason: page.removeReason,
    };
    void runPreparedCommand({ kind: 'remove-vendor', commandId, viewDayId: page.snapshot!.dayId, ...input });
  };

  const updateMenuDraft = (draft: CloudDayMenuDraft) => updatePage(previous => ({
    ...previous,
    menuDraft: draft,
    inheritedFromDate: null,
    actionError: '',
  }));

  const beginMenuInheritance = () => {
    const source = page.snapshot?.latestEarlierMenu;
    if (!source || source.blocked !== null || !source.sourceVendor
      || source.sourceVendor.status !== 'active' || source.sourceVendor.deleted
      || source.sourceVendor.name !== source.menu.vendorNameSnapshot) return;
    updatePage(previous => ({
      ...previous,
      menuDraft: {
        itemName: source.menu.itemName,
        priceText: String(source.menu.price),
        vendorId: source.menu.vendorId,
      },
      inheritedFromDate: source.sourceDayId,
      actionError: '',
      notice: `已選取 ${source.sourceDayId} 的最新較早菜單；沿用內容會依原快照送出。`,
    }));
  };

  const switchMenuToDirect = () => updatePage(previous => ({
    ...previous,
    inheritedFromDate: null,
    actionError: '',
    notice: '已切換為直接設定；請確認菜單名稱、價格與使用中的供應商。',
  }));

  const submitMenu = (draft: CloudDayMenuDraft) => {
    const snapshot = page.snapshot;
    const day = snapshot?.day;
    if (!snapshot || !day || page.recovery) return;
    if (day.status === 'closed') {
      updatePage(previous => ({ ...previous, actionError: '營業日已關閉，不能修改菜單。請重新載入確認最新狀態。' }));
      return;
    }

    let itemName = draft.itemName;
    let price: number;
    let vendorId: string;
    let vendorNameSnapshot: string;
    let inheritedFromDate: string | null = null;

    if (page.inheritedFromDate) {
      const source = snapshot.latestEarlierMenu;
      if (!source || source.sourceDayId !== page.inheritedFromDate || source.blocked !== null
        || !source.sourceVendor || source.sourceVendor.status !== 'active' || source.sourceVendor.deleted
        || source.sourceVendor.name !== source.menu.vendorNameSnapshot) {
        updatePage(previous => ({ ...previous, actionError: '沿用來源或供應商已變更；請重新載入，再直接確認菜單。' }));
        return;
      }
      itemName = source.menu.itemName;
      price = source.menu.price;
      vendorId = source.menu.vendorId;
      vendorNameSnapshot = source.menu.vendorNameSnapshot;
      inheritedFromDate = source.sourceDayId;
    } else {
      if (draft.itemName.length < 1 || draft.itemName.length > 100) {
        updatePage(previous => ({ ...previous, actionError: '菜單名稱必須為 1 至 100 個字元。' }));
        return;
      }
      if (!/^\d+$/.test(draft.priceText)) {
        updatePage(previous => ({ ...previous, actionError: '菜單價格必須明確輸入 1 至 1,000,000 元的整數。' }));
        return;
      }
      price = Number(draft.priceText);
      if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000 || Object.is(price, -0)) {
        updatePage(previous => ({ ...previous, actionError: '菜單價格必須是 1 至 1,000,000 元的整數。' }));
        return;
      }
      const vendor = snapshot.vendors.find(item => item.vendorId === draft.vendorId);
      if (!vendor || vendor.status !== 'active' || vendor.deleted) {
        updatePage(previous => ({ ...previous, actionError: '請選擇仍在使用中的供應商。' }));
        return;
      }
      vendorId = vendor.vendorId;
      vendorNameSnapshot = vendor.name;
    }

    const commandId = makePreparedCommandId();
    if (!commandId) return;
    const input: Omit<SetDayMenuInput, 'commandId' | 'leaseEpoch'> = {
      dayId: snapshot.dayId,
      selectionDate: snapshot.selectionDate,
      expectedRevision: day.revision,
      expectedHeadSeq: snapshot.seq,
      itemName,
      price,
      vendorId,
      vendorNameSnapshot,
      inheritedFromDate,
    };
    void runPreparedCommand({ kind: 'set-day-menu', commandId, ...input });
  };

  const submitOpeningCash = (amountText: string) => {
    const snapshot = page.snapshot;
    const day = snapshot?.day;
    if (!snapshot || !day || page.recovery) return;
    if (snapshot.dayId !== snapshot.selectionDate || snapshot.selectionDate < snapshot.goLiveDate) {
      updatePage(previous => ({ ...previous, actionError: '開帳現金只能設定伺服器使用權日期的營業日；請確認最新使用權日期。' }));
      return;
    }
    if (day.status === 'closed') {
      updatePage(previous => ({ ...previous, actionError: '營業日已關閉，不能修改開帳現金。請重新載入確認最新狀態。' }));
      return;
    }
    if (!/^\d+$/.test(amountText)) {
      updatePage(previous => ({ ...previous, actionError: '開帳現金必須明確輸入 0 至 20,000 元的整數；空白、負數與小數均不接受。' }));
      return;
    }
    const openingCash = Number(amountText);
    if (!Number.isSafeInteger(openingCash) || openingCash < 0 || openingCash > 20_000 || Object.is(openingCash, -0)) {
      updatePage(previous => ({ ...previous, actionError: '開帳現金限 0 至 20,000 元的整數。' }));
      return;
    }
    let reason: string | undefined;
    if (ledger) {
      if (previousLookup.status !== 'ready' || previousLookup.dayId !== snapshot.dayId) {
        updatePage(previous => ({ ...previous, actionError: '尚未確認上一個已關帳日的實點現金，請稍候或重新整理後再開帳。' }));
        return;
      }
      if (openingDifference(previousLookup.previous, openingCash) !== null) {
        reason = page.openingReasonText.trim();
        if (reason.length < 1 || reason.length > 500) {
          updatePage(previous => ({ ...previous, actionError: '開帳現金與上次關帳實點不同，必須填寫 1 至 500 字的差額原因。' }));
          return;
        }
      }
    }
    const commandId = makePreparedCommandId();
    if (!commandId) return;
    const input: Omit<SetOpeningCashInput, 'commandId' | 'leaseEpoch'> = {
      dayId: snapshot.dayId,
      expectedRevision: day.revision,
      openingCash,
      ...(reason === undefined ? {} : { reason }),
    };
    void runPreparedCommand({ kind: 'set-opening-cash', commandId, ...input });
  };

  const busy = page.recovery !== null;
  const snapshot = page.snapshot;
  const activeVendors = snapshot?.vendors.filter(vendor => vendor.status === 'active' && !vendor.deleted) ?? [];
  const canMutateDay = snapshot?.day !== null && snapshot?.day !== undefined && snapshot.day.status !== 'closed';
  const canSetOpeningCash = !!snapshot
    && snapshot.dayId === snapshot.selectionDate
    && snapshot.selectionDate >= snapshot.goLiveDate
    && snapshot.day !== null
    && snapshot.day.status !== 'closed';
  // 開帳表單只需要「上一個已關帳日」：依日期分段往回找，不依賴整段帳務異常掃描（契約 §11.2）。
  const lookupDayId = ledger && canSetOpeningCash && snapshot ? snapshot.dayId : null;
  const ledgerKey = ledger?.status === 'ready' ? `seq:${ledger.snapshot.seq}` : (ledger?.status ?? 'none');
  useEffect(() => {
    if (lookupDayId === null) return undefined;
    let cancelled = false;
    repository.findPreviousClosed(lookupDayId).then(
      result => { if (!cancelled) setPreviousLookup({ status: 'ready', dayId: lookupDayId, previous: result.previous }); },
      (error: unknown) => {
        if (cancelled) return;
        setPreviousLookup({
          status: 'error', dayId: lookupDayId, message: error instanceof Error ? error.message : '無法讀取上一個已關帳日',
        });
      },
    );
    return () => { cancelled = true; };
  }, [repository, lookupDayId, ledgerKey, lookupAttempt]);
  const lookupReady = previousLookup.status === 'ready' && previousLookup.dayId === lookupDayId;
  const lookupError = previousLookup.status === 'error' && previousLookup.dayId === lookupDayId;
  const source = snapshot?.latestEarlierMenu ?? null;
  const canInherit = !!source && source.blocked === null && !!source.sourceVendor
    && source.sourceVendor.status === 'active' && !source.sourceVendor.deleted
    && source.sourceVendor.name === source.menu.vendorNameSnapshot;
  return (
    <main className="cloud-day-vendors" aria-label="雲端日期設定與供應商管理">
      <header className="cloud-day-vendors__header">
        <div>
          <p className="cloud-day-vendors__eyebrow">雲端資料 · 線上操作</p>
          <h1>營業日、菜單與供應商</h1>
          <p className="cloud-day-vendors__intro">日期與供應商資料只從伺服器完整載入。未確認開帳與零元開帳分開顯示；菜單與供應商變更不改寫既有歷史快照。</p>
        </div>
        <button
          type="button"
          className="cloud-day-vendors__secondary"
          onClick={() => void loadSnapshot((snapshot?.dayId ?? page.dayIdDraft) || undefined, page.recovery?.phase === 'receipt' ? page.recovery.receipt : undefined)}
          disabled={page.loading || !identityKey || page.authorizationRevoked}
        >
          {page.loading ? '載入中…' : '重新載入伺服器資料'}
        </button>
      </header>

      {page.loadError && <div className="cloud-day-vendors__alert" role="alert">{page.loadError}</div>}
      {page.actionError && <div className="cloud-day-vendors__alert" role="alert">{page.actionError}</div>}
      {page.authorizationRevoked && (
        <div className="cloud-day-vendors__notice" role="status">
          授權狀態已失效。敏感資料與操作草稿已清除；請重新登入並取得有效使用權。
        </div>
      )}
      {page.notice && <div className="cloud-day-vendors__notice" role="status">{page.notice}</div>}

      {page.recovery && (
        <section className="cloud-day-vendors__recovery" aria-label="命令結果確認" role="alert">
          <strong>{page.recovery.phase === 'receipt'
            ? '已找到伺服器回執，資料尚待再次讀取。'
            : page.recovery.phase === 'access-lost'
              ? '使用權已變更；敏感操作內容已清除。'
              : page.recovery.phase === 'checking'
                ? '正在查詢原命令結果…'
                : page.recovery.phase === 'submitting'
                  ? '命令送出中，請勿重複操作。'
                  : '結果確認中，請勿重複操作。'}</strong>
          <span>{page.recovery.command ? `${commandLabel(page.recovery.command)} · 命令編號 ${page.recovery.commandId}` : `命令編號 ${page.recovery.commandId}`}</span>
          {page.recovery.phase === 'access-lost' && <span>只保留命令編號；請先重新確認登入帳號與使用權，再依現場流程核對。</span>}
          {page.recovery.phase === 'receipt' && page.recovery.receipt && <span>伺服器命令序號 {page.recovery.receipt.seq}</span>}
          <div className="cloud-day-vendors__actions">
            {page.recovery.command && page.recovery.phase !== 'submitting' && page.recovery.phase !== 'checking' && page.recovery.phase !== 'receipt' && (
              <button type="button" className="cloud-day-vendors__primary" onClick={() => void checkPendingCommand()}>
                查詢原命令結果
              </button>
            )}
            {page.recovery.phase === 'unknown' && page.recovery.command && page.actionError.includes('尚未找到') && (
              <button type="button" className="cloud-day-vendors__secondary" onClick={() => void runPreparedCommand(page.recovery!.command!)}>
                以相同命令編號重試
              </button>
            )}
            {page.recovery.phase === 'receipt' && (
              <button
                type="button"
                className="cloud-day-vendors__secondary"
                onClick={() => void loadSnapshot(commandDayId(page.recovery!.command!) || undefined, page.recovery?.receipt)}
                disabled={page.loading}
              >
                重新讀取伺服器資料
              </button>
            )}
          </div>
        </section>
      )}

      {page.loading && <div className="cloud-day-vendors__loading" role="status">正在從伺服器載入完整營業日與供應商資料…</div>}

      {snapshot && !page.loading && (
        <>
          <section className="cloud-day-vendors__date-panel" aria-label="營業日選擇">
            <form className="cloud-day-vendors__date-form" onSubmit={submitDateSelection}>
              <label htmlFor="cloud-day-vendors-date">查看或設定日期</label>
              <input
                id="cloud-day-vendors-date"
                className="cloud-day-vendors__input cloud-day-vendors__mono"
                type="date"
                min={snapshot.goLiveDate}
                value={page.dayIdDraft || snapshot.dayId}
                onChange={event => updatePage(previous => ({ ...previous, dayIdDraft: event.target.value, actionError: '' }))}
                disabled={busy}
                required
              />
              <button type="submit" className="cloud-day-vendors__secondary" disabled={busy || page.dayIdDraft === snapshot.dayId}>
                載入日期
              </button>
            </form>
            <div className="cloud-day-vendors__date-meta">
              <span>系統啟用日：{snapshot.goLiveDate}</span>
              <span>伺服器使用權日期：{snapshot.selectionDate}</span>
              <span>資料序號：{snapshot.seq}</span>
            </div>
            <p className="cloud-day-vendors__help">使用權日期來自伺服器租約時間，瀏覽器時鐘不會決定營業日或改寫命令日期。若跨過臺北午夜，請先取得伺服器更新的使用權，再重新載入。</p>
          </section>

          <section className="cloud-day-vendors__day-section" aria-label="指定營業日">
            <div className="cloud-day-vendors__section-heading">
              <div>
                <h2>{snapshot.dayId} 營業日</h2>
                <p>{snapshot.day ? `狀態：${snapshot.day.status === 'closed' ? '已關帳' : snapshot.day.status === 'reopened' ? '已重開' : '開啟中'} · revision ${snapshot.day.revision}` : '伺服器尚無此日期文件；建立日期只建立空白營業日，不會建立菜單或開帳金額。'}</p>
              </div>
              {!snapshot.day && (
                <button type="button" className="cloud-day-vendors__primary" onClick={submitEnsureDay} disabled={busy || snapshot.dayId < snapshot.goLiveDate}>
                  建立空白營業日
                </button>
              )}
            </div>
            {snapshot.day?.status === 'closed' && <p className="cloud-day-vendors__warning">此日期已關帳，不能修改菜單與開帳金額。要修改請先到「日結」頁填寫原因重開。</p>}

            {snapshot.day && (
              <>
                <section className="cloud-day-vendors__card" aria-label="日期菜單設定">
                  <div className="cloud-day-vendors__section-heading">
                    <div>
                      <h3>日期菜單</h3>
                      {snapshot.day.menu ? (
                        <dl className="cloud-day-vendors__summary">
                          <dt>目前菜單</dt><dd>{snapshot.day.menu.itemName}</dd>
                          <dt>價格</dt><dd>{formatMoney(snapshot.day.menu.price)}</dd>
                          <dt>供應商快照</dt><dd>{snapshot.day.menu.vendorNameSnapshot}</dd>
                          {snapshot.day.menu.inheritedFromDate && <><dt>當時沿用來源</dt><dd>{snapshot.day.menu.inheritedFromDate}</dd></>}
                        </dl>
                      ) : <p>此日期尚未設定菜單。</p>}
                    </div>
                  </div>

                  {source && source.blocked && <p className="cloud-day-vendors__warning">{blockedInheritanceMessage(source.blocked)}（來源日期：{source.sourceDayId}）</p>}
                  {canInherit && source && (
                    <div className="cloud-day-vendors__inherit-card">
                      <p>最近較早菜單：{source.sourceDayId} · {source.menu.itemName} · {formatMoney(source.menu.price)} · {source.menu.vendorNameSnapshot}</p>
                      <p>沿用只選取這筆最新較早菜單，來源日期須早於目標日期且不晚於伺服器使用權日期；儲存後的菜單快照不會隨供應商變更。</p>
                      <div className="cloud-day-vendors__actions">
                        <button type="button" className="cloud-day-vendors__secondary" onClick={beginMenuInheritance} disabled={busy || !canMutateDay}>
                          帶入最新較早菜單
                        </button>
                        {page.inheritedFromDate && <button type="button" className="cloud-day-vendors__secondary" onClick={switchMenuToDirect} disabled={busy}>改為直接設定</button>}
                      </div>
                    </div>
                  )}
                  {page.inheritedFromDate && <p className="cloud-day-vendors__notice" role="status">沿用來源已鎖定為 {page.inheritedFromDate}。若要變更任一欄位，請改用直接設定。</p>}
                  <CloudDayMenuForm
                    businessDate={snapshot.dayId}
                    value={page.menuDraft}
                    vendors={activeVendors.map(vendor => ({ vendorId: vendor.vendorId, name: vendor.name }))}
                    onChange={updateMenuDraft}
                    onSubmit={submitMenu}
                    disabled={busy || !canMutateDay}
                    fieldsReadOnly={!!page.inheritedFromDate}
                  />
                </section>

                <section className="cloud-day-vendors__card" aria-label="開帳現金設定">
                  <div className="cloud-day-vendors__section-heading">
                    <div>
                      <h3>開帳現金</h3>
                      {snapshot.day.openedAt && (
                        <p>首次開帳人：{snapshot.day.openedBy ?? '未知'} · 首次確認時間（臺北）：{formatServerTime(snapshot.day.openedAt)}</p>
                      )}
                    </div>
                  </div>
                  {snapshot.dayId !== snapshot.selectionDate && (
                    <p className="cloud-day-vendors__warning">開帳僅限伺服器使用權日期 {snapshot.selectionDate}。此日期可預排菜單，但不能預先開帳。</p>
                  )}
                  {snapshot.dayId === snapshot.selectionDate && snapshot.selectionDate < snapshot.goLiveDate && (
                    <p className="cloud-day-vendors__warning">伺服器使用權日期早於系統啟用日，尚不能設定開帳現金。</p>
                  )}
                  {canSetOpeningCash && <LedgerUnclosedBanner ledger={ledger} onOpenAnomalies={onOpenAnomalies} />}
                  {canSetOpeningCash && ledger && lookupError && (
                    <button
                      type="button"
                      className="cloud-day-vendors__secondary"
                      data-testid="opening-lookup-retry"
                      disabled={busy}
                      onClick={() => { setPreviousLookup({ status: 'idle' }); setLookupAttempt(value => value + 1); }}
                    >
                      重新查詢上一個已關帳日
                    </button>
                  )}
                  {canSetOpeningCash ? (
                    <CloudDayOpeningCashForm
                      businessDate={snapshot.dayId}
                      currentOpeningCash={snapshot.day.openingCash}
                      amountText={page.openingCashText}
                      onAmountTextChange={value => updatePage(previous => ({ ...previous, openingCashText: value, actionError: '' }))}
                      onSubmit={submitOpeningCash}
                      disabled={busy}
                      {...(ledger ? {
                        previousClosed: lookupReady ? previousLookup.previous : null,
                        ledgerNotice: lookupError
                          ? `無法確認上一個已關帳日的實點現金（${previousLookup.message}），暫時不能開帳。`
                          : lookupReady ? '' : '正在確認上一個已關帳日的實點現金…',
                        reasonText: page.openingReasonText,
                        onReasonTextChange: (value: string) => updatePage(previous => ({ ...previous, openingReasonText: value, actionError: '' })),
                      } : {})}
                    />
                  ) : snapshot.dayId === snapshot.selectionDate && snapshot.day.status === 'closed' ? (
                    <p className="cloud-day-vendors__warning">此日期已關帳，不能修改開帳現金。</p>
                  ) : null}
                </section>
              </>
            )}
          </section>

          <section className="cloud-day-vendors__vendor-section" aria-label="供應商管理">
            <div className="cloud-day-vendors__section-heading">
              <div>
                <h2>供應商</h2>
                <p>{snapshot.vendors.length} 家可管理供應商（停用資料仍可恢復；已移除資料由伺服器保留 tombstone，編號不重用）。</p>
              </div>
              <button
                type="button"
                className="cloud-day-vendors__primary"
                onClick={openVendorCreate}
                disabled={busy}
              >
                {page.createVendorOpen ? '取消新增' : '新增供應商'}
              </button>
            </div>

            {page.createVendorOpen && (
              <div className="cloud-day-vendors__form-wrap">
                <CloudDayVendorForm mode="create" value={page.vendorDraft} onChange={value => updatePage(previous => ({ ...previous, vendorDraft: value }))} onSubmit={submitVendor} disabled={busy} />
              </div>
            )}
            {page.editingVendorId && (
              <div className="cloud-day-vendors__form-wrap">
                <CloudDayVendorForm mode="edit" value={page.vendorDraft} onChange={value => updatePage(previous => ({ ...previous, vendorDraft: value }))} onSubmit={submitVendor} disabled={busy} />
                <button type="button" className="cloud-day-vendors__secondary" onClick={() => updatePage(previous => ({ ...previous, editingVendorId: null, vendorDraft: freshVendorDraft(), actionError: '' }))} disabled={busy}>取消編輯</button>
              </div>
            )}

            {snapshot.vendors.length === 0 ? (
              <div className="cloud-day-vendors__empty" role="status">目前伺服器沒有可管理的供應商，請新增一筆供應商資料。</div>
            ) : (
              <div className="cloud-day-vendors__table-wrap">
                <table>
                  <thead><tr><th>編號</th><th>名稱</th><th>電話</th><th>備註</th><th>狀態</th><th>操作</th></tr></thead>
                  <tbody>
                    {snapshot.vendors.map(vendor => (
                      <tr key={vendor.vendorId} data-testid={`cloud-vendor-row-${vendor.vendorId}`}>
                        <td className="cloud-day-vendors__mono">{vendor.vendorId}</td>
                        <td>{vendor.name}</td>
                        <td>{vendor.phone || '—'}</td>
                        <td>{vendor.note || '—'}</td>
                        <td><span className={`cloud-day-vendors__status cloud-day-vendors__status--${vendor.status}`}>{vendor.status === 'active' ? '使用中' : '已停用'}</span></td>
                        <td>
                          <div className="cloud-day-vendors__row-actions">
                            {page.removingVendorId === vendor.vendorId ? (
                              <form className="cloud-day-vendors__remove-form" aria-label={`移除供應商 ${vendor.vendorId}`} onSubmit={event => submitVendorRemoval(event, vendor)}>
                                <p>移除會保留稽核 tombstone 和歷史快照，不能重用編號。</p>
                                <label>移除原因（必填，最多 500 字）
                                  <textarea className="cloud-day-vendors__input" rows={2} maxLength={500} value={page.removeReason} onChange={event => updatePage(previous => ({ ...previous, removeReason: event.target.value }))} disabled={busy} required />
                                </label>
                                <div className="cloud-day-vendors__actions">
                                  <button type="submit" className="cloud-day-vendors__danger" disabled={busy}>確認移除</button>
                                  <button type="button" className="cloud-day-vendors__secondary" onClick={() => updatePage(previous => ({ ...previous, removingVendorId: null, removeReason: '', actionError: '' }))} disabled={busy}>取消</button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <button type="button" className="cloud-day-vendors__secondary" onClick={() => beginVendorEdit(vendor)} disabled={busy}>編輯／停用／恢復</button>
                                {vendor.status === 'inactive' && (
                                  <button type="button" className="cloud-day-vendors__danger" onClick={() => beginVendorRemoval(vendor)} disabled={busy}>移除</button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="cloud-day-vendors__footnote">建立、編輯、停用、恢復與移除都是逐筆伺服器命令。停用或移除供應商不會改寫營業日菜單及既有交易中的名稱快照。</p>
          </section>
        </>
      )}

      {!snapshot && !page.loading && !page.recovery && (
        <section className="cloud-day-vendors__unavailable" aria-label="雲端資料未載入">
          <p>營業日與供應商資料尚未從伺服器完整載入，沒有顯示空白清單或本機資料。</p>
          <button type="button" className="cloud-day-vendors__primary" onClick={() => void loadSnapshot(page.dayIdDraft || undefined)} disabled={!identityKey || page.authorizationRevoked}>
            重新載入伺服器資料
          </button>
        </section>
      )}
    </main>
  );
}

export default CloudDayVendorsPage;
