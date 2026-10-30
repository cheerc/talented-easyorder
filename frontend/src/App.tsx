import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { usePosFlow } from './hooks/usePosFlow';
import { posDraftKey, type PosMode } from './domain/posFlow';
import { checkStorageHealth } from './storage/storageHealth';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAppNavigationShortcuts } from './hooks/useAppNavigationShortcuts';
import { useSystemDate } from './hooks/useSystemDate';
import { useServiceWorkerCleanup } from './hooks/useServiceWorkerCleanup';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useCrashDraftRecovery } from './hooks/useCrashDraftRecovery';
import { useUndoCountdown } from './hooks/useUndoCountdown';
import { usePinnedStudent } from './hooks/usePinnedStudent';
import { useCommitLifecycle } from './hooks/useCommitLifecycle';
import { useConfirmHandler } from './hooks/useConfirmHandler';
import { useExpenseProps } from './hooks/useExpenseProps';

import { buildRefundTransactionDraft } from './domain/posTransaction';
import type { LedgerMutationResult } from './domain/ledgerAudit';
import { MainLayout } from './components/MainLayout';
import type { FlashData } from './components/MainLayout';
import { ErrorBoundary, AppCrashPage } from './components/ErrorBoundary';
import { appendErrorLog } from './errors/errorLogger';
import { AppRouter } from './components/AppRouter';
import { useStudents, useTransactions, useMenu, useMenuForDate, useSessionActions, useTransactionActions } from './store/selectors';
import { countMeals } from './domain/ledgerReport';
import { useFlashData } from './hooks/useFlashData';
import { useFocusSync } from './hooks/useFocusSync';
import { useCancelDialog } from './hooks/useCancelDialog';
import { useTweaks } from './hooks/useTweaks';
import { usePosColumnProps } from './hooks/usePosColumnProps';
import { FirebaseProvider } from './providers/FirebaseProvider';
import { isConfigured as isFirebaseConfigured } from './firebase/firebaseApp';
import { useFirebase } from './hooks/useFirebase';
import { isPrototypeMode, validateAppModeConfig } from './appMode';
import { isMenuReady } from './domain/menu';
import { AuthGate } from './auth/AuthGate';
import { useOperator } from './auth/OperatorContext';
import { AppShell } from './components/AppShell';
import { navigationKey, isCompositionKey } from './components/navigationKeys';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { SYSTEM_OPERATOR_ID } from './domain/operatorId';
import { findStudentEarliestDate } from './domain/transactionLookup';
import type { HistoryLookupTarget } from './components/screens/HistoryScreen';
import type { StudentAccount } from './domain/student';
import { CloudOrdersPage } from './components/cloud/CloudOrdersPage';
import { CloudStudentsPage } from './components/cloud/CloudStudentsPage';
import { CloudDayVendorsPage } from './components/cloud/CloudDayVendorsPage';
import { CloudDayClosePage } from './components/cloud/CloudDayClosePage';
import { CloudLedgerAnomaliesPage } from './components/cloud/CloudLedgerAnomaliesPage';
import { CloudReportPage } from './components/cloud/CloudReportPage';
import { CloudAccountHistoryPage } from './components/cloud/CloudAccountHistoryPage';
import { CloudPendingRecoveryBoundary } from './components/cloud/CloudPendingRecoveryBoundary';
import { CloudDiagnosticsPage } from './components/cloud/CloudDiagnosticsPage';
import type { CloudLedgerDateRange } from './domain/cloudLedgerReport';
import { useCloudLedger } from './hooks/useCloudLedger';
import type { OpeningMismatchAnomaly } from './domain/ledgerAnomalies';
import type { Firestore } from 'firebase/firestore';
import { TriangleAlert } from 'lucide-react';

