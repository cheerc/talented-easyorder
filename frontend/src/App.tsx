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
import { useAppState } from './hooks/useAppState';
import { useFlashData } from './hooks/useFlashData';
import { useFocusSync } from './hooks/useFocusSync';
import { useCancelDialog } from './hooks/useCancelDialog';
import { useTweaks } from './hooks/useTweaks';
import { buildPosColumnProps } from './hooks/usePosColumnProps';
import { FirebaseProvider } from './providers/FirebaseProvider';
import { useFirebase } from './hooks/useFirebase';
import { AuthGate } from './auth/AuthGate';

function AppContent() {
  const { fb, fbError, access } = useFirebase();
  const { systemDate, viewDate, setViewDate } = useSystemDate();

  const app = useAppState(viewDate);
  const { students, allTx, todayMenu, vendors,
    getBusinessDateStatus,
    tx, todayCount, queuedCount, failedSyncCount, conflictSyncCount } = app;

  const dateStatus = getBusinessDateStatus(viewDate);
  const isHistorical = viewDate !== systemDate;
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
    openCancelConfirm, handleDeleteOrder } = useCancelDialog({ picked, allTx, viewDate });

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

  const posColumnProps = useMemo(() => buildPosColumnProps({
    state, isHistorical, dateStatus, viewDate, systemDate, setViewDate,
    picked, currentMode, currentPaidAmount, allTx, students, selectStudent,
    expenseProps,
    updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection, selectExpenseReason,
    updateExpenseNote, confirmExpenseNote,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, setFocusZone, focusZone, openCancelConfirm,
    setSearchText, searchFocusKey, hasFlash,
    crashDraftRestored: crashDraftRestoredState, setCrashDraftRestored: setCrashDraftRestoredState,
    todayMenu, todayCount, vendors, enterExpenseMode, tweaks,
    tx, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel,
    handleDeleteOrder,
    onViewHistory: () => { setReportStudentFilter(picked!.studentId); setTab('report'); },
  }), [state, isHistorical, dateStatus, viewDate, systemDate, setViewDate,
    picked, currentMode, currentPaidAmount, allTx, students, selectStudent,
    expenseProps,
    updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection, selectExpenseReason,
    updateExpenseNote, confirmExpenseNote,
    setPaidAmountText, handleConfirm, cancelFlow, changeMode, setFocusZone, focusZone, openCancelConfirm,
    setSearchText, searchFocusKey, hasFlash,
    crashDraftRestoredState, setCrashDraftRestoredState,
    todayMenu, todayCount, vendors, enterExpenseMode, tweaks,
    tx, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel,
    handleDeleteOrder]);

  if (fbError) {
    return <AppCrashPage />;
  }
  if (!fb) {
    return <div className="app-loading" aria-label="載入中">載入中...</div>;
  }

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => appendErrorLog({ source: 'react', message: e.message, stack: e.stack })}>
    <AuthGate auth={fb.auth} db={fb.db} access={access}>
    <MainLayout
      tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync}
      todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate}
      queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount}
      onDashboard={() => setShowDashboard(true)}
      flashData={flashData} onDismissFlash={dismissFlash}
      onUndo={handleUndo} undoCountdown={undoCountdown}
      cancelDialogOpen={cancelDialogOpen} picked={picked}
      onCancelDialogConfirm={() => { handleDeleteOrder(); setCancelDialogOpen(false); cancelFlow(); }}
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

