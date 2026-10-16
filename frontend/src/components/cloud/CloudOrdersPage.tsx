import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandResult } from '../../domain/cloudCommands';
import { normalizeStudentCode } from '../../domain/student';
import {
  createCloudOrderRepository,
  type CloudOrderSnapshot,
  type CloudOrderTransactionRecord,
  type CreateCloudOrderInput,
} from '../../firebase/cloudOrderRepository';
import type { CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import { formatTaipeiTime } from '../../utils/dateTime';
import './CloudOrdersPage.css';

export interface CloudOrdersPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
}

/** Frozen order command: commandId and transactionId never change while its result is unresolved. */
type PreparedOrder = Omit<CreateCloudOrderInput, 'leaseEpoch'> & { label: string; datasetId: string };

type RecoveryPhase = 'submitting' | 'unknown' | 'checking';

interface PendingRecord {
  uid: string;
  datasetId: string;
  commandId: string;
}

interface OrdersPageState {
  scopeKey: string;
  authorizationRevoked: boolean;
  snapshot: CloudOrderSnapshot | null;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  search: string;
  selectedStudentId: string | null;
  mealKind: 'bento' | 'other';
  otherItemName: string;
  otherPriceText: string;
  paidAmountText: string;
  note: string;
  confirmDuplicateOpen: boolean;
  paymentDetailsOpen: boolean;
  recovery: { command: PreparedOrder; phase: RecoveryPhase } | null;
  /** An unresolved command left by an earlier page load (refresh or closed tab). */
  storedPending: (PendingRecord & { checking: boolean; message: string }) | null;
}

const PENDING_STORAGE_KEY = 'easyorder-cloud-pending-order';

const freshDraft = () => ({
  search: '',
  selectedStudentId: null,
  mealKind: 'bento' as const,
  otherItemName: '',
  otherPriceText: '',
  paidAmountText: '',
  note: '',
  confirmDuplicateOpen: false,
  paymentDetailsOpen: false,
});

function initialState(scopeKey: string): OrdersPageState {
  return {
    scopeKey,
    authorizationRevoked: false,
    snapshot: null,
    loading: true,
    loadError: '',
    actionError: '',
    notice: '',
    ...freshDraft(),
    recovery: null,
    storedPending: null,
  };
}

function readPending(): PendingRecord | null {
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingRecord>;
    if (typeof value.uid !== 'string' || typeof value.datasetId !== 'string' || typeof value.commandId !== 'string') return null;
    return { uid: value.uid, datasetId: value.datasetId, commandId: value.commandId };
  } catch {
    return null;
  }
}

/** Only commandId, datasetId and UID are kept (spec §8): no names, amounts or other business data. */
function writePending(record: PendingRecord | null): void {
  try {
    if (record) window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(record));
    else window.localStorage.removeItem(PENDING_STORAGE_KEY);
  } catch {
    // Storage is a convenience for post-refresh lookup; the in-memory recovery panel still holds the command.
  }
}

function clearPendingIf(commandId: string): void {
  if (readPending()?.commandId === commandId) writePending(null);
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
}