function AppContent() {
  const { fb, fbError, access } = useFirebase();
  const { systemDate, viewDate, setViewDate } = useSystemDate();

  const { students } = useStudents();
  const { transactions: allTx } = useTransactions();
  const { vendors } = useMenu();
  // M0：檢視中營業日的晚餐（日期 key 菜單）。只有檢視日＝可寫營業日時才能訂餐。
  const { menu: todayMenu } = useMenuForDate(viewDate);
  const { getBusinessDateStatus } = useSessionActions();

  // Ref: #298 — Inline computations previously in useAppState.
  // M2：當天交易全部列入，不截斷。原本先反轉再取前 200 筆，超過時留下最舊的、丟掉最新的，份數也跟著少算。
  const tx = useMemo(() =>
    allTx.filter(t => t.businessDate === viewDate).reverse(),
  [allTx, viewDate]);
  // 今日餐點份數與其他餐點分開算（向供應商叫餐只看今日餐點）。
  // 以前要求品項與單價都等於現在的菜單，當天改價後前面的訂單就不算了。
  const meals = useMemo(() => countMeals(tx), [tx]);
  const todayCount = meals.bento;
  const todayOtherCount = meals.other;
  const queuedCount = useMemo(() => allTx.filter(t => t.syncStatus === 'queued').length, [allTx]);
  const failedSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'failed').length, [allTx]);
  const conflictSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'conflict').length, [allTx]);

  const dateStatus = getBusinessDateStatus(viewDate);
  const isHistorical = viewDate !== systemDate;
  const operatorUid = (access.ok && access.profile?.uid) ? access.profile.uid : SYSTEM_OPERATOR_ID;
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [priceOverrideLabel, setPriceOverrideLabel] = useState('');
  useServiceWorkerCleanup();

  const { state, setSearchText, selectStudent, changeMode, setPaidAmountText,
    requestConfirm, confirmDuplicate, cancelFlow, dismissSuccess,
    enterExpenseMode, updateExpenseAmount, confirmExpenseAmount,
    selectExpenseDirection, selectExpenseReason, updateExpenseNote, confirmExpenseNote,
  } = usePosFlow({ businessDate: viewDate, isHistorical, priceOverride, priceOverrideLabel });

  // M1 F02：特殊餐價格與品項屬於這張草稿；換人、取消、進櫃台收支或切日時一律清掉，
  // 不靠個別 Esc／取消按鈕各自記得清。render 期間調整，避免 effect 先畫出一幀殘留價格。
  const draftKey = posDraftKey(state);
  const [prevDraftKey, setPrevDraftKey] = useState(draftKey);
  if (prevDraftKey !== draftKey) {
    setPrevDraftKey(draftKey);
    if (priceOverride !== null) setPriceOverride(null);
    if (priceOverrideLabel !== '') setPriceOverrideLabel('');
  }

  // M0 S-DATE：模擬營業日切換時，不把未送出的 F1 草稿帶到新的一天。
  const prevSystemDateRef = useRef(systemDate);
  useEffect(() => {
    if (prevSystemDateRef.current === systemDate) return;
    prevSystemDateRef.current = systemDate;
    if (isPrototypeMode) cancelFlow();
  }, [systemDate, cancelFlow]);

  const [tab, setTab] = useState('pos');
  const [prototypeLeaveTab, setPrototypeLeaveTab] = useState<string | null>(null);
  const [historyLookupTarget, setHistoryLookupTarget] = useState<HistoryLookupTarget | null>(null);

  const handleSelectTab = useCallback((nextTab: string) => {
    if (state.kind === 'committing' || state.kind === 'error') return;
    if (tab === 'pos' && nextTab !== 'pos' && (state.kind === 'student_selected' || state.kind.startsWith('expense_'))) {
      setPrototypeLeaveTab(nextTab);
      return;
    }
    if (nextTab !== 'history') setHistoryLookupTarget(null);
    setTab(nextTab);
  }, [state.kind, tab]);
  const [reportStudentFilter, setReportStudentFilter] = useState('');
  const [focusZone, setFocusZone] = useState('mode-order');
  const [showDashboard, setShowDashboard] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const online = useOnlineStatus();
  const { commitPosTransactionDraft } = useTransactionActions();

  const storageHealthyRef = useRef(true);
  useEffect(() => { const health = checkStorageHealth(); storageHealthyRef.current = health.ok; }, []);

  const crashDraftRestored = useCrashDraftRecovery({ selectStudent, setPaidAmountText, changeMode });
  const [crashDraftRestoredState, setCrashDraftRestoredState] = useState(crashDraftRestored);

  // Ref: #281 — Extracted to usePinnedStudent hook
  const { picked, currentMode, currentPaidAmount } = usePinnedStudent(state, students);

  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [manualFlash, setManualFlash] = useState<FlashData | null>(null);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const { undoCountdown, setUndoCountdown, lastCommittedTxIdRef, dismissFlash, handleUndo } = useUndoCountdown({
    dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel, operatorId: operatorUid,
  });

  const onDismissFlash = useCallback(() => {
    setManualFlash(null);
    dismissFlash();
  }, [dismissFlash]);

  const handleUndoWithManualFlash = useCallback(() => {
    setManualFlash(null);
    handleUndo();
  }, [handleUndo]);

  // Ref: #281 — Extracted to useConfirmHandler hook
  const handleConfirm = useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount, orderBlocked: !isMenuReady(todayMenu) || (priceOverride !== null && !(Number.isSafeInteger(priceOverride) && priceOverride > 0)) });

  const { cancelDialogOpen, setCancelDialogOpen, noOrderDialogOpen, setNoOrderDialogOpen,
    orderTx: cancelOrderTx, openCancelConfirm, openCancelConfirmForTx, handleDeleteOrder } = useCancelDialog({ picked, allTx, viewDate, allStudents: students, selectStudent, operatorId: operatorUid });

  // Ref: #281 — Extracted to useCommitLifecycle hook
  const { lastSync } = useCommitLifecycle({
    stateKind: state.kind,
    successTransactionId: state.kind === 'success' ? state.transactionId : null,
    lastCommittedTxIdRef,
    setUndoCountdown,
    setSyncing,
  });

  const hasFlash = state.kind === 'success' || manualFlash !== null;
  const isStudentSelected = picked !== null && (state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing' || state.kind === 'error');
  const isExpenseFlow = state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note';

  // M1 K08：重複訂餐確認也是對話框，開著時背景的 Enter／方向鍵／Q W 都不處理，交給對話框。
  const isDialogOpen = cancelDialogOpen || noOrderDialogOpen || state.kind === 'duplicate_warning' || refundDialogOpen || prototypeLeaveTab !== null || state.kind === 'committing' || state.kind === 'error';

  useKeyboardShortcuts({
    enabled: tab === 'pos' && !hasFlash && !isExpenseFlow,
    changeMode, cancelOrder: openCancelConfirm, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone,
    isDialogOpen,
    openOtherMeal: state.kind === 'student_selected' ? () => {
      changeMode('order');
      setPriceOverride(value => value ?? todayMenu.price);
      setFocusZone('other-item');
      document.querySelector<HTMLInputElement>('[data-other-meal-item]')?.focus();
    } : undefined,
  });

  const { tweaks } = useTweaks();

  useFocusSync(state, tab, setSearchText, setSearchFocusKey, setFocusZone, focusZone);

  const isSuccess = state.kind === 'success';
  // Ref: #281 — Extracted to useExpenseProps hook
  const expenseProps = useExpenseProps(state);

  const flashData = useFlashData({ isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, priceOverrideLabel, allTx });

  useAppNavigationShortcuts({
    tab, setTab: handleSelectTab, setShowDashboard,
    picked, expenseProps, currentMode, hasFlash, focusZone, setFocusZone,
    changeMode: changeMode as (m: PosMode) => void,
    cancelFlow, handleConfirm, setSearchText, setSearchFocusKey,
    cancelOrder: openCancelConfirm,
    isDialogOpen,
  });

  // Ref: #316 — Replaced inline 30-dep useMemo with usePosColumnProps hook.
  // Each useMemo group stabilizes a logical concern; the hook merges them.
  const dateArgs = useMemo(() => ({
    isHistorical, dateStatus, viewDate, systemDate, setViewDate,
  }), [isHistorical, dateStatus, viewDate, systemDate, setViewDate]);

  const handleViewAllHistory = useCallback((student: StudentAccount) => {
    const earliestDate = findStudentEarliestDate(student, allTx, viewDate);
    setHistoryLookupTarget({
      query: student.studentId,
      exactStudentId: student.studentId,
      startDate: earliestDate,
      endDate: viewDate,
    });
    setTab('history');
  }, [allTx, viewDate]);

  const handleRefund = useCallback((studentId: string, amount: number, reason: string): LedgerMutationResult => {
    const student = students.find(s => s.studentId === studentId) ?? null;
    if (!student) return { ok: false, message: '找不到這個帳戶。' };
    const draft = buildRefundTransactionDraft({
      businessDate: viewDate,
      student,
      amount,
      note: reason,
      sourceDevice: 'pc',
      operatorId: operatorUid,
    });
    const result = commitPosTransactionDraft(draft);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
    lastCommittedTxIdRef.current = result.transactionId;
    setUndoCountdown(5);
    setManualFlash({
      id: flashKey,
      name: student.displayName,
      sid: student.studentId,
      detail: `退款：${reason}`,
      amount: -amount,
      after: student.currentBalance - amount,
    });
    cancelFlow();
    return { ok: true };
  }, [students, viewDate, operatorUid, commitPosTransactionDraft, flashKey, cancelFlow, lastCommittedTxIdRef, setUndoCountdown]);

  const flowArgs = useMemo(() => ({
    state, picked, currentMode, currentPaidAmount, selectStudent,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, openCancelConfirm, openCancelConfirmForTx,
    handleDeleteOrder,
    onViewAllHistory: handleViewAllHistory,
    onRefund: handleRefund,
    onRefundDialogOpenChange: setRefundDialogOpen,
  }), [state, picked, currentMode, currentPaidAmount, selectStudent,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, openCancelConfirm, openCancelConfirmForTx,
    handleDeleteOrder, handleViewAllHistory, handleRefund, setRefundDialogOpen]);

  const expenseArgs = useMemo(() => ({
    expenseProps, enterExpenseMode,
    updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection,
    selectExpenseReason, updateExpenseNote, confirmExpenseNote,
  }), [expenseProps, enterExpenseMode,
    updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection,
    selectExpenseReason, updateExpenseNote, confirmExpenseNote]);

  const uiArgs = useMemo(() => ({
    setFocusZone, focusZone, hasFlash,
    crashDraftRestored: crashDraftRestoredState,
    setCrashDraftRestored: setCrashDraftRestoredState,
  }), [setFocusZone, focusZone, hasFlash, crashDraftRestoredState, setCrashDraftRestoredState]);

  const searchArgs = useMemo(() => ({
    setSearchText, searchFocusKey,
  }), [setSearchText, searchFocusKey]);

  const menuArgs = useMemo(() => ({
    allTx, students, todayMenu, todayCount, todayOtherCount, vendors, tx, operatorUid, tweaks,
  }), [allTx, students, todayMenu, todayCount, todayOtherCount, vendors, tx, operatorUid, tweaks]);

  const pricingArgs = useMemo(() => ({
    priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel,
  }), [priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel]);

  const posColumnProps = usePosColumnProps(
    dateArgs, flowArgs, expenseArgs, uiArgs, searchArgs, menuArgs, pricingArgs,
  );

  if (fbError) {
    return <AppCrashPage />;
  }

  // Ref: #362 — Firebase not configured (no .env): run in local-only mode,
  // bypassing AuthGate. fb will remain null with no fbError.
  const mainContent = (
    <MainLayout
      tab={tab} setTab={handleSelectTab} navigationLocked={state.kind === 'committing' || state.kind === 'error'} online={online} syncing={syncing} lastSync={lastSync}
      todayCount={todayCount} todayOtherCount={todayOtherCount} todayMenu={todayMenu} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate}
      queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount}
      onDashboard={() => setShowDashboard(true)}
      storageMode={fb ? 'cloud' : isPrototypeMode ? 'prototype' : 'local-only'}
      flashData={manualFlash ?? flashData} onDismissFlash={onDismissFlash}
      onUndo={handleUndoWithManualFlash} undoCountdown={undoCountdown}
      cancelDialogOpen={cancelDialogOpen} picked={picked}
      orderTx={cancelOrderTx}
      onCancelDialogConfirm={(keepPaymentAsDeposit, reason) => {
        const result = handleDeleteOrder(keepPaymentAsDeposit, reason);
        if (result.ok) { setCancelDialogOpen(false); cancelFlow(); }
        return result;
      }}
      onCancelDialogCancel={() => setCancelDialogOpen(false)}
      noOrderDialogOpen={noOrderDialogOpen}
      onNoOrderDialogClose={() => setNoOrderDialogOpen(false)}
      showDashboard={showDashboard} onCloseDashboard={() => setShowDashboard(false)}
    >
      <ConfirmDialog open={prototypeLeaveTab !== null} title="離開並捨棄草稿？" message="尚未送出的草稿會被捨棄。" defaultAction="cancel" confirmLabel="捨棄草稿" cancelLabel="取消離開" onCancel={() => setPrototypeLeaveTab(null)} onConfirm={() => {
        if (prototypeLeaveTab && state.kind !== 'committing' && state.kind !== 'error') {
          // Expense cancellation steps backwards; four cancel events reach idle from every draft step.
          for (let index = 0; index < 4; index += 1) cancelFlow();
          if (prototypeLeaveTab !== 'history') setHistoryLookupTarget(null);
          setTab(prototypeLeaveTab);
        }
        setPrototypeLeaveTab(null);
      }} />
      <AppRouter
        tab={tab}
        viewDate={viewDate}
        reportStudentFilter={reportStudentFilter}
        onClearStudentFilter={() => setReportStudentFilter('')}
        posColumnProps={posColumnProps}
        historyLookupTarget={historyLookupTarget}
        onConsumeHistoryLookupTarget={() => setHistoryLookupTarget(null)}
        onViewStudentHistory={handleViewAllHistory}
        onRefund={handleRefund}
        onRefundDialogOpenChange={setRefundDialogOpen}
      />
    </MainLayout>
  );

  if (!fb && isFirebaseConfigured) {
    // Firebase configured but init pending — show loading
    return <div className="app-loading" aria-label="載入中"><div className="app-loading-spinner" />載入中...</div>;
  }

  if (!fb) {
    // Ref: #362 — Firebase not configured (no .env): local-only mode
    return (
      <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => appendErrorLog({ source: 'react', message: e.message, stack: e.stack })}>
      {mainContent}
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => appendErrorLog({ source: 'react', message: e.message, stack: e.stack })}>
    <AuthGate auth={fb.auth} db={fb.db} access={access}>
    {mainContent}
    </AuthGate>
    </ErrorBoundary>
  );
}

