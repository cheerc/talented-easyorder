import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import {
  createCloudDayVendorRepository,
  type CloudDayVendorCommandIntent,
  type CloudDayVendorSnapshot,
  type CloudVendorRecord,
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
import { Callout } from '../ui/Callout';
import { CommandProgress } from '../ui/CommandProgress';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { DateField } from '../ui/DateField';
import { EmptyState } from '../ui/EmptyState';
import { HelpTip } from '../ui/HelpTip';
import { StatusBadge } from '../ui/StatusBadge';
import { Toast } from '../ui/Toast';
import { DataUpdatedNotice } from './DataUpdatedNotice';
import { LedgerUnclosedBanner } from './LedgerUnclosedBanner';
import './CloudDayVendorsPage.css';
import { operatorDisplayLabel, type OperatorSelf } from '../../domain/operatorDisplay';
import { formatBusinessDate } from '../../utils/businessDate';

type PreviousClosedLookupView =
  | { status: 'idle' }
  | { status: 'ready'; dayId: string; previous: PreviousClosedDay | null }
  | { status: 'error'; dayId: string; message: string };

export interface CloudDayVendorsPageProps {
  view?: 'combined' | 'day' | 'vendors';
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  /** 目前操作員；沒有 email 的紀錄用它判斷「是不是自己」（#668），不新增任何讀取。 */
  operatorSelf?: OperatorSelf | null;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  onDraftCleared?: () => void;
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
  timedOut?: boolean;
  canRetry?: boolean;
  receipt?: CommandReceipt;
  /** The receipt came back inside ten seconds from the original submission: its re-read is shown quietly (#585). */
  quiet?: boolean;
}

interface DayVendorCommandOperation {
  token: symbol;
  identityKey: string;
  generation: number;
  db: Firestore;
  app: Firestore['app'];
  uid: string;
  leaseEpoch: number;
  datasetId: string;
  viewDayId: string;
  command: PreparedCommand | null;
  intent: CloudDayVendorCommandIntent | null;
  attempt: number;
  attemptPromise: Promise<CommandResult> | null;
  attemptSettled: boolean;
  querySequence: number;
  checking: boolean;
  retryAuthorized: boolean;
  receipt: CommandReceipt | null;
  completed: boolean;
  timerId: number | null;
  cleanupWarning: string;
}

interface PageState {
  scopeKey: string;
  authorizationRevoked: boolean;
  snapshot: CloudDayVendorSnapshot | null;
  /**
   * The server-confirmed snapshot from before the command in flight and the one re-read that follows its receipt (#585). Display
   * only: the old content stays in place, locked with `inert`, instead of vanishing behind a text panel. Never used to build a
   * command, and shown only while the command is quiet, with no revoked authorization and no read error.
   */
  refreshingSnapshot: CloudDayVendorSnapshot | null;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  /** The short success sentence of a confirmed command (#585), shown as a bottom toast. */
  toast: string;
  dayIdDraft: string;
  createVendorOpen: boolean;
  vendorDraft: CloudDayVendorDraft;
  editingVendorId: string | null;
  removingVendorId: string | null;
  removeReason: string;
  menuDraft: CloudDayMenuDraft;
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
  'createVendorOpen' | 'vendorDraft' | 'editingVendorId' | 'removingVendorId' | 'removeReason' | 'menuDraft' | 'openingCashText' | 'openingReasonText'> {
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
    refreshingSnapshot: null,
    loading: true,
    loadError: '',
    actionError: '',
    notice: '',
    toast: '',
    dayIdDraft: '',
    createVendorOpen: false,
    vendorDraft: freshVendorDraft(),
    editingVendorId: null,
    removingVendorId: null,
    removeReason: '',
    menuDraft: freshMenuDraft(),
    openingCashText: '',
    openingReasonText: '',
    recovery: null,
  };
}

function clearFormDrafts(): Pick<PageState,
  'createVendorOpen' | 'vendorDraft' | 'editingVendorId' | 'removingVendorId' | 'removeReason' | 'menuDraft' | 'openingCashText' | 'openingReasonText'> {
  return {
    createVendorOpen: false,
    vendorDraft: freshVendorDraft(),
    editingVendorId: null,
    removingVendorId: null,
    removeReason: '',
    menuDraft: freshMenuDraft(),
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
  if (code === 'LEASE_LOST' || code === 'ACCESS_BUSY') return '其他人已登入或登入已失效，雲端日期與供應商資料已清除。請重新登入。';
  if (code === 'UNAUTHORIZED') return '目前帳號沒有雲端日期與供應商資料存取權，資料已清除。請重新登入確認權限。';
  if (code === 'QUOTA_EXCEEDED') return '雲端讀取額度不足，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'MAINTENANCE') return '系統正在維護，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'INCOMPLETE_SNAPSHOT') return '伺服器資料超過完整讀取範圍，沒有顯示部分資料。請聯絡系統維護者。';
  if (code === 'STALE_SNAPSHOT') return '載入期間伺服器資料有變動，沒有顯示部分資料。請重新載入。';
  if (code === 'UNSUPPORTED_SCHEMA') return '伺服器資料格式目前無法安全讀取，沒有顯示部分資料。請聯絡系統維護者。';
  if (code === 'UNKNOWN_RESULT') return '伺服器結果目前無法確認，沒有顯示部分資料。請重新確認命令或重新載入。';
  if (code === 'LOCAL_STORAGE_UNAVAILABLE') return '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。';
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

function freezePreparedCommand(command: PreparedCommand): PreparedCommand {
  return freezeValue(command);
}

function browserIsOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === true;
}

function intentFor(command: PreparedCommand, leaseEpoch: number): CloudDayVendorCommandIntent {
  if (command.kind === 'ensure-day') return {
    kind: 'ensure-day', input: { commandId: command.commandId, leaseEpoch, dayId: command.dayId },
  };
  if (command.kind === 'save-vendor') return {
    kind: 'save-vendor', input: {
      commandId: command.commandId, leaseEpoch, vendorId: command.vendorId,
      expectedRevision: command.expectedRevision, name: command.name, phone: command.phone,
      note: command.note, status: command.status,
    },
  };
  if (command.kind === 'remove-vendor') return {
    kind: 'remove-vendor', input: {
      commandId: command.commandId, leaseEpoch, vendorId: command.vendorId,
      expectedRevision: command.expectedRevision, reason: command.reason,
    },
  };
  if (command.kind === 'set-day-menu') return {
    kind: 'set-day-menu', input: {
      commandId: command.commandId, leaseEpoch, dayId: command.dayId,
      selectionDate: command.selectionDate, expectedRevision: command.expectedRevision,
      expectedHeadSeq: command.expectedHeadSeq, itemName: command.itemName, price: command.price,
      vendorId: command.vendorId, vendorNameSnapshot: command.vendorNameSnapshot,
      inheritedFromDate: command.inheritedFromDate,
    },
  };
  return {
    kind: 'set-opening-cash', input: {
      commandId: command.commandId, leaseEpoch, dayId: command.dayId,
      expectedRevision: command.expectedRevision, openingCash: command.openingCash,
      ...(command.reason === undefined ? {} : { reason: command.reason }),
    },
  };
}

function dayStatusLabel(status: 'open' | 'closed' | 'reopened'): string {
  return status === 'closed' ? '已關帳' : status === 'reopened' ? '已重開' : '開啟中';
}

function dayStatusVariant(status: 'open' | 'closed' | 'reopened'): 'ok' | 'neutral' | 'warn' {
  return status === 'closed' ? 'neutral' : status === 'reopened' ? 'warn' : 'ok';
}

export function CloudDayVendorsPage({
  db, leaseEpoch, identityKey, operatorSelf = null, onNavigationStateChange, ledger, onOpenAnomalies, onLedgerChanged, onDraftCleared, view = 'combined',
}: CloudDayVendorsPageProps) {
  const recoveryReader = useMemo(() => getCloudRecoveryReader(db), [db]);
  const repository = useMemo(() => createCloudDayVendorRepository(db, { recoveryReader }), [db, recoveryReader]);
  const onLedgerChangedRef = useRef(onLedgerChanged);
  useLayoutEffect(() => { onLedgerChangedRef.current = onLedgerChanged; }, [onLedgerChanged]);
  let currentUid: string | null = null;
  try { currentUid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
  const [previousLookup, setPreviousLookup] = useState<PreviousClosedLookupView>({ status: 'idle' });
  /** Bumped by the retry button so a failed previous-closed-day lookup can run again without reloading the page. */
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const authorizationScopeKey = `${identityKey}:${leaseEpoch}`;
  const authorizationScopeRef = useRef(authorizationScopeKey);
  const revokedScopeRef = useRef<string | null>(null);
  const pendingCommandIdRef = useRef<string | null>(null);
  if (authorizationScopeRef.current !== authorizationScopeKey) {
    authorizationScopeRef.current = authorizationScopeKey;
    revokedScopeRef.current = null;
    pendingCommandIdRef.current = null;
  }
  const bindingRef = useRef({ db, uid: currentUid, identityKey, leaseEpoch, version: 0 });
  const operationRef = useRef<DayVendorCommandOperation | null>(null);
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
    bindingRef.current = { db, uid: currentUid, identityKey, leaseEpoch, version: bindingRef.current.version + 1 };
  }
  const scopeKey = `${identityKey}:${leaseEpoch}:${bindingRef.current.version}`;
  const [pageState, setPageStateRaw] = useState<PageState>(() => initialPageState(scopeKey));
  const scopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const listRequestRef = useRef(0);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    listRequestRef.current += 1;
  }

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

  const isCurrent = useCallback((key: string, generation: number) => (
    scopeRef.current === key && generationRef.current === generation
  ), []);

  const ownsOperation = useCallback((operation: DayVendorCommandOperation): operation is DayVendorCommandOperation & {
    command: PreparedCommand;
    intent: CloudDayVendorCommandIntent;
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

  const revokeAuthorization = useCallback((key: string, generation: number, commandId: string | null, error: unknown) => {
    if (!isCurrent(key, generation)) return;

    // Invalidate all pending reads, writes, and receipt lookups before React commits.
    revokedScopeRef.current = authorizationScopeKey;
    generationRef.current += 1;
    listRequestRef.current += 1;
    const operation = operationRef.current;
    if (operation?.timerId !== null && operation?.timerId !== undefined) window.clearTimeout(operation.timerId);
    if (operation) {
      operation.completed = true;
      operation.command = null;
      operation.intent = null;
      operation.attemptPromise = null;
    }
    operationRef.current = null;
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
    confirmedOperation?: DayVendorCommandOperation,
  ) => {
    const key = scopeKey;
    const generation = generationRef.current;
    if (revokedScopeRef.current === authorizationScopeKey) return;
    const operation = confirmedOperation ?? operationRef.current;
    if (operation && !ownsOperation(operation)) return;
    if (confirmedReceipt && (!operation || operation.command.commandId !== confirmedReceipt.commandId)) return;
    const requestedDayId = operation?.viewDayId ?? targetDayId;
    const requestId = ++listRequestRef.current;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      // After a receipt the confirmed content stays on screen (locked) during the one re-read instead of a loading screen.
      refreshingSnapshot: confirmedReceipt ? previous.snapshot ?? previous.refreshingSnapshot : null,
      loading: true,
      loadError: '',
      actionError: operation?.receipt ? previous.actionError : '',
      notice: '',
      toast: '',
      ...(requestedDayId ? { dayIdDraft: requestedDayId } : {}),
    }));

    try {
      const snapshot = await repository.loadSnapshot(requestedDayId);
      if (!isCurrent(key, generation) || requestId !== listRequestRef.current) return;
      const currentOperation = operationRef.current;
      const boundOperation = operation ?? currentOperation;
      const resolvesOperation = confirmedReceipt
        && boundOperation === currentOperation
        && boundOperation?.command?.commandId === confirmedReceipt.commandId
        && boundOperation.receipt?.commandId === confirmedReceipt.commandId
        && ownsOperation(boundOperation);
      if (boundOperation && ownsOperation(boundOperation)
        && (snapshot.datasetId !== boundOperation.datasetId || snapshot.dayId !== boundOperation.viewDayId)) {
        const confirmed = !!boundOperation.receipt;
        updateFor(key, generation, previous => ({
          ...previous,
          ...clearFormDrafts(),
          snapshot: null,
          refreshingSnapshot: null,
          loading: false,
          loadError: '',
          actionError: confirmed
            ? '命令回執已確認，但伺服器資料集或營業日已變更；已確認狀態仍保留，請勿重送命令。'
            : '目前伺服器資料集或營業日已變更；原命令仍待確認，不能重試。',
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
      if (resolvesOperation && boundOperation) {
        const completedOperation: DayVendorCommandOperation = boundOperation;
        acceptedCommand = boundOperation.command;
        completedOperation.completed = true;
        if (completedOperation.timerId !== null) window.clearTimeout(completedOperation.timerId);
        completedOperation.command = null;
        completedOperation.intent = null;
        completedOperation.attemptPromise = null;
        operationRef.current = null;
        if (confirmedReceipt!.commandId === pendingCommandIdRef.current) pendingCommandIdRef.current = null;
      }
      updateFor(key, generation, previous => {
        const confirmsPending = !!resolvesOperation && !!confirmedReceipt;
        const confirmedCommand = confirmsPending ? acceptedCommand : null;
        return {
          ...previous,
          ...formDraftsFor(snapshot),
          snapshot,
          refreshingSnapshot: null,
          dayIdDraft: snapshot.dayId,
          loading: false,
          loadError: '',
          // A local cleanup problem is not part of the short toast: it stays visible until the next action.
          actionError: confirmsPending && boundOperation?.cleanupWarning ? boundOperation.cleanupWarning : '',
          recovery: confirmsPending ? null : previous.recovery,
          notice: '',
          toast: confirmsPending ? `已確認 ${confirmedCommand ? commandLabel(confirmedCommand) : '雲端操作'} 完成` : '',
        };
      });
      if (resolvesOperation && confirmedReceipt) onDraftCleared?.();
      if (resolvesOperation && confirmedReceipt?.kind === 'SetOpeningCash') onLedgerChangedRef.current?.();
    } catch (error) {
      if (!isCurrent(key, generation) || requestId !== listRequestRef.current) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, operation?.command.commandId ?? confirmedReceipt?.commandId ?? null, error);
        return;
      }
      updateFor(key, generation, previous => {
        const heldOperation = operationRef.current;
        const recovery = heldOperation && ownsOperation(heldOperation)
          ? {
            commandId: heldOperation.command.commandId,
            command: heldOperation.command,
            phase: heldOperation.receipt ? 'receipt' as const : 'unknown' as const,
            ...(heldOperation.receipt ? { receipt: heldOperation.receipt } : {}),
            canRetry: false,
          }
          : previous.recovery;
        return {
          ...previous,
          ...clearFormDrafts(),
          snapshot: null,
          refreshingSnapshot: null,
          loading: false,
          loadError: errorMessage(error),
          actionError: operation?.receipt
            ? '已找到命令回執，但伺服器資料尚未重新讀取；請只重新讀取資料，不要重送命令。'
            : heldOperation
              ? '目前無法安全重新讀取原營業日；原命令仍維持鎖定狀態。'
              : '',
          recovery,
          notice: '',
        };
      });
    }
  }, [authorizationScopeKey, isCurrent, onDraftCleared, operationRef, ownsOperation, repository, revokeAuthorization, scopeKey, updateFor]);

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
    if (!latched) void loadSnapshot();
    return () => {
      listRequestRef.current += 1;
      const operation = operationRef.current;
      if (operation?.generation === generation) {
        if (operation.timerId !== null) window.clearTimeout(operation.timerId);
        operation.completed = true;
        operation.command = null;
        operation.intent = null;
        operation.attemptPromise = null;
        operationRef.current = null;
      }
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

  const clearOperationTimer = (operation: DayVendorCommandOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
  };

  const showUnknownResult = (operation: DayVendorCommandOperation, message: string) => {
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

  const beginAttempt = (operation: DayVendorCommandOperation) => {
    clearOperationTimer(operation);
    operation.attempt += 1;
    operation.attemptPromise = null;
    operation.attemptSettled = false;
    operation.retryAuthorized = false;
    operation.querySequence += 1;
    operation.checking = false;
    const attempt = operation.attempt;
    operation.timerId = window.setTimeout(() => {
      if (!ownsOperation(operation) || operation.attempt !== attempt || operation.attemptSettled || operation.receipt) return;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        recovery: previous.recovery?.commandId === operation.command.commandId
          ? { ...previous.recovery, phase: 'submitting', timedOut: true, canRetry: false }
          : previous.recovery,
      }));
    }, 10_000);
  };

  const settleWithReceipt = async (operation: DayVendorCommandOperation, receipt: CommandReceipt) => {
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
      recovery: {
        commandId: command.commandId, command, phase: 'receipt', receipt,
        quiet: previous.recovery?.phase === 'submitting' && previous.recovery.timedOut !== true,
      },
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
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
        return;
      }
      operation.cleanupWarning = '本機命令追蹤清理未完成；伺服器回執仍已確認。';
    }
    if (ownsOperation(operation)) await loadSnapshot(operation.viewDayId, receipt, operation);
  };

  const finishCommandResult = async (operation: DayVendorCommandOperation, result: CommandResult, attempt: number) => {
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
      const completedOperation: DayVendorCommandOperation = operation;
      const failedCommand = completedOperation.command!;
      completedOperation.completed = true;
      operationRef.current = null;
      pendingCommandIdRef.current = null;
      completedOperation.command = null;
      completedOperation.intent = null;
      completedOperation.attemptPromise = null;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous, ...clearFormDrafts(), snapshot: null, loading: false,
        loadError: '操作未完成：' + errorMessage(result.error) + '請重新載入伺服器資料後繼續。',
        actionError: result.error.code === 'LOCAL_STORAGE_UNAVAILABLE' ? errorMessage(result.error)
          : failedCommand.kind === 'set-day-menu' && ['REVISION_CONFLICT', 'INVALID_INPUT'].includes(result.error.code)
            ? '本次菜單命令未成功，輸入與來源日期沒有自動改寫。請重新載入並確認最新菜單；若剛過午夜，請重新載入後再儲存。'
            : '',
        recovery: null, notice: '',
      }));
      return;
    }
    await settleWithReceipt(operation, result.receipt);
  };

  const runPreparedCommand = async (command: PreparedCommand, retryOperation?: DayVendorCommandOperation) => {
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
    } else {
      if (operationRef.current || page.recovery || !page.snapshot) return;
      const key = scopeKey;
      const generation = generationRef.current;
      if (revokedScopeRef.current === authorizationScopeKey) return;
      if (!identityKey || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1) {
        revokeAuthorization(key, generation, command.commandId, {
          code: 'LEASE_LOST', message: '目前沒有有效的登入，雲端資料已清除。請重新登入。',
        });
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
      const frozen = freezePreparedCommand(command);
      operation = {
        token: Symbol('cloud-day-vendor-operation'), identityKey: key, generation, db, app: db.app,
        uid, leaseEpoch, datasetId: page.snapshot.datasetId, viewDayId: page.snapshot.dayId,
        command: frozen, intent: freezeValue(intentFor(frozen, leaseEpoch)), attempt: 0,
        attemptPromise: null, attemptSettled: false,
        querySequence: 0, checking: false, retryAuthorized: false, receipt: null,
        completed: false, timerId: null, cleanupWarning: '',
      };
      operationRef.current = operation;
      pendingCommandIdRef.current = frozen.commandId;
      onNavigationStateChange?.(identityKey, 'recovering');
    }
    if (!ownsOperation(operation)) return;
    beginAttempt(operation);
    updateFor(operation.identityKey, operation.generation, previous => ({
      // The confirmed content stays on screen, locked, while the command is in flight (#585); it is display only.
      ...previous, snapshot: null, refreshingSnapshot: previous.snapshot ?? previous.refreshingSnapshot,
      loading: false, loadError: '', actionError: '', notice: '', toast: '',
      recovery: {
        commandId: operation!.command.commandId, command: operation!.command,
        phase: 'submitting', timedOut: false, canRetry: false,
      },
    }));
    const attempt = operation.attempt;
    const attemptPromise = repository.commitDayVendorIntent(operation.intent);
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
          ...previous, ...clearFormDrafts(), snapshot: null, loading: false, loadError: '',
          actionError: '目前伺服器資料集已變更；原操作尚未確認，請聯絡維護者，不可重試。',
          recovery: { commandId: command.commandId, command, phase: 'unknown', canRetry: false },
        }));
        return;
      }
      const mayRetry = settledAtStart && operation.attemptSettled && operation.attemptPromise === null;
      operation.retryAuthorized = mayRetry;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous, snapshot: null, loading: false, loadError: '',
        actionError: mayRetry
          ? '伺服器目前尚未找到這筆命令。沒有產生新的命令編號；確認後可明確選擇同編號重試。'
          : settledAtStart
            ? '原命令狀態在查詢期間改變；這次查詢不能授權重試。請重新查詢原命令。'
            : operation.attemptSettled
              ? '這次查詢開始時原命令仍在送出中；未找到結果不能授權重試。請在原命令結束後重新查詢。'
              : '查詢尚未找到回執，但原命令仍在送出中；目前不能重試。請等待原命令結束後再查詢。',
        recovery: {
          commandId: command.commandId, command,
          phase: operation.attemptSettled ? 'unknown' : 'submitting', timedOut: !operation.attemptSettled,
          canRetry: operation.retryAuthorized,
        },
      }));
    } catch (error) {
      if (!ownsOperation(operation) || operation.querySequence !== querySequence || operation.receipt) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
        return;
      }
      operation.retryAuthorized = false;
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
          phase: operation.attemptSettled ? 'unknown' : 'submitting',
          timedOut: !operation.attemptSettled, canRetry: false,
        },
      }));
    } finally {
      if (operationRef.current === operation && operation.querySequence === querySequence) operation.checking = false;
    }
  };

  const retryPendingCommand = (operation: DayVendorCommandOperation) => {
    if (!ownsOperation(operation)) return;
    void runPreparedCommand(operation.command, operation);
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

  // 改日期即載入（#651）：完整合法日期（≥ 系統啟用日）才讀取；鍵盤逐字輸入時等 Enter 或離開欄位才確認（由 DateField 處理）。
  // 只採用最後一次讀取的結果由 loadSnapshot 的 listRequestRef 保證。
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const hasUnsentDraft = (current: CloudDayVendorSnapshot): boolean => {
    const baseline = formDraftsFor(current);
    const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
    return (page.createVendorOpen && !sameJson(page.vendorDraft, freshVendorDraft()))
      || page.editingVendorId !== null
      || page.removingVendorId !== null
      || page.removeReason !== ''
      || page.openingReasonText !== ''
      || page.openingCashText !== baseline.openingCashText
      || !sameJson(page.menuDraft, baseline.menuDraft);
  };
  const requestDateLoad = (value: string) => {
    const current = page.snapshot;
    if (page.recovery || !current) return;
    if (!isBusinessDate(value) || value < current.goLiveDate) {
      updatePage(previous => ({ ...previous, actionError: `營業日必須是 ${current.goLiveDate} 或之後的有效日期。` }));
      return;
    }
    if (value === current.dayId) return;
    if (hasUnsentDraft(current)) {
      setPendingDate(value);
      return;
    }
    void loadSnapshot(value);
  };
  const onDateChange = (value: string) => {
    updatePage(previous => ({ ...previous, dayIdDraft: value, actionError: '' }));
  };
  const cancelPendingDate = () => {
    setPendingDate(null);
    updatePage(previous => ({ ...previous, dayIdDraft: previous.snapshot?.dayId ?? previous.dayIdDraft }));
  };
  const confirmPendingDate = () => {
    const target = pendingDate;
    setPendingDate(null);
    if (target) void loadSnapshot(target);
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
    actionError: '',
  }));

  const submitMenu = (draft: CloudDayMenuDraft) => {
    const snapshot = page.snapshot;
    const day = snapshot?.day;
    if (!snapshot || !day || page.recovery) return;
    if (day.status === 'closed') {
      updatePage(previous => ({ ...previous, actionError: '營業日已關閉，不能修改菜單。請重新載入確認最新狀態。' }));
      return;
    }

    if (draft.itemName.length < 1 || draft.itemName.length > 100) {
      updatePage(previous => ({ ...previous, actionError: '菜單名稱必須為 1 至 100 個字元。' }));
      return;
    }
    if (!/^\d+$/.test(draft.priceText)) {
      updatePage(previous => ({ ...previous, actionError: '菜單價格必須明確輸入 1 至 1,000,000 元的整數。' }));
      return;
    }
    const price = Number(draft.priceText);
    if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000 || Object.is(price, -0)) {
      updatePage(previous => ({ ...previous, actionError: '菜單價格必須是 1 至 1,000,000 元的整數。' }));
      return;
    }
    const vendor = snapshot.vendors.find(item => item.vendorId === draft.vendorId);
    if (!vendor || vendor.status !== 'active' || vendor.deleted) {
      updatePage(previous => ({ ...previous, actionError: '請選擇仍在使用中的供應商。' }));
      return;
    }

    const commandId = makePreparedCommandId();
    if (!commandId) return;
    const input: Omit<SetDayMenuInput, 'commandId' | 'leaseEpoch'> = {
      dayId: snapshot.dayId,
      selectionDate: snapshot.selectionDate,
      expectedRevision: day.revision,
      expectedHeadSeq: snapshot.seq,
      itemName: draft.itemName,
      price,
      vendorId: vendor.vendorId,
      vendorNameSnapshot: vendor.name,
      // The menu is always a direct set; copying last week's menu only fills this form.
      inheritedFromDate: null,
    };
    void runPreparedCommand({ kind: 'set-day-menu', commandId, ...input });
  };

  const submitOpeningCash = (amountText: string) => {
    const snapshot = page.snapshot;
    const day = snapshot?.day;
    if (!snapshot || !day || page.recovery) return;
    if (snapshot.dayId !== snapshot.selectionDate || snapshot.selectionDate < snapshot.goLiveDate) {
      updatePage(previous => ({ ...previous, actionError: '開帳現金只能設定今天的營業日；若剛過午夜，請重新載入後再試。' }));
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

  // Quiet feedback (#585): a command in flight (before ten seconds) and the re-read after its receipt are shown only by the
  // progress bar and the locked page. The recovery panel appears for everything that needs the operator (ten seconds and later,
  // a read that failed, an access change).
  const recovery = page.recovery;
  const quietSubmitting = recovery?.phase === 'submitting' && !recovery.timedOut;
  const quietReceipt = recovery?.phase === 'receipt' && recovery.quiet === true && !page.loadError
    && (page.loading || page.snapshot !== null || page.refreshingSnapshot !== null);
  const showRecoveryPanel = recovery !== null && !quietSubmitting && !quietReceipt;
  const progressActive = page.loading || quietSubmitting || quietReceipt
    || recovery?.phase === 'checking' || (recovery?.phase === 'submitting' && recovery.timedOut === true);
  // Display only (#585): the confirmed content from before the command stays on screen, locked (`inert`), while the command is in
  // flight or its receipt is re-read. Never kept once the authorization is revoked or the read failed; no command is built from it.
  const snapshot = page.snapshot
    ?? (!page.authorizationRevoked && !page.loadError && (quietSubmitting || quietReceipt)
      ? page.refreshingSnapshot
      : null);
  const showingStale = page.snapshot === null && snapshot !== null;
  const busy = page.recovery !== null || showingStale;
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
  return (
    <main className="cloud-day-vendors" aria-label="雲端日期設定與供應商管理" aria-busy={busy || page.loading}>
      <CommandProgress active={progressActive} />
      <header className="cloud-day-vendors__header">
        <div className="cloud-day-vendors__title-row">
          <h1>{view === 'vendors' ? '供應商' : view === 'day' ? '菜單與開帳' : '營業日、菜單與供應商'}</h1>
          <HelpTip label="資料與歷史說明">
            日期與供應商資料都從伺服器完整載入。{'\n'}未確認開帳與零元開帳分開顯示。{'\n'}菜單與供應商的變更不會改寫已存的歷史快照。
          </HelpTip>
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
      <DataUpdatedNotice
        pageSeq={snapshot?.seq ?? null}
        hidden={progressActive || busy}
        onReload={() => void loadSnapshot((snapshot?.dayId ?? page.dayIdDraft) || undefined, page.recovery?.phase === 'receipt' ? page.recovery.receipt : undefined)}
      />

      {page.loadError && <div className="cloud-day-vendors__alert" role="alert">{page.loadError}</div>}
      {page.actionError && <div className="cloud-day-vendors__alert" role="alert">{page.actionError}</div>}
      {page.authorizationRevoked && (
        <div className="cloud-day-vendors__notice" role="status">
          登入狀態已失效。資料與操作草稿已清除；請重新登入。
        </div>
      )}
      {page.notice && <div className="cloud-day-vendors__notice" role="status">{page.notice}</div>}
      <Toast message={page.toast} />

      {showRecoveryPanel && page.recovery && (
        <section className="cloud-day-vendors__recovery" aria-label="命令結果確認" role="alert">
          <strong>{page.recovery.phase === 'receipt'
            ? '已找到伺服器回執，資料尚待再次讀取。'
            : page.recovery.phase === 'access-lost'
              ? '其他人已登入或登入已失效；操作內容已清除。'
              : page.recovery.phase === 'checking'
                ? '正在查詢原命令結果…'
                : page.recovery.phase === 'submitting' && page.recovery.timedOut
                  ? '結果確認中，勿重新收款'
                : page.recovery.phase === 'submitting'
                  ? '命令送出中，請勿重複操作。'
                  : '結果確認中，請勿重複操作。'}</strong>
          <span>{page.recovery.command ? `${commandLabel(page.recovery.command)} · 命令編號 ${page.recovery.commandId}` : `命令編號 ${page.recovery.commandId}`}</span>
          {page.recovery.phase === 'access-lost' && <span>只保留命令編號；請先重新登入，再依現場流程核對。</span>}
          <div className="cloud-day-vendors__actions">
            {page.recovery.command && page.recovery.phase !== 'checking' && page.recovery.phase !== 'receipt'
              && (page.recovery.phase !== 'submitting' || page.recovery.timedOut) && (
              <button type="button" className="cloud-day-vendors__primary" onClick={() => void checkPendingCommand()}>
                查詢原命令結果
              </button>
            )}
            {page.recovery.canRetry && page.recovery.command && operationRef.current && (
              <button type="button" className="cloud-day-vendors__secondary" onClick={() => retryPendingCommand(operationRef.current!)}>
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

      {page.loading && !showingStale && <div className="cloud-day-vendors__loading" role="status">正在從伺服器載入完整營業日與供應商資料…</div>}

      {snapshot && (!page.loading || showingStale) && (
        <div className="cloud-day-vendors__content" data-testid="cloud-day-vendors-content" inert={showingStale || undefined}>
          {view !== 'vendors' && <><DateField
            id="cloud-day-vendors-date"
            variant="date"
            min={snapshot.goLiveDate}
            value={page.dayIdDraft || snapshot.dayId}
            onChange={onDateChange}
            onConfirm={requestDateLoad}
            disabled={busy}
            help={'改日期後會直接載入該日資料；有尚未送出的內容時會先詢問。'}
            status={<>
              {snapshot.day
                ? <StatusBadge variant={dayStatusVariant(snapshot.day.status)} className={`cloud-day-vendors__day-status cloud-day-vendors__day-status--${snapshot.day.status}`}>{dayStatusLabel(snapshot.day.status)}</StatusBadge>
                : <StatusBadge variant="neutral">尚未建立</StatusBadge>}
              {snapshot.dayId === snapshot.selectionDate ? '今天' : snapshot.dayId < snapshot.selectionDate ? '過去日期' : '未來日期'}
            </>}
          />

          <section className="cloud-day-vendors__day-section" aria-label="指定營業日">
            <div className="cloud-day-vendors__section-heading">
              <div>
                <h2>{formatBusinessDate(snapshot.dayId)} 營業日</h2>
                {!snapshot.day && <p>伺服器尚無此日期文件；建立日期只建立空白營業日，不會建立菜單或開帳金額。</p>}
              </div>
              {!snapshot.day && (
                <button type="button" className="cloud-day-vendors__primary" onClick={submitEnsureDay} disabled={busy || snapshot.dayId < snapshot.goLiveDate}>
                  建立空白營業日
                </button>
              )}
            </div>
            {snapshot.day?.status === 'closed' && <Callout variant="warn">此日期已關帳，不能修改菜單與開帳金額。要修改請先到「日結」頁填寫原因重開。</Callout>}

            {snapshot.day && (
              <>
                <div className="cloud-day-vendors__panels">
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
                      ) : <EmptyState className="cloud-day-vendors__no-menu" title="此日期尚未設定菜單。" />}
                    </div>
                  </div>

                  <CloudDayMenuForm
                    businessDate={snapshot.dayId}
                    value={page.menuDraft}
                    vendors={activeVendors.map(vendor => ({ vendorId: vendor.vendorId, name: vendor.name }))}
                    onChange={updateMenuDraft}
                    onSubmit={submitMenu}
                    disabled={busy || !canMutateDay}
                    loadLastWeekMenus={() => repository.readLastWeekMenus(snapshot.dayId, snapshot.vendors)}
                  />
                </section>

                <section className="cloud-day-vendors__card" aria-label="開帳現金設定">
                  <div className="cloud-day-vendors__section-heading">
                    <div>
                      <h3>開帳現金</h3>
                      {snapshot.day.openedAt && (
                        <p>首次開帳人：{snapshot.day.openedBy === null ? '未知' : operatorDisplayLabel(snapshot.day.openedBy, operatorSelf)} · 首次確認時間（臺北）：{formatServerTime(snapshot.day.openedAt)}</p>
                      )}
                    </div>
                  </div>
                  {snapshot.dayId !== snapshot.selectionDate && (
                    <Callout variant="warn">開帳僅限今天（{snapshot.selectionDate}）。此日期可預排菜單，但不能預先開帳。</Callout>
                  )}
                  {snapshot.dayId === snapshot.selectionDate && snapshot.selectionDate < snapshot.goLiveDate && (
                    <Callout variant="warn">今天早於系統啟用日，尚不能設定開帳現金。</Callout>
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
                    <Callout variant="warn">此日期已關帳，不能修改開帳現金。</Callout>
                  ) : null}
                </section>
                </div>
              </>
            )}
          </section>

          </>}
          {view !== 'day' && <section className="cloud-day-vendors__vendor-section" aria-label="供應商管理">
            <div className="cloud-day-vendors__section-heading">
              <div>
                <div className="cloud-day-vendors__title-row">
                  <h2>供應商</h2>
                  <HelpTip label="供應商說明">
                    停用的供應商可以恢復；移除後不能恢復，編號也不會再使用。{'\n'}停用或移除都不會改到已存的菜單與交易。{'\n'}建立、編輯、停用、恢復與移除，每次都是一筆一筆送到伺服器確認。
                  </HelpTip>
                </div>
                <p>{snapshot.vendors.length} 家供應商</p>
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
              <div className="cloud-day-vendors__empty-state" role="status">
                <EmptyState className="cloud-day-vendors__empty" title="目前伺服器沒有可管理的供應商，請新增一筆供應商資料。" />
              </div>
            ) : (
              <div className="cloud-day-vendors__table-wrap">
                <table className="dt">
                  <thead><tr><th>編號</th><th>名稱</th><th>電話</th><th>備註</th><th>狀態</th><th>操作</th></tr></thead>
                  <tbody>
                    {snapshot.vendors.map(vendor => (
                      <tr key={vendor.vendorId} data-testid={`cloud-vendor-row-${vendor.vendorId}`}>
                        <td className="cloud-day-vendors__mono">{vendor.vendorId}</td>
                        <td>{vendor.name}</td>
                        <td className="cloud-day-vendors__phone">{vendor.phone || '—'}</td>
                        <td>{vendor.note || '—'}</td>
                        <td><StatusBadge variant={vendor.status === 'active' ? 'ok' : 'neutral'} className={`cloud-day-vendors__status cloud-day-vendors__status--${vendor.status}`}>{vendor.status === 'active' ? '使用中' : '已停用'}</StatusBadge></td>
                        <td>
                          <div className="cloud-day-vendors__row-actions">
                            {page.removingVendorId === vendor.vendorId ? (
                              <form className="cloud-day-vendors__remove-form" aria-label={`移除供應商 ${vendor.vendorId}`} onSubmit={event => submitVendorRemoval(event, vendor)}>
                                <Callout variant="warn">移除後不能恢復，編號也不會再使用。</Callout>
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
          </section>}
        </div>
      )}

      <ConfirmDialog
        open={pendingDate !== null}
        title="捨棄草稿？"
        message="菜單、開帳現金或供應商欄位還有尚未送出的內容，改日期會清除它們。"
        confirmLabel="捨棄並載入"
        cancelLabel="取消"
        variant="danger"
        defaultAction="cancel"
        onConfirm={confirmPendingDate}
        onCancel={cancelPendingDate}
      />

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
