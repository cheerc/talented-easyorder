import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePosStore } from './store/posStore';
import { usePosFlow } from './hooks/usePosFlow';
import type { PosMode } from './domain/posFlow';
import { clearCrashDraft } from './storage/crashDraft';
import { checkStorageHealth } from './storage/storageHealth';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAppNavigationShortcuts } from './hooks/useAppNavigationShortcuts';
import { useSystemDate } from './hooks/useSystemDate';
import { useServiceWorkerCleanup } from './hooks/useServiceWorkerCleanup';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useCrashDraftRecovery } from './hooks/useCrashDraftRecovery';
import { useUndoCountdown } from './hooks/useUndoCountdown';
import { getOpeningCash } from './domain/cashClose';
import { MainLayout } from './components/MainLayout';
import { ErrorBoundary, AppCrashPage } from './components/ErrorBoundary';
import { AppRouter } from './components/AppRouter';
import { useAppState } from './hooks/useAppState';
import { useFlashData } from './hooks/useFlashData';
import { useFocusSync } from './hooks/useFocusSync';
import { useCancelDialog } from './hooks/useCancelDialog';
import { useTweaks } from './hooks/useTweaks';
import { buildPosColumnProps } from './hooks/usePosColumnProps';
import { ensureFirebaseInitialized } from './firebase/firebaseApp';
import { AuthGate } from './auth/AuthGate';
import { subscribeOperatorAccess } from './firebase/authService';
import type { OperatorAccess } from './firebase/authService';