type CloudSection = 'orders' | 'students' | 'day-vendors' | 'vendors' | 'day-close' | 'anomalies' | 'reports' | 'account-history' | 'diagnostics';

const CLOUD_SECTION_LABELS: Record<CloudSection, string> = {
  orders: '雲端櫃台點餐',
  students: '雲端學生管理',
  'day-vendors': '菜單與開帳',
  vendors: '供應商',
  'day-close': '雲端日結',
  anomalies: '帳務異常',
  reports: '雲端報表',
  'account-history': '雲端查帳',
  diagnostics: '雲端本機診斷',
};

// 放在 AuthGate 之內：帳務異常只在已登入並持有使用權之後才從伺服器讀取。
function CloudSections({ db, leaseEpoch, identityKey, hasUnresolvedPendingCommands }: {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  hasUnresolvedPendingCommands: boolean;
}) {
  const [cloudSection, setCloudSection] = useState<CloudSection>('students');
  const pageGenerationRef = useRef(0);
  const [pageGeneration, setPageGeneration] = useState(0);
  const [settingsTab, setSettingsTab] = useState<CloudSection>('day-vendors');
  const [accountTab, setAccountTab] = useState<CloudSection>('day-close');
  const [dayVendorGeneration, setDayVendorGeneration] = useState(0);
  const [ordersGeneration, setOrdersGeneration] = useState(0);
  const [leaveTarget, setLeaveTarget] = useState<{ section: CloudSection; dayId?: string; postCloseEntry?: OpeningMismatchAnomaly } | null>(null);
  const dirtyRef = useRef(false);
  const operator = useOperator();
  const { tweaks, setTweak } = useTweaks();
  const [dayCloseFocus, setDayCloseFocus] = useState<string | undefined>(undefined);
  const [postCloseEntryFocus, setPostCloseEntryFocus] = useState<OpeningMismatchAnomaly | undefined>(undefined);
  const [ordersFocus, setOrdersFocus] = useState<string | undefined>(undefined);
  const [viewDay, setViewDay] = useState<{ date: string; backfill: boolean } | null>(null);
  const onViewDayChange = useCallback((date: string, backfill: boolean) => setViewDay({ date, backfill }), []);
  const [accountHistoryStudentId, setAccountHistoryStudentId] = useState<string | null>(null);
  const [accountHistoryRange, setAccountHistoryRange] = useState<CloudLedgerDateRange | null>(null);
  const [navigationLocked, setNavigationLocked] = useState(false);
  const navigationLockRef = useRef<{ identityKey: string; locked: boolean; revoked: boolean } | null>(null);
  const { ledger, reload: reloadLedger } = useCloudLedger(db, `${identityKey}:${leaseEpoch}`);

  const reportNavigationState = useCallback((reportedKey: string, state: 'recovering' | 'revoked' | 'resolved') => {
    if (reportedKey !== identityKey || pageGenerationRef.current !== pageGeneration) return;
    const currentLock = navigationLockRef.current;
    const current = currentLock?.identityKey === reportedKey
      ? currentLock
      : { identityKey: reportedKey, locked: false, revoked: false };
    let locked = current.locked;
    let revoked = current.revoked;
    if (state === 'revoked') {
      revoked = true;
      locked = true;
    } else if (state === 'recovering') {
      locked = true;
    } else if (!revoked) {
      locked = false;
    }
    const lock = { identityKey: reportedKey, locked, revoked };
    navigationLockRef.current = lock;
    setNavigationLocked(lock.locked);
  }, [identityKey, pageGeneration]);
  const applySection = (section: CloudSection, dayId?: string, postCloseEntry?: OpeningMismatchAnomaly, reset = false) => {
    const dayVendorViews = ['day-vendors', 'vendors'];
    if (reset || !dayVendorViews.includes(section) || !dayVendorViews.includes(cloudSection)) {
      pageGenerationRef.current += 1;
      setPageGeneration(pageGenerationRef.current);
    }
    dirtyRef.current = false;
    if (section === 'orders') setViewDay(null);
    if (section === 'anomalies') reloadLedger();
    if (section === 'students' || section === 'day-vendors' || section === 'diagnostics') setSettingsTab(section);
    if (section === 'day-close' || section === 'reports') setAccountTab(section);
    setDayCloseFocus(section === 'day-close' ? dayId : undefined);
    setPostCloseEntryFocus(section === 'day-close' ? postCloseEntry : undefined);
    setOrdersFocus(section === 'orders' ? dayId : undefined);
    setCloudSection(section);
  };
  const selectSection = (section: CloudSection, dayId?: string, postCloseEntry?: OpeningMismatchAnomaly) => {
    if (navigationLockRef.current?.locked || leaveTarget || document.querySelector('.cloud-app')?.closest('[inert]') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    const selectedOrder = cloudSection === 'orders' && !!document.querySelector('form[aria-label="訂餐"], form[aria-label="繳費"], form[aria-label="櫃台收支"]');
    if (section === cloudSection && !dayId && !postCloseEntry) {
      if (section === 'orders' && (dirtyRef.current || selectedOrder)) setLeaveTarget({ section });
      else if (section === 'orders') document.querySelector<HTMLInputElement>('#cloud-student-search')?.focus();
      return;
    }
    if (dirtyRef.current || selectedOrder) { setLeaveTarget({ section, dayId, postCloseEntry }); return; }
    applySection(section, dayId, postCloseEntry);
  };
  const selectPrimary = (id: string) => {
    if (id === 'pos') selectSection('orders');
    if (id === 'report') selectSection(accountTab);
    if (id === 'admin') selectSection(settingsTab);
    if (id === 'vendors') selectSection('vendors');
    if (id === 'history') selectSection('account-history');
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = navigationKey(event);
      if (key === null) return;
      event.preventDefault();
      if (isCompositionKey(event) || event.repeat) return;
      if (navigationLockRef.current?.locked || leaveTarget || document.querySelector('.cloud-app')?.closest('[inert]') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      selectPrimary(['pos', 'report', 'admin', 'vendors', 'history'][key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const openAnomalies = () => selectSection('anomalies');
  const onDraftCleared = useCallback(() => { if (pageGenerationRef.current === pageGeneration) dirtyRef.current = false; }, [pageGeneration]);
  const common = { db, leaseEpoch, identityKey, onNavigationStateChange: reportNavigationState, onDraftCleared };

  return (
    <main className="cloud-app" aria-label={CLOUD_SECTION_LABELS[cloudSection]} onChangeCapture={event => {
      const element = event.target as HTMLElement;
      if (element.closest('form') && !element.closest('.cloud-day-vendors__date-form, .cloud-day-close__date-form, .cloud-report__controls, .cloud-account-history__date-form')) dirtyRef.current = true;
    }}>
      <AppShell active={cloudSection === 'orders' ? 'pos' : cloudSection === 'day-close' || cloudSection === 'reports' ? 'report' : cloudSection === 'students' || cloudSection === 'day-vendors' || cloudSection === 'diagnostics' ? 'admin' : cloudSection === 'vendors' ? 'vendors' : cloudSection === 'account-history' ? 'history' : ''}
        select={selectPrimary} disabled={navigationLocked}
        brand={<div className="brand"><div className="brand-mark">●</div><div><div className="brand-name">訂餐櫃台</div><div className="brand-sub">{cloudSection === 'orders' && viewDay?.backfill ? <span className="backfill-badge">補登 {viewDay.date}</span> : cloudSection === 'orders' ? viewDay?.date ?? '營業日未確認' : ledger.status === 'ready' ? ledger.snapshot.today : '營業日未確認'}</div></div></div>}
        status={<div className="status">{ledger.status === 'ready' && ledger.snapshot.anomalies.length > 0 && <button disabled={navigationLocked} onClick={openAnomalies}><TriangleAlert size={14} aria-hidden="true" /> 異常 {ledger.snapshot.anomalies.length}</button>}
          <details className="operator-menu operator-strip" onClick={event => { if ((event.target as HTMLElement).closest('button')) { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary>{operator?.name ?? '操作員'}</summary><div className="operator-menu__panel">
            <small>租約 Epoch: {leaseEpoch}</small>
            <button type="button" disabled={navigationLocked} onClick={openAnomalies}>帳務檢查</button>
            <label>主題 <select value={tweaks.theme} onChange={event => setTweak('theme', event.target.value)}><option value="warm">暖色</option><option value="light">淺色</option><option value="dark">深色</option></select></label>
            <p>F1–F5 或 Alt／Option + 1–5 切換頁面</p>
            <button type="button" disabled={navigationLocked} onClick={() => operator?.signOut()}>釋放使用權並登出</button>
          </div></details></div>} />
      {(cloudSection === 'day-close' || cloudSection === 'reports') && <nav className="cloud-subnav" aria-label="今日帳"><button disabled={navigationLocked} aria-current={cloudSection === 'day-close' ? 'page' : undefined} onClick={() => selectSection('day-close')}>今日</button><button disabled={navigationLocked} aria-current={cloudSection === 'reports' ? 'page' : undefined} onClick={() => selectSection('reports')}>本週／本月</button></nav>}
      {(cloudSection === 'students' || cloudSection === 'day-vendors' || cloudSection === 'diagnostics') && <nav className="cloud-subnav" aria-label="今日設定"><button disabled={navigationLocked} aria-current={cloudSection === 'students' ? 'page' : undefined} onClick={() => selectSection('students')}>學生</button><button disabled={navigationLocked} aria-current={cloudSection === 'day-vendors' ? 'page' : undefined} onClick={() => selectSection('day-vendors')}>菜單與開帳</button><button disabled={navigationLocked} aria-current={cloudSection === 'diagnostics' ? 'page' : undefined} onClick={() => selectSection('diagnostics')}>本機診斷</button></nav>}
      <ConfirmDialog open={leaveTarget !== null} title="離開並捨棄草稿？" message="尚未送出的草稿會被捨棄。" defaultAction="cancel" confirmLabel="捨棄草稿" cancelLabel="取消離開" onCancel={() => setLeaveTarget(null)} onConfirm={() => { if (leaveTarget && !navigationLockRef.current?.locked) { setDayVendorGeneration(value => value + 1); if (leaveTarget.section === 'orders' && cloudSection === 'orders') setOrdersGeneration(value => value + 1); applySection(leaveTarget.section, leaveTarget.dayId, leaveTarget.postCloseEntry, true); } setLeaveTarget(null); }} />
      {cloudSection === 'orders' ? (
        <CloudOrdersPage key={ordersGeneration} {...common} initialBackfillDayId={ordersFocus} onViewDayChange={onViewDayChange} onOpenSettings={() => selectSection('day-vendors')} />
      ) : cloudSection === 'students' ? (
        <CloudStudentsPage {...common} />
      ) : cloudSection === 'day-vendors' || cloudSection === 'vendors' ? (
        <CloudDayVendorsPage key={dayVendorGeneration} view={cloudSection === 'vendors' ? 'vendors' : 'day'} {...common} ledger={ledger} onOpenAnomalies={openAnomalies} onLedgerChanged={reloadLedger} />
      ) : cloudSection === 'day-close' ? (
        <CloudDayClosePage
          {...common}
          ledger={ledger}
          onOpenAnomalies={openAnomalies}
          onLedgerChanged={reloadLedger}
          initialDayId={dayCloseFocus}
          initialPostCloseEntry={postCloseEntryFocus}
          onOpenOrders={dayId => selectSection('orders', dayId)}
          hasUnresolvedPendingCommands={hasUnresolvedPendingCommands}
        />
      ) : cloudSection === 'reports' ? (
        <CloudReportPage
          key={`${identityKey}:${leaseEpoch}`}
          {...common}
          onOpenDayClose={dayId => selectSection('day-close', dayId)}
          onOpenAccountHistory={(studentId, range) => {
            setAccountHistoryStudentId(studentId);
            setAccountHistoryRange(range);
            selectSection('account-history');
          }}
        />
      ) : cloudSection === 'account-history' ? (
        <CloudAccountHistoryPage
          key={`${identityKey}:${leaseEpoch}`}
          {...common}
          initialStudentId={accountHistoryStudentId}
          initialRange={accountHistoryRange}
        />
      ) : cloudSection === 'diagnostics' ? (
        <CloudDiagnosticsPage key={`${identityKey}:${leaseEpoch}`} identityKey={identityKey} leaseEpoch={leaseEpoch} />
      ) : (
        <CloudLedgerAnomaliesPage
          ledger={ledger}
          onReload={reloadLedger}
          onOpenDayClose={dayId => selectSection('day-close', dayId)}
          onOpenPostCloseEntry={anomaly => selectSection('day-close', anomaly.previousClosedDayId, anomaly)}
        />
      )}
    </main>
  );
}

function CloudBrowserKeyGuard() {
  useEffect(() => {
    const intercept = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && /^F[1-6]$/.test(event.key)) event.preventDefault();
      if (navigationKey(event) !== null) event.preventDefault();
    };
    window.addEventListener('keydown', intercept, true);
    return () => window.removeEventListener('keydown', intercept, true);
  }, []);
  return null;
}

function CloudAppContent() {
  const { fb, fbError, storageCleanupError, access, lease } = useFirebase();
  // 與本機模式共用 U1 顯示偏好（easyorder-ui-tweaks）：主題與字級套在 body 上。
  useTweaks();

  if (fbError) return <InitializationProblemPage message={fbError} />;
  if (storageCleanupError) return <InitializationProblemPage message={storageCleanupError} />;
  if (!fb) {
    return <div className="app-loading" aria-label="載入中"><div className="app-loading-spinner" />載入中...</div>;
  }

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(error) => appendErrorLog({ source: 'react', message: error.message, stack: error.stack })}>
      <AuthGate auth={fb.auth} db={fb.db} access={access} showOperatorStrip={false}>
        <CloudBrowserKeyGuard />
        {access.ok && (
          <CloudPendingRecoveryBoundary
            db={fb.db}
            uid={access.profile.uid}
            leaseEpoch={lease.epoch}
          >
            {hasUnresolvedPendingCommands => (
              <CloudSections
                key={`${access.profile.uid}:${lease.epoch}`}
                db={fb.db}
                leaseEpoch={lease.epoch}
                identityKey={`${access.profile.uid}:${lease.epoch}`}
                hasUnresolvedPendingCommands={hasUnresolvedPendingCommands}
              />
            )}
          </CloudPendingRecoveryBoundary>
        )}
      </AuthGate>
    </ErrorBoundary>
  );
}

function InitializationProblemPage({ message }: { message: string }) {
  return (
    <main className="auth-gate" aria-label="本機資料清理狀態">
      <h1>Talented EasyOrder</h1>
      <p role="alert">{message}</p>
      <button type="button" onClick={() => window.location.reload()}>重新載入</button>
    </main>
  );
}

function AppModeContent() {
  if (isPrototypeMode) return <AppContent />;
  const config = validateAppModeConfig(import.meta.env.MODE, import.meta.env);
  if (!config.ok) {
    return (
      <main className="auth-gate" aria-label="Firebase 設定錯誤">
        <h1>Talented EasyOrder</h1>
        <p role="alert">{config.error}</p>
      </main>
    );
  }
  return <CloudAppContent />;
}

export default function App() {
  return (
    <FirebaseProvider>
      <AppModeContent />
    </FirebaseProvider>
  );
}