function errorText(error: unknown): string {
  const code = errorCode(error);
  if (code === 'OFFLINE') return '目前無法連線到雲端，沒有顯示本機或不完整資料。請恢復連線後重新載入。';
  if (code === 'LEASE_LOST' || code === 'ACCESS_BUSY') return '目前使用權已變更，訂餐資料已清除。請重新確認使用權。';
  if (code === 'UNAUTHORIZED') return '目前帳號沒有雲端訂餐資料存取權，資料已清除。請重新登入確認權限。';
  if (code === 'QUOTA_EXCEEDED') return '雲端讀取額度不足，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'MAINTENANCE') return '系統正在維護，暫停訂餐。請稍後重新載入。';
  if (code === 'STALE_SNAPSHOT') return '載入期間伺服器資料有變動，沒有顯示部分資料。請重新載入。';
  if (code === 'INCOMPLETE_SNAPSHOT' || code === 'RECONCILIATION_FAILED' || code === 'UNSUPPORTED_SCHEMA') {
    const message = error instanceof Error ? error.message : '';
    return `伺服器資料無法安全顯示，沒有顯示份數或金額。${message ? `（${message}）` : ''}請聯絡系統維護者。`;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return '雲端訂餐資料無法讀取。請重新載入。';
}

function isAuthorizationLoss(error: unknown): boolean {
  return ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY'].includes(errorCode(error));
}

function definiteFailureText(code: string, message: string): string {
  if (code === 'REVISION_CONFLICT') return '伺服器上的學生、菜單或營業日已變更，這筆沒有入帳。已重新讀取最新資料，請確認金額後再登記。';
  if (code === 'DAY_CLOSED') return '今日已關帳，這筆沒有入帳。';
  if (code === 'MAINTENANCE') return '系統正在維護，這筆沒有入帳。';
  if (code === 'QUOTA_EXCEEDED') return '雲端額度不足，這筆沒有入帳。';
  return `這筆沒有入帳：${message || '伺服器拒絕了這筆命令'}`;
}

/** Strict non-negative integer text: rejects 1e3, 1.5, -1 and anything parseInt would silently truncate. */
function parseAmount(text: string, emptyAs: number | null): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return emptyAs;
  if (!/^\d{1,7}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 1_000_000 ? value : null;
}

function newId(): string | null {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

function uidFromIdentity(identityKey: string): string {
  const index = identityKey.lastIndexOf(':');
  return index > 0 ? identityKey.slice(0, index) : identityKey;
}

function itemLabel(tx: CloudOrderTransactionRecord): string {
  if (tx.type === 'payment') return '繳費';
  if (tx.mealKind === 'bento') return `今日餐點：${tx.menuNameSnapshot}`;
  return `其他餐點：${tx.otherItemName ?? ''}`;
}

function recentSummary(transactions: CloudOrderTransactionRecord[]): string {
  const bento = transactions.filter(tx => tx.type === 'order' && tx.mealKind === 'bento').length;
  const other = transactions.filter(tx => tx.type === 'order' && tx.mealKind === 'other').length;
  if (bento > 0 && other > 0) return `今日餐點 ${bento}・其他餐點 ${other}`;
  if (bento > 0) return `今日餐點 ${bento}`;
  if (other > 0) return `其他餐點 ${other}`;
  return '僅繳費';
}

export function CloudOrdersPage({ db, leaseEpoch, identityKey, onNavigationStateChange }: CloudOrdersPageProps) {
  const repository = useMemo(() => createCloudOrderRepository(db), [db]);
  const scopeKey = `${identityKey}:${leaseEpoch}`;
  const [pageState, setPageStateRaw] = useState<OrdersPageState>(() => initialState(scopeKey));
  const scopeRef = useRef(scopeKey);
  const generationRef = useRef(0);
  const loadRequestRef = useRef(0);
  const flightRef = useRef(false);
  const revokedRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    loadRequestRef.current += 1;
    flightRef.current = false;
    revokedRef.current = false;
  }

  const page = pageState.scopeKey === scopeKey ? pageState : initialState(scopeKey);

  const isCurrent = useCallback((key: string, generation: number) => (
    scopeRef.current === key && generationRef.current === generation
  ), []);

  const updateFor = useCallback((key: string, generation: number, update: (previous: OrdersPageState) => OrdersPageState) => {
    setPageStateRaw(previous => {
      if (!isCurrent(key, generation)) return previous;
      return update(previous.scopeKey === key ? previous : initialState(key));
    });
  }, [isCurrent]);

  const revoke = useCallback((key: string, generation: number, error: unknown, pendingCommandId: string | null) => {
    if (!isCurrent(key, generation)) return;
    // Invalidate every in-flight read and command before React commits the masked state.
    revokedRef.current = true;
    generationRef.current += 1;
    loadRequestRef.current += 1;
    flightRef.current = false;
    onNavigationStateChange?.(identityKey, 'revoked');
    setPageStateRaw(previous => {
      if (previous.scopeKey !== key) return previous;
      return {
        ...initialState(key),
        authorizationRevoked: true,
        loading: false,
        loadError: errorText(error),
        actionError: pendingCommandId
          ? `命令 ${pendingCommandId} 的結果尚未確認，勿重新收款。重新取得使用權後會用同一編號查詢。`
          : '',
      };
    });
  }, [identityKey, isCurrent, onNavigationStateChange]);

  const checkStoredPending = useCallback(async (key: string, generation: number, record: PendingRecord) => {
    updateFor(key, generation, previous => ({
      ...previous,
      storedPending: { ...record, checking: true, message: '' },
    }));
    try {
      const receipt = await repository.readCommand(record.commandId);
      if (!isCurrent(key, generation)) return;
      if (receipt) {
        clearPendingIf(record.commandId);
        updateFor(key, generation, previous => ({
          ...previous,
          storedPending: null,
          notice: `上次未確認的訂餐已確認入帳（命令序號 ${receipt.seq}），下方資料已包含這筆，勿重複登記。`,
        }));
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        storedPending: {
          ...record,
          checking: false,
          message: '伺服器目前沒有這筆命令。若當時沒有收到現金，可清除提醒後重新登記；若不確定，請稍後再查一次。',
        },
      }));
    } catch (error) {
      if (!isCurrent(key, generation)) return;
      if (isAuthorizationLoss(error)) {
        revoke(key, generation, error, record.commandId);
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        storedPending: { ...record, checking: false, message: `目前無法查詢結果：${errorText(error)}` },
      }));
    }
  }, [isCurrent, repository, revoke, updateFor]);

  const loadSnapshot = useCallback(async (options: { keepDraft?: boolean; notice?: string; actionError?: string } = {}) => {
    const key = scopeKey;
    const generation = generationRef.current;
    if (revokedRef.current) return;
    const requestId = ++loadRequestRef.current;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: true,
      loadError: '',
      ...(options.keepDraft ? {} : freshDraft()),
      confirmDuplicateOpen: false,
      paymentDetailsOpen: false,
      notice: options.notice ?? '',
      actionError: options.actionError ?? '',
    }));
    try {
      const snapshot = await repository.loadSnapshot();
      if (!isCurrent(key, generation) || requestId !== loadRequestRef.current) return;
      updateFor(key, generation, previous => ({
        ...previous,
        snapshot,
        loading: false,
        loadError: '',
        selectedStudentId: snapshot.students.some(student => student.studentId === previous.selectedStudentId)
          ? previous.selectedStudentId
          : null,
      }));
      const stored = readPending();
      if (stored && stored.uid === uidFromIdentity(identityKey) && stored.datasetId === snapshot.datasetId) {
        void checkStoredPending(key, generation, stored);
      }
    } catch (error) {
      if (!isCurrent(key, generation) || requestId !== loadRequestRef.current) return;
      if (isAuthorizationLoss(error)) {
        revoke(key, generation, error, null);
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        ...freshDraft(),
        snapshot: null,
        loading: false,
        loadError: errorText(error),
      }));
    }
  }, [checkStoredPending, identityKey, isCurrent, repository, revoke, scopeKey, updateFor]);

  useEffect(() => {
    const generation = ++generationRef.current;
    revokedRef.current = false;
    setPageStateRaw(initialState(scopeKey));
    if (!identityKey) {
      onNavigationStateChange?.(identityKey, 'revoked');
      return;
    }
    void loadSnapshot();
    return () => {
      loadRequestRef.current += 1;
      if (generationRef.current === generation) generationRef.current += 1;
    };
    // loadSnapshot is stable per scope; re-run only when the identity/lease scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const hasRecovery = page.recovery !== null;
  useEffect(() => {
    if (!identityKey) return;
    onNavigationStateChange?.(identityKey, page.authorizationRevoked ? 'revoked' : hasRecovery ? 'recovering' : 'resolved');
  }, [hasRecovery, identityKey, onNavigationStateChange, page.authorizationRevoked]);

  const snapshot = page.snapshot;
  const today = snapshot?.today ?? '';
  const day = snapshot?.day ?? null;
  const todayMenu = day?.menu ?? null;
  const activeTransactions = useMemo(
    () => (snapshot?.transactions ?? []).filter(tx => tx.status === 'active'),
    [snapshot],
  );
  const studentsById = useMemo(
    () => new Map((snapshot?.students ?? []).map(student => [student.studentId, student])),
    [snapshot],
  );
  const selectedStudent = page.selectedStudentId ? studentsById.get(page.selectedStudentId) ?? null : null;
  const selectedTransactions = useMemo(
    () => activeTransactions.filter(tx => tx.studentId === page.selectedStudentId),
    [activeTransactions, page.selectedStudentId],
  );
  const selectedOrderCount = selectedTransactions.filter(tx => tx.type === 'order').length;

  const filteredStudents = useMemo(() => {
    const q = page.search.trim().toLowerCase();
    if (!q || !snapshot) return [];
    const norm = normalizeStudentCode(q);
    const normCode = norm.ok ? norm.code : '';
    return snapshot.students.filter(student =>
      (normCode && student.studentCode === normCode)
      || student.studentCode.includes(q)
      || student.displayName.toLowerCase().includes(q)
      || student.aliases.some(alias => alias.toLowerCase().includes(q)));
  }, [page.search, snapshot]);

  const recentAccounts = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ student: CloudStudentRecord; summary: string }> = [];
    for (let index = activeTransactions.length - 1; index >= 0; index -= 1) {
      const studentId = activeTransactions[index].studentId;
      if (seen.has(studentId)) continue;
      seen.add(studentId);
      const student = studentsById.get(studentId);
      if (!student) continue;
      items.push({ student, summary: recentSummary(activeTransactions.filter(tx => tx.studentId === studentId)) });
    }
    return items;
  }, [activeTransactions, studentsById]);

  const orderingBlocked = !snapshot ? '雲端資料尚未載入'
    : today < snapshot.goLiveDate ? `伺服器營業日 ${today} 早於系統啟用日期 ${snapshot.goLiveDate}，不能訂餐`
      : !day ? `今日（${today}）營業日尚未建立，請先到「日期與供應商」建立營業日`
        : day.status === 'closed' ? '今日已關帳，不能新增餐點'
          : '';

  const mealPrice = page.mealKind === 'bento' ? todayMenu?.price ?? null : parseAmount(page.otherPriceText, null);
  const paidAmount = parseAmount(page.paidAmountText, 0);
  const busy = page.recovery !== null;
  const previewBalance = selectedStudent && mealPrice !== null && paidAmount !== null
    ? selectedStudent.currentBalance + paidAmount - mealPrice
    : null;

  const selectStudent = (student: CloudStudentRecord) => {
    setPageStateRaw(previous => ({ ...previous, selectedStudentId: student.studentId, search: '', actionError: '', notice: '' }));
  };

  const cancelSelection = useCallback(() => {
    if (pageState.recovery) return;
    setPageStateRaw(previous => ({ ...previous, ...freshDraft(), actionError: '' }));
    searchInputRef.current?.focus();
  }, [pageState.recovery]);

  const finishResult = async (command: PreparedOrder, result: CommandResult, key: string, generation: number) => {
    if (!isCurrent(key, generation)) return;
    if (result.ok && result.receipt.commandId === command.commandId) {
      clearPendingIf(command.commandId);
      updateFor(key, generation, previous => ({ ...previous, recovery: null }));
      await loadSnapshot({ notice: `已確認 ${command.label} 訂餐完成（命令序號 ${result.receipt.seq}）` });
      return;
    }
    if (!result.ok && isAuthorizationLoss(result.error)) {
      revoke(key, generation, result.error, command.commandId);
      return;
    }
    if (result.ok || result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
      updateFor(key, generation, previous => ({
        ...previous,
        confirmDuplicateOpen: false,
        recovery: { command, phase: 'unknown' },
      }));
      return;
    }
    // A definite rejection: nothing was committed. Re-read the server so the next attempt sees fresh revisions.
    clearPendingIf(command.commandId);
    updateFor(key, generation, previous => ({ ...previous, recovery: null }));
    await loadSnapshot({ keepDraft: true, actionError: definiteFailureText(result.error.code, result.error.message) });
  };

  const dispatch = async (command: PreparedOrder, phase: RecoveryPhase) => {
    const key = scopeKey;
    const generation = generationRef.current;
    if (flightRef.current || revokedRef.current) return;
    if (!identityKey || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1) {
      revoke(key, generation, { code: 'LEASE_LOST' }, command.commandId);
      return;
    }
    flightRef.current = true;
    updateFor(key, generation, previous => ({
      ...previous,
      actionError: '',
      notice: '',
      confirmDuplicateOpen: false,
      recovery: { command, phase },
    }));
    let result: CommandResult;
    try {
      result = await repository.createOrder({
        commandId: command.commandId,
        transactionId: command.transactionId,
        leaseEpoch,
        studentId: command.studentId,
        dayId: command.dayId,
        expectedStudentRevision: command.expectedStudentRevision,
        expectedDayRevision: command.expectedDayRevision,
        mealKind: command.mealKind,
        mealPrice: command.mealPrice,
        paidAmount: command.paidAmount,
        menuRevision: command.menuRevision,
        otherItemName: command.otherItemName,
        note: command.note,
      });
    } catch (error) {
      result = { ok: false, error: { code: isAuthorizationLoss(error) ? 'LEASE_LOST' : 'UNKNOWN_RESULT', message: errorText(error) } };
    } finally {
      if (isCurrent(key, generation)) flightRef.current = false;
    }
    await finishResult(command, result, key, generation);
  };

  const submitOrder = () => {
    if (!snapshot || !day || !selectedStudent || busy || orderingBlocked) return;
    if (selectedStudent.status !== 'active') {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '此帳戶已停用，禁止新增餐點' }));
      return;
    }
    if (page.mealKind === 'bento' && !todayMenu) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '今日尚未設定菜單，無法訂購今日餐點' }));
      return;
    }
    const otherItemName = page.otherItemName.trim();
    if (page.mealKind === 'other' && (!otherItemName || otherItemName.length > 100)) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '其他餐點品名必填且不能超過 100 字' }));
      return;
    }
    if (mealPrice === null) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '餐點單價必須是 0 到 1,000,000 的整數' }));
      return;
    }
    if (paidAmount === null) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '實收金額必須是 0 到 1,000,000 的整數' }));
      return;
    }
    const commandId = newId();
    const transactionId = newId();
    if (!commandId || !transactionId) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '此瀏覽器無法產生安全的命令編號，未送出。' }));
      return;
    }
    const command: PreparedOrder = {
      commandId,
      transactionId,
      studentId: selectedStudent.studentId,
      dayId: today,
      expectedStudentRevision: selectedStudent.revision,
      expectedDayRevision: day.revision,
      mealKind: page.mealKind,
      mealPrice,
      paidAmount,
      menuRevision: page.mealKind === 'bento' ? todayMenu!.revision : null,
      otherItemName: page.mealKind === 'other' ? otherItemName : null,
      note: page.note.trim(),
      label: `${selectedStudent.studentCode} ${selectedStudent.displayName}`,
      datasetId: snapshot.datasetId,
    };
    writePending({ uid: uidFromIdentity(identityKey), datasetId: snapshot.datasetId, commandId });
    void dispatch(command, 'submitting');
  };

  const requestSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!selectedStudent || busy) return;
    if (selectedOrderCount > 0) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: true }));
      return;
    }
    submitOrder();
  };

  const retryRecovery = () => {
    const recovery = page.recovery;
    if (!recovery || recovery.phase !== 'unknown') return;
    // Re-sending the frozen command is idempotent: the repository returns the stored receipt when it exists.
    void dispatch(recovery.command, 'checking');
  };

  const dismissStoredPending = () => {
    if (page.storedPending) clearPendingIf(page.storedPending.commandId);
    setPageStateRaw(previous => ({ ...previous, storedPending: null }));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pageState.recovery) return;
      if (pageState.confirmDuplicateOpen || pageState.paymentDetailsOpen) {
        if (event.key === 'Escape') {
          setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, paymentDetailsOpen: false }));
        }
        return;
      }
      const tag = document.activeElement?.tagName.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelSelection();
        return;
      }
      if (typing) return;
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        setPageStateRaw(previous => ({ ...previous, mealKind: 'bento' }));
      } else if ((event.key === 'e' || event.key === 'E') && pageState.selectedStudentId) {
        event.preventDefault();
        setPageStateRaw(previous => ({ ...previous, paymentDetailsOpen: true }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelSelection, pageState.confirmDuplicateOpen, pageState.paymentDetailsOpen, pageState.recovery, pageState.selectedStudentId]);

  const bentoCount = day?.totals.bentoCount ?? 0;
  const otherMealCount = day?.totals.otherMealCount ?? 0;

  return (
    <div className="cloud-orders" data-testid="cloud-orders-page">
      <header className="cloud-orders__header">
        <div className="cloud-orders__header-info">
          <h2>雲端櫃台點餐</h2>
          <span className="cloud-orders__date-label">營業日：{today || '—'}</span>
        </div>
        {snapshot && (
          <div className="cloud-orders__topbar-counts" data-testid="cloud-topbar-counts">
            <div className="cloud-orders__topbar-row" data-testid="cloud-topbar-bento">
              <span className="cloud-orders__topbar-label" title={todayMenu ? todayMenu.itemName : '未設定'}>
                今日餐點（{todayMenu ? todayMenu.itemName : '未設定'}）
              </span>
              <span className="cloud-orders__topbar-number">{bentoCount}</span>
            </div>
            <div className="cloud-orders__topbar-row" data-testid="cloud-topbar-other">
              <span className="cloud-orders__topbar-label">其他餐點</span>
              <span className="cloud-orders__topbar-number">{otherMealCount}</span>
            </div>
          </div>
        )}
      </header>

      {page.loading && (
        <div className="cloud-orders__notice" data-testid="cloud-orders-loading" role="status">
          正在從伺服器讀取訂餐資料…
        </div>
      )}

      {page.recovery && (
        <div className="cloud-orders__error" role="alert" data-testid="order-recovery-panel">
          {page.recovery.phase === 'unknown' ? (
            <>
              <p><strong>結果確認中，勿重新收款。</strong></p>
              <p>
                {page.recovery.command.label} 的訂餐已送出，但伺服器回應不確定。命令編號 {page.recovery.command.commandId} 保持不變；
                確認前不會產生新的命令。
              </p>
              <button type="button" onClick={retryRecovery} data-testid="order-recovery-retry">
                以相同命令編號確認結果
              </button>
            </>
          ) : (
            <p>
              {page.recovery.phase === 'checking' ? '正在以相同命令編號確認' : '正在送出'} {page.recovery.command.label} 的訂餐，
              請等待伺服器確認，勿重新收款。
            </p>
          )}
        </div>
      )}

      {page.storedPending && (
        <div className="cloud-orders__error" role="alert" data-testid="stored-pending-panel">
          <p><strong>上次有一筆訂餐的結果尚未確認，勿重新收款。</strong>命令編號 {page.storedPending.commandId}</p>
          {page.storedPending.message && <p>{page.storedPending.message}</p>}
          <div className="cloud-orders__actions">
            <button
              type="button"
              disabled={page.storedPending.checking}
              onClick={() => {
                const record = page.storedPending;
                if (record) void checkStoredPending(scopeKey, generationRef.current, record);
              }}
            >
              {page.storedPending.checking ? '查詢中…' : '再查一次'}
            </button>
            {!page.storedPending.checking && page.storedPending.message && (
              <button type="button" onClick={dismissStoredPending}>確認未入帳並清除提醒</button>
            )}
          </div>
        </div>
      )}

      {page.notice && (
        <div className="cloud-orders__notice" role="status" aria-live="polite">{page.notice}</div>
      )}

      {page.actionError && (
        <div className="cloud-orders__error" role="alert">{page.actionError}</div>
      )}

      {page.loadError && (
        <div className="cloud-orders__error" role="alert">
          {page.loadError}
          {!page.authorizationRevoked && (
            <button type="button" onClick={() => void loadSnapshot()}>重新載入</button>
          )}
        </div>
      )}

      {snapshot && !page.authorizationRevoked && (
        <div className="cloud-orders__content">
          <div className="cloud-orders__main-panel">
            {orderingBlocked && (
              <div className="cloud-orders__error" role="alert" data-testid="ordering-blocked">{orderingBlocked}</div>
            )}
            <div className="cloud-orders__card">
              {!selectedStudent ? (
                <div className="cloud-orders__search-group">
                  <label htmlFor="cloud-student-search">搜尋學員</label>
                  <input
                    id="cloud-student-search"
                    ref={searchInputRef}
                    className="cloud-orders__search-input"
                    type="text"
                    placeholder="輸入編號、姓名或別名..."
                    value={page.search}
                    onChange={event => {
                      const value = event.target.value;
                      setPageStateRaw(previous => ({ ...previous, search: value }));
                    }}
                    aria-label="搜尋編號、姓名或別名"
                    autoComplete="off"
                    disabled={busy}
                  />
                  {filteredStudents.length > 0 && (
                    <ul className="cloud-orders__search-dropdown" role="listbox">
                      {filteredStudents.slice(0, 10).map(student => (
                        <li
                          key={student.studentId}
                          className={`cloud-orders__search-item ${student.status === 'inactive' ? 'cloud-orders__search-item--inactive' : ''}`}
                          onClick={() => selectStudent(student)}
                          data-testid={`search-result-${student.studentCode}`}
                          role="option"
                          aria-selected="false"
                        >
                          <span>
                            <strong>{student.studentCode}</strong> {student.displayName}
                            {student.status === 'inactive' && <span className="cloud-orders__student-badge">已停用</span>}
                          </span>
                          <span>結餘 ${student.currentBalance}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="cloud-orders__selected-student" data-testid="selected-student-card">
                  <div className="cloud-orders__selected-info">
                    <span>編號：<strong>{selectedStudent.studentCode}</strong></span>
                    <span>姓名：<strong>{selectedStudent.displayName}</strong></span>
                    <span>目前餘額：${selectedStudent.currentBalance}</span>
                    {selectedStudent.status === 'inactive' && <span className="cloud-orders__student-badge">已停用</span>}
                  </div>
                  <button type="button" className="cloud-orders__btn-secondary" onClick={cancelSelection} disabled={busy}>
                    更換學員
                  </button>
                </div>
              )}
            </div>

            {selectedStudent && (
              <div className="cloud-orders__card">
                {selectedStudent.status === 'inactive' ? (
                  <div className="cloud-orders__error" role="alert">此帳戶已停用，禁止新增餐點</div>
                ) : (
                  <form onSubmit={requestSubmit} aria-label="訂餐">
                    <div className="cloud-orders__mode-selector">
                      <button
                        type="button"
                        className="cloud-orders__mode-btn"
                        aria-pressed={page.mealKind === 'bento'}
                        onClick={() => setPageStateRaw(previous => ({ ...previous, mealKind: 'bento' }))}
                        disabled={busy}
                      >
                        今日餐點（Q）
                      </button>
                      <button
                        type="button"
                        className="cloud-orders__mode-btn"
                        aria-pressed={page.mealKind === 'other'}
                        onClick={() => setPageStateRaw(previous => ({ ...previous, mealKind: 'other' }))}
                        disabled={busy}
                      >
                        其他餐點
                      </button>
                    </div>

                    {page.mealKind === 'bento' ? (
                      <div className="cloud-orders__bento-info">
                        {todayMenu ? (
                          <p>品名：<strong>{todayMenu.itemName}</strong>｜單價：<strong>${todayMenu.price}</strong></p>
                        ) : (
                          <p className="cloud-orders__error">今日尚未設定菜單，無法訂購今日餐點；其他餐點仍可登記。</p>
                        )}
                      </div>
                    ) : (
                      <div className="cloud-orders__form-grid">
                        <div className="cloud-orders__field">
                          <label htmlFor="other-item-name">餐點品名（必填）</label>
                          <input
                            id="other-item-name"
                            type="text"
                            placeholder="例如：炒麵、水餃"
                            value={page.otherItemName}
                            onChange={event => {
                              const value = event.target.value;
                              setPageStateRaw(previous => ({ ...previous, otherItemName: value }));
                            }}
                            maxLength={100}
                            disabled={busy}
                          />
                        </div>
                        <div className="cloud-orders__field">
                          <label htmlFor="other-item-price">餐點單價（必填）</label>
                          <input
                            id="other-item-price"
                            type="text"
                            inputMode="numeric"
                            placeholder="0"
                            value={page.otherPriceText}
                            onChange={event => {
                              const value = event.target.value;
                              setPageStateRaw(previous => ({ ...previous, otherPriceText: value }));
                            }}
                            disabled={busy}
                          />
                        </div>
                      </div>
                    )}

                    <div className="cloud-orders__form-grid">
                      <div className="cloud-orders__field">
                        <label htmlFor="paid-amount">實收金額（留空為 0 元）</label>
                        <input
                          id="paid-amount"
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={page.paidAmountText}
                          onChange={event => {
                            const value = event.target.value;
                            setPageStateRaw(previous => ({ ...previous, paidAmountText: value }));
                          }}
                          disabled={busy}
                        />
                      </div>
                      <div className="cloud-orders__field">
                        <label htmlFor="order-note">備註（選填）</label>
                        <input
                          id="order-note"
                          type="text"
                          placeholder="選填備註..."
                          value={page.note}
                          onChange={event => {
                            const value = event.target.value;
                            setPageStateRaw(previous => ({ ...previous, note: value }));
                          }}
                          maxLength={500}
                          disabled={busy}
                        />
                      </div>
                    </div>

                    <div className="cloud-orders__preview-bar">
                      <span>本次餐費：{mealPrice === null ? '—' : `$${mealPrice}`}</span>
                      <span>實收金額：{paidAmount === null ? '金額格式不正確' : `$${paidAmount}`}</span>
                      <span>
                        預估結餘：{previewBalance === null ? '—' : `$${previewBalance}`}
                        {previewBalance !== null && previewBalance < 0 && (
                          <strong className="cloud-orders__debt">（欠款 ${Math.abs(previewBalance)}）</strong>
                        )}
                      </span>
                    </div>

                    <div className="cloud-orders__actions">
                      <button
                        type="submit"
                        className="cloud-orders__btn-primary"
                        disabled={
                          busy
                          || Boolean(orderingBlocked)
                          || (page.mealKind === 'bento' && !todayMenu)
                          || (page.mealKind === 'other' && (!page.otherItemName.trim() || !page.otherPriceText.trim()))
                        }
                        data-testid="submit-order-button"
                      >
                        {busy ? '等待伺服器確認…' : '確認登記（Enter）'}
                      </button>
                      <button
                        type="button"
                        className="cloud-orders__btn-secondary"
                        onClick={() => setPageStateRaw(previous => ({ ...previous, paymentDetailsOpen: true }))}
                        disabled={busy}
                        data-testid="open-payment-details-button"
                      >
                        付款明細（E）
                      </button>
                      <button type="button" className="cloud-orders__btn-secondary" onClick={cancelSelection} disabled={busy}>
                        取消（Esc）
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          <div className="cloud-orders__side-panel">
            <div className="cloud-orders__card" data-testid="recent-accounts-card">
              <h3>最近帳戶</h3>
              {recentAccounts.length === 0 ? (
                <p className="cloud-orders__muted">今日尚無交易紀錄</p>
              ) : (
                <ul className="cloud-orders__recent-list" data-testid="recent-accounts-list">
                  {recentAccounts.map(({ student, summary }) => (
                    <li
                      key={student.studentId}
                      className="cloud-orders__recent-item"
                      onClick={() => { if (!busy) selectStudent(student); }}
                      data-testid={`recent-item-${student.studentCode}`}
                    >
                      <span><strong>{student.studentCode}</strong> {student.displayName}</span>
                      <span className="cloud-orders__recent-badge">{summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {page.confirmDuplicateOpen && selectedStudent && !busy && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true" aria-label="確認加訂餐點">
          <div className="cloud-orders__modal">
            <h3>確認加訂餐點</h3>
            <p>{selectedStudent.displayName} 今天已訂 {selectedOrderCount} 份餐點，確定要再加訂 1 份嗎？</p>
            <div className="cloud-orders__actions">
              <button type="button" className="cloud-orders__btn-primary" onClick={submitOrder} data-testid="confirm-duplicate-button">
                確認加訂
              </button>
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false }))}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {page.paymentDetailsOpen && selectedStudent && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true" aria-label="付款明細">
          <div className="cloud-orders__modal" data-testid="payment-details-modal">
            <h3>{selectedStudent.displayName} 今日付款明細</h3>
            {selectedTransactions.length === 0 ? (
              <p className="cloud-orders__muted">今日尚無交易紀錄</p>
            ) : (
              <table className="cloud-orders__table">
                <thead>
                  <tr><th>時間</th><th>項目</th><th>餐費</th><th>收款</th></tr>
                </thead>
                <tbody>
                  {selectedTransactions.map(tx => (
                    <tr key={tx.transactionId}>
                      <td>{formatTaipeiTime(tx.createdAt)}</td>
                      <td>{itemLabel(tx)}</td>
                      <td>${tx.mealPrice}</td>
                      <td>${tx.paidAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="cloud-orders__preview-bar" data-testid="payment-details-summary">
              <span>今日餐費：${selectedTransactions.reduce((sum, tx) => sum + tx.mealPrice, 0)}</span>
              <span>今日收款：${selectedTransactions.reduce((sum, tx) => sum + tx.paidAmount, 0)}</span>
              <span>帳戶餘額：${selectedStudent.currentBalance}</span>
            </div>
            <div className="cloud-orders__actions">
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPageStateRaw(previous => ({ ...previous, paymentDetailsOpen: false }))}
                data-testid="close-payment-details-button"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