export default function App() {
  const { systemDate, viewDate, setViewDate } = useSystemDate();
  const { auth, db } = ensureFirebaseInitialized();
  const [access, setAccess] = useState<OperatorAccess>({ ok: false, reason: 'signed_out' });

  useEffect(() => {
    const unsubscribe = subscribeOperatorAccess(auth, db, setAccess);
    return unsubscribe;
  }, [auth, db]);

  const app = useAppState(viewDate);
  const { students, allTx, todayMenu, vendors, setTodayMenu, setVendors, resetData,
    getBusinessDateStatus, cashSessions, dailySettlements, openCashSession, updateOpeningCash,
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
  const [lastSync, setLastSync] = useState('剛剛');
  const online = useOnlineStatus();

  const storageHealthyRef = useRef(true);
  useEffect(() => { const health = checkStorageHealth(); storageHealthyRef.current = health.ok; }, []);

  const crashDraftRestored = useCrashDraftRecovery({ selectStudent, setPaidAmountText, changeMode });
  const [crashDraftRestoredState, setCrashDraftRestoredState] = useState(crashDraftRestored);

  // Derive picked student — keep it pinned across committing/success so UI doesn't flash away
  const [pinnedStudentId, setPinnedStudentId] = useState<string | null>(null);
  const [pinnedMode, setPinnedMode] = useState<PosMode>('order');
  const [pinnedPaidAmount, setPinnedPaidAmount] = useState('');
  if (state.kind === 'student_selected' || state.kind === 'duplicate_warning') {
    if (pinnedStudentId !== state.studentId) setPinnedStudentId(state.studentId);
    const mode = state.kind === 'student_selected' ? state.mode : 'order';
    if (pinnedMode !== mode) setPinnedMode(mode);
    if (pinnedPaidAmount !== state.paidAmountText) setPinnedPaidAmount(state.paidAmountText);
  } else if (state.kind === 'committing') {
    if (pinnedStudentId !== state.studentId) setPinnedStudentId(state.studentId);
    if (pinnedMode !== state.mode) setPinnedMode(state.mode);
    if (pinnedPaidAmount !== state.paidAmountText) setPinnedPaidAmount(state.paidAmountText);
  } else if (state.kind === 'idle' && pinnedStudentId !== null) {
    setPinnedStudentId(null);
  }

  const picked = useMemo(() => {
    if (!pinnedStudentId) return null;
    return students.find(s => s.studentId === pinnedStudentId) ?? null;
  }, [students, pinnedStudentId]);

  const currentMode: PosMode = (state.kind === 'student_selected' || state.kind === 'committing')
    ? state.mode : (state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note')
      ? 'expense' : pinnedMode;

  const currentPaidAmount = state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing'
    ? state.paidAmountText : pinnedPaidAmount;

  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const { undoCountdown, setUndoCountdown, lastCommittedTxIdRef, dismissFlash, handleUndo } = useUndoCountdown({
    dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel,
  });

  const handleConfirm = useCallback(() => {
    if (state.kind === 'expense_input') {
      const n = Number(state.amountText);
      if (!Number.isSafeInteger(n) || n <= 0) return;
      confirmExpenseAmount(n); return;
    }
    if (state.kind === 'duplicate_warning') { confirmDuplicate(); return; }
    if (state.kind !== 'student_selected') return;
    requestConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, requestConfirm, confirmDuplicate, confirmExpenseAmount]);

  const { cancelDialogOpen, setCancelDialogOpen, noOrderDialogOpen, setNoOrderDialogOpen,
    openCancelConfirm, handleDeleteOrder } = useCancelDialog({ picked, allTx, viewDate });

  const commitTxIdRef = useRef<string | null>(null);
  const prevKindRef = useRef(state.kind);
  useEffect(() => {
    if (state.kind === 'committing' && commitTxIdRef.current === null) {
      commitTxIdRef.current = `tx-${Date.now()}`;
    }
    if (state.kind !== 'committing') commitTxIdRef.current = null;
    if (prevKindRef.current !== 'success' && state.kind === 'success') {
      setSyncing(true);
      const t = setTimeout(() => {
        setSyncing(false);
        setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 5));
      }, 800);
      const latestTx = usePosStore.getState().transactions[0];
      if (latestTx && latestTx.syncStatus === 'local') lastCommittedTxIdRef.current = latestTx.transactionId;
      clearCrashDraft();
      prevKindRef.current = state.kind;
      return () => {
        clearTimeout(t);
        if (lastCommittedTxIdRef.current) setTimeout(() => setUndoCountdown(5), 0);
      };
    }
    prevKindRef.current = state.kind;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  const hasFlash = state.kind === 'success';
  const isStudentSelected = picked !== null && (state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing');
  const isExpenseFlow = state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note';

  useKeyboardShortcuts({
    enabled: tab === 'pos' && !hasFlash && !isExpenseFlow,
    changeMode, cancelOrder: openCancelConfirm, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone,
    isDialogOpen: cancelDialogOpen || noOrderDialogOpen,
  });

  const { tweaks, setTweak } = useTweaks();

  useFocusSync(state, tab, setSearchText, setSearchFocusKey, setFocusZone);

  const isSuccess = state.kind === 'success';
  const stateAmountText = state.kind === 'expense_input' ? state.amountText : undefined;
  const stateAmount = (state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note') ? state.amount : undefined;
  const expenseProps = useMemo(() => {
    if (state.kind === 'expense_input') return { kind: 'expense_input' as const, amountText: stateAmountText || '', amount: 0 };
    if (state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note')
      return { kind: state.kind, amountText: '', amount: stateAmount || 0 };
    return null;
  }, [state.kind, stateAmountText, stateAmount]);

  const flashData = useFlashData({ isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, allTx });

  useAppNavigationShortcuts({
    tab, setTab, setShowDashboard,
    picked, expenseProps, currentMode, hasFlash, focusZone, setFocusZone,
    changeMode: changeMode as (m: PosMode) => void,
    cancelFlow, handleConfirm, setSearchText, setSearchFocusKey,
    cancelOrder: openCancelConfirm,
    isDialogOpen: cancelDialogOpen || noOrderDialogOpen,
  });

  const posColumnProps = buildPosColumnProps({
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
  });

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => console.error('[ErrorBoundary]', e)}>
    <AuthGate auth={auth} db={db} access={access}>
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
        todayMenu={todayMenu} viewDate={viewDate}
        reportStudentFilter={reportStudentFilter}
        onClearStudentFilter={() => setReportStudentFilter('')}
        setTodayMenu={setTodayMenu} vendors={vendors} students={students} resetData={resetData}
        openingCash={getOpeningCash(viewDate, dailySettlements || [], cashSessions[viewDate])}
        dateStatus={dateStatus} hasCashSession={!!cashSessions[viewDate]}
        openCashSession={openCashSession} updateOpeningCash={updateOpeningCash}
        tweaks={tweaks} setTweak={setTweak} setVendors={setVendors}
        posColumnProps={posColumnProps}
      />
    </MainLayout>
    </AuthGate>
    </ErrorBoundary>
  );
}
