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

import { MainLayout } from './components/MainLayout';
import { ErrorBoundary, AppCrashPage } from './components/ErrorBoundary';
import { appendErrorLog } from './errors/errorLogger';
import { AppRouter } from './components/AppRouter';
import { useStudents, useTransactions, useMenu, useMenuForDate, useSessionActions } from './store/selectors';
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
import { SYSTEM_OPERATOR_ID } from './domain/operatorId';
import { findStudentEarliestDate } from './domain/transactionLookup';
import type { HistoryLookupTarget } from './components/screens/HistoryScreen';
import type { StudentAccount } from './domain/student';
import { CloudStudentsPage } from './components/cloud/CloudStudentsPage';
import { CloudDayVendorsPage } from './components/cloud/CloudDayVendorsPage';

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
  const [historyLookupTarget, setHistoryLookupTarget] = useState<HistoryLookupTarget | null>(null);

  const handleSelectTab = useCallback((nextTab: string) => {
    if (nextTab !== 'history') {
      setHistoryLookupTarget(null);
    }
    setTab(nextTab);
  }, []);
  const [reportStudentFilter, setReportStudentFilter] = useState('');
  const [focusZone, setFocusZone] = useState('mode-order');
  const [showDashboard, setShowDashboard] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const online = useOnlineStatus();

  const storageHealthyRef = useRef(true);
  useEffect(() => { const health = checkStorageHealth(); storageHealthyRef.current = health.ok; }, []);

  const crashDraftRestored = useCrashDraftRecovery({ selectStudent, setPaidAmountText, changeMode });
  const [crashDraftRestoredState, setCrashDraftRestoredState] = useState(crashDraftRestored);

  // Ref: #281 — Extracted to usePinnedStudent hook
  const { picked, currentMode, currentPaidAmount } = usePinnedStudent(state, students);

  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const { undoCountdown, setUndoCountdown, lastCommittedTxIdRef, dismissFlash, handleUndo } = useUndoCountdown({
    dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel, operatorId: operatorUid,
  });

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

  const hasFlash = state.kind === 'success';
  const isStudentSelected = picked !== null && (state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing' || state.kind === 'error');
  const isExpenseFlow = state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note';

  // M1 K08：重複訂餐確認也是對話框，開著時背景的 Enter／方向鍵／Q W 都不處理，交給對話框。
  const isDialogOpen = cancelDialogOpen || noOrderDialogOpen || state.kind === 'duplicate_warning';

  useKeyboardShortcuts({
    enabled: tab === 'pos' && !hasFlash && !isExpenseFlow,
    changeMode, cancelOrder: openCancelConfirm, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone,
    isDialogOpen,
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

  const flowArgs = useMemo(() => ({
    state, picked, currentMode, currentPaidAmount, selectStudent,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, openCancelConfirm, openCancelConfirmForTx,
    handleDeleteOrder,
    onViewAllHistory: handleViewAllHistory,
  }), [state, picked, currentMode, currentPaidAmount, selectStudent,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, openCancelConfirm, openCancelConfirmForTx,
    handleDeleteOrder, handleViewAllHistory]);

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
      tab={tab} setTab={handleSelectTab} online={online} syncing={syncing} lastSync={lastSync}
      todayCount={todayCount} todayOtherCount={todayOtherCount} todayMenu={todayMenu} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate}
      queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount}
      onDashboard={() => setShowDashboard(true)}
      storageMode={fb ? 'cloud' : isPrototypeMode ? 'prototype' : 'local-only'}
      flashData={flashData} onDismissFlash={dismissFlash}
      onUndo={handleUndo} undoCountdown={undoCountdown}
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
      <AppRouter
        tab={tab}
        viewDate={viewDate}
        reportStudentFilter={reportStudentFilter}
        onClearStudentFilter={() => setReportStudentFilter('')}
        posColumnProps={posColumnProps}
        historyLookupTarget={historyLookupTarget}
        onConsumeHistoryLookupTarget={() => setHistoryLookupTarget(null)}
        onViewStudentHistory={handleViewAllHistory}
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

function CloudAppContent() {
  const { fb, fbError, access, lease } = useFirebase();
  const [cloudSection, setCloudSection] = useState<'students' | 'day-vendors'>('students');
  const [navigationLocked, setNavigationLocked] = useState(false);
  const navigationLockRef = useRef<{ identityKey: string; locked: boolean; revoked: boolean } | null>(null);
  const reportNavigationState = useCallback((identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => {
    let lock = navigationLockRef.current;
    if (!lock || lock.identityKey !== identityKey) {
      lock = { identityKey, locked: false, revoked: false };
    }
    if (state === 'revoked') {
      lock.revoked = true;
      lock.locked = true;
    } else if (state === 'recovering') {
      lock.locked = true;
    } else if (!lock.revoked) {
      lock.locked = false;
    }
    navigationLockRef.current = lock;
    setNavigationLocked(lock.locked);
  }, []);
  const selectSection = (section: 'students' | 'day-vendors') => {
    if (navigationLockRef.current?.locked) return;
    setCloudSection(section);
  };

  if (fbError) return <AppCrashPage />;
  if (!fb) {
    return <div className="app-loading" aria-label="載入中"><div className="app-loading-spinner" />載入中...</div>;
  }

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(error) => appendErrorLog({ source: 'react', message: error.message, stack: error.stack })}>
      <AuthGate auth={fb.auth} db={fb.db} access={access}>
        <main className="cloud-app" aria-label={cloudSection === 'students' ? '雲端學生管理' : '雲端日期與供應商管理'}>
          <h1>Talented EasyOrder</h1>
          <nav className="cloud-app__nav" aria-label="雲端資料管理">
            <button type="button" aria-pressed={cloudSection === 'students'} disabled={navigationLocked} onClick={() => selectSection('students')}>
              學生管理
            </button>
            <button type="button" aria-pressed={cloudSection === 'day-vendors'} disabled={navigationLocked} onClick={() => selectSection('day-vendors')}>
              日期與供應商
            </button>
          </nav>
          {cloudSection === 'students' ? (
            <CloudStudentsPage
              db={fb.db}
              leaseEpoch={lease.epoch}
              identityKey={access.ok ? `${access.profile.uid}:${lease.epoch}` : ''}
              onNavigationStateChange={reportNavigationState}
            />
          ) : (
            <CloudDayVendorsPage
              db={fb.db}
              leaseEpoch={lease.epoch}
              identityKey={access.ok ? `${access.profile.uid}:${lease.epoch}` : ''}
              onNavigationStateChange={reportNavigationState}
            />
          )}
        </main>
      </AuthGate>
    </ErrorBoundary>
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

