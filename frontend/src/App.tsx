import { useState, useMemo, useEffect, useRef } from 'react';
import { usePosFlow } from './hooks/usePosFlow';
import type { PosMode } from './domain/posFlow';
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
import { useStudents, useTransactions, useMenu, useSessionActions } from './store/selectors';
import { useFlashData } from './hooks/useFlashData';
import { useFocusSync } from './hooks/useFocusSync';
import { useCancelDialog } from './hooks/useCancelDialog';
import { useTweaks } from './hooks/useTweaks';
import { usePosColumnProps } from './hooks/usePosColumnProps';
import { FirebaseProvider } from './providers/FirebaseProvider';
import { isConfigured as isFirebaseConfigured } from './firebase/firebaseApp';
import { useFirebase } from './hooks/useFirebase';
import { AuthGate } from './auth/AuthGate';
import { POS_DAILY_TX_DISPLAY_LIMIT } from './domain/constants';
import { SYSTEM_OPERATOR_ID } from './domain/operatorId';

function AppContent() {
  const { fb, fbError, access } = useFirebase();
  const { systemDate, viewDate, setViewDate } = useSystemDate();

  const { students } = useStudents();
  const { transactions: allTx } = useTransactions();
  const { todayMenu, vendors } = useMenu();
  const { getBusinessDateStatus } = useSessionActions();

  // Ref: #298 — Inline computations previously in useAppState.
  const tx = useMemo(() =>
    allTx.filter(t => t.businessDate === viewDate).reverse().slice(0, POS_DAILY_TX_DISPLAY_LIMIT),
  [allTx, viewDate]);
  const todayCount = useMemo(() => {
    const defaultBentoOrders = tx.filter(t =>
      t.type === 'order' &&
      t.menuNameSnapshot === todayMenu.itemName &&
      t.mealPrice === todayMenu.price &&
      (!t.note || !t.note.startsWith('單筆改價：'))
    );
    return defaultBentoOrders.length;
  }, [tx, todayMenu.itemName, todayMenu.price]);
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

  const [tab, setTab] = useState('pos');
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
    dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel,
  });

  // Ref: #281 — Extracted to useConfirmHandler hook
  const handleConfirm = useConfirmHandler({ state, requestConfirm, confirmDuplicate, confirmExpenseAmount });

  const { cancelDialogOpen, setCancelDialogOpen, noOrderDialogOpen, setNoOrderDialogOpen,
    openCancelConfirm, openCancelConfirmForTx, handleDeleteOrder } = useCancelDialog({ picked, allTx, viewDate, allStudents: students, selectStudent });

  // Ref: #281 — Extracted to useCommitLifecycle hook
  const { lastSync } = useCommitLifecycle({
    stateKind: state.kind,
    lastCommittedTxIdRef,
    setUndoCountdown,
    setSyncing,
  });

  const hasFlash = state.kind === 'success';
  const isStudentSelected = picked !== null && (state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing');
  const isExpenseFlow = state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note';

  useKeyboardShortcuts({
    enabled: tab === 'pos' && !hasFlash && !isExpenseFlow,
    changeMode, cancelOrder: openCancelConfirm, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone,
    isDialogOpen: cancelDialogOpen || noOrderDialogOpen,
  });

  const { tweaks } = useTweaks();

  useFocusSync(state, tab, setSearchText, setSearchFocusKey, setFocusZone);

  const isSuccess = state.kind === 'success';
  // Ref: #281 — Extracted to useExpenseProps hook
  const expenseProps = useExpenseProps(state);

  const flashData = useFlashData({ isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, allTx });

  useAppNavigationShortcuts({
    tab, setTab, setShowDashboard,
    picked, expenseProps, currentMode, hasFlash, focusZone, setFocusZone,
    changeMode: changeMode as (m: PosMode) => void,
    cancelFlow, handleConfirm, setSearchText, setSearchFocusKey,
    cancelOrder: openCancelConfirm,
    isDialogOpen: cancelDialogOpen || noOrderDialogOpen,
  });

  // Ref: #316 — Replaced inline 30-dep useMemo with usePosColumnProps hook.
  // Each useMemo group stabilizes a logical concern; the hook merges them.
  const dateArgs = useMemo(() => ({
    isHistorical, dateStatus, viewDate, systemDate, setViewDate,
  }), [isHistorical, dateStatus, viewDate, systemDate, setViewDate]);

  const flowArgs = useMemo(() => ({
    state, picked, currentMode, currentPaidAmount, selectStudent,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, openCancelConfirm, openCancelConfirmForTx,
    handleDeleteOrder,
    onViewHistory: () => { setReportStudentFilter(picked!.studentId); setTab('report'); },
  }), [state, picked, currentMode, currentPaidAmount, selectStudent,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, openCancelConfirm, openCancelConfirmForTx,
    handleDeleteOrder]);

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
    allTx, students, todayMenu, todayCount, vendors, tx, operatorUid, tweaks,
  }), [allTx, students, todayMenu, todayCount, vendors, tx, operatorUid, tweaks]);

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
      tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync}
      todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate}
      queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount}
      onDashboard={() => setShowDashboard(true)}
      flashData={flashData} onDismissFlash={dismissFlash}
      onUndo={handleUndo} undoCountdown={undoCountdown}
      cancelDialogOpen={cancelDialogOpen} picked={picked}
      orderTx={picked ? allTx.find(t => t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order') : null}
      onCancelDialogConfirm={(keepPaymentAsDeposit) => { handleDeleteOrder(keepPaymentAsDeposit); setCancelDialogOpen(false); cancelFlow(); }}
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

export default function App() {
  return (
    <FirebaseProvider>
      <AppContent />
    </FirebaseProvider>
  );
}

