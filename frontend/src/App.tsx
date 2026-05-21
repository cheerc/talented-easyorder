import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePosStore } from './store/posStore';
import { usePosFlow } from './hooks/usePosFlow';
import type { PosMode } from './domain/posFlow';
import type { StudentAccount } from './domain/student';
import { countActiveOrdersForStudent } from './domain/ledger';
import { loadCrashDraft, clearCrashDraft } from './storage/crashDraft';
import { checkStorageHealth } from './storage/storageHealth';

import { SearchBox, CustomerCard, ActionBar, IdleHero, RecentStrip, DuplicateWarningBanner, MidnightBanner, ExpensePanel } from './components/pos-components';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useAppNavigationShortcuts } from './hooks/useAppNavigationShortcuts';
import { ReportScreen, AdminScreen, VendorsScreen, HistoryScreen } from './components/screens';
import { getOpeningCash } from './domain/cashClose';
import { MainLayout } from './components/MainLayout';
import { ErrorBoundary, AppCrashPage, SectionError } from './components/ErrorBoundary';

export default function App() {
  const students = usePosStore((s) => s.students);
  const allTx = usePosStore((s) => s.transactions);
  const todayMenu = usePosStore((s) => s.todayMenu);
  const vendors = usePosStore((s) => s.vendors);
  const setTodayMenu = usePosStore((s) => s.setTodayMenu);
  const setVendors = usePosStore((s) => s.setVendors);
  const resetData = usePosStore((s) => s.resetData);
  const getBusinessDateStatus = usePosStore((s) => s.getBusinessDateStatus);
  const cashSessions = usePosStore((s) => s.cashSessions);
  const dailySettlements = usePosStore((s) => s.dailySettlements as import('./domain/cashClose').DailySettlement[]);
  const openCashSession = usePosStore((s) => s.openCashSession);
  const updateOpeningCash = usePosStore((s) => s.updateOpeningCash);

  const getSystemDate = () => new Date().toISOString().split('T')[0];
  const [systemDate, setSystemDate] = useState(getSystemDate);
  const [viewDate, setViewDate] = useState(systemDate);
  const dateStatus = getBusinessDateStatus(viewDate);
  const isHistorical = viewDate !== systemDate;
  const [priceOverride, setPriceOverride] = useState<number | null>(null);
  const [priceOverrideLabel, setPriceOverrideLabel] = useState('');

  useEffect(() => {
    const tick = setInterval(() => setSystemDate(getSystemDate()), 60_000);
    const onVisible = () => setSystemDate(getSystemDate());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const tx = useMemo(() => {
    return allTx.filter(t => t.businessDate === viewDate).reverse();
  }, [allTx, viewDate]);

  const {
    state,
    setSearchText,
    selectStudent,
    changeMode,
    setPaidAmountText,
    requestConfirm,
    confirmDuplicate,
    cancelFlow,
    dismissSuccess,
    enterExpenseMode,
    updateExpenseAmount,
    confirmExpenseAmount,
    selectExpenseDirection,
    selectExpenseReason,
    updateExpenseNote,
    confirmExpenseNote,
  } = usePosFlow({ businessDate: viewDate, isHistorical, priceOverride, priceOverrideLabel });

  const [tab, setTab] = useState('pos');
  const [reportStudentFilter, setReportStudentFilter] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [focusZone, setFocusZone] = useState('mode-order');
  const [showDashboard, setShowDashboard] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('剛剛');
  const [online, setOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Check storage health on mount (deferred to avoid setState-in-effect)
  const storageHealthyRef = useRef(true);
  useEffect(() => {
    const health = checkStorageHealth();
    storageHealthyRef.current = health.ok;
  }, []);

  // Restore crash draft on mount if available
  const [crashDraftRestored, setCrashDraftRestored] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadCrashDraft();
      if (cancelled || !draft) return;
      // Apply draft back to store state
      const student = students.find(s => s.studentId === draft.intent.studentId);
      if (student) {
        selectStudent(draft.intent.studentId, 'manual');
        if (draft.intent.paidAmount > 0) {
          setPaidAmountText(String(draft.intent.paidAmount));
        }
        if (draft.intent.type !== 'order') {
          changeMode(draft.intent.type);
        }
      }
      setCrashDraftRestored(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive picked student — keep it pinned across committing/success so the UI doesn't flash away
  const [pinnedStudentId, setPinnedStudentId] = useState<string | null>(null);
  const [pinnedMode, setPinnedMode] = useState<PosMode>('order');
  const [pinnedPaidAmount, setPinnedPaidAmount] = useState('');

  // Update pinned data whenever state provides new information
  if (state.kind === 'student_selected' || state.kind === 'duplicate_warning') {
    if (pinnedStudentId !== state.studentId) {
      setPinnedStudentId(state.studentId);
    }
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
    ? state.mode
    : (state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note')
      ? 'expense'
      : pinnedMode;

  const currentPaidAmount = state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing'
    ? state.paidAmountText
    : pinnedPaidAmount;

  const orderedTodayCount = useMemo(() => {
    if (!picked) return 0;
    return countActiveOrdersForStudent(allTx, picked.studentId, viewDate);
  }, [picked, allTx, viewDate]);

  const suggestions = useMemo(() => {
    const query = state.kind === 'idle' ? state.searchText : '';
    if (!query) return [];
    const q = query.toLowerCase();
    return students.filter(s => s.studentId.includes(q) || s.displayName.toLowerCase().includes(q));
  }, [state, students]);

  const choose = (s: StudentAccount) => {
    selectStudent(s.studentId, 'manual');
    setFocusZone('mode-order');
  };

  const submitSearch = () => {
    if (suggestions.length > 0) choose(suggestions[activeIdx]);
  };

  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const lastCommittedTxIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (undoCountdown <= 0) {
      if (undoCountdown === 0) lastCommittedTxIdRef.current = null;
      return;
    }
    const t = setTimeout(() => setUndoCountdown(n => {
      const next = n - 1;
      if (next <= 0) lastCommittedTxIdRef.current = null;
      return Math.max(0, next);
    }), 1000);
    return () => clearTimeout(t);
  }, [undoCountdown]);

  const dismissFlash = useCallback(() => {
    dismissSuccess();
    setFlashKey(k => k + 1);
    setSyncing(false);
    setUndoCountdown(0);
    lastCommittedTxIdRef.current = null;
    setPriceOverride(null);
    setPriceOverrideLabel('');
  }, [dismissSuccess]);

  const handleUndo = useCallback(() => {
    const txId = lastCommittedTxIdRef.current;
    if (!txId) return;
    usePosStore.getState().deleteTransaction(txId);
    lastCommittedTxIdRef.current = null;
    setUndoCountdown(0);
    dismissFlash();
  }, [dismissFlash]);

  const handleConfirm = useCallback(() => {
    if (state.kind === 'expense_input') {
      const n = Number(state.amountText);
      if (Number.isFinite(n) && n > 0) confirmExpenseAmount(n);
      return;
    }
    if (state.kind === 'duplicate_warning') {
      confirmDuplicate();
      return;
    }
    if (state.kind !== 'student_selected') return;
    requestConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, requestConfirm, confirmDuplicate, confirmExpenseAmount]);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [noOrderDialogOpen, setNoOrderDialogOpen] = useState(false);

  const openCancelConfirm = useCallback(() => {
    if (!picked) return;
    const orderTx = allTx.find(t =>
      t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
    );
    if (orderTx) {
      setCancelDialogOpen(true);
    } else {
      setNoOrderDialogOpen(true);
    }
  }, [picked, viewDate, allTx]);

  const handleDeleteOrder = useCallback(() => {
    if (!picked) return;
    const store = usePosStore.getState();
    store.deleteOrderWithRefundCheck(
      store.transactions.find(t =>
        t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
      )?.transactionId ?? ''
    );
  }, [picked, viewDate]);

  // Wire commit success → undo countdown start + lastCommittedTxId tracking
  const commitTxIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (state.kind === 'committing' && commitTxIdRef.current === null) {
      commitTxIdRef.current = `tx-${Date.now()}`;
    }
    if (state.kind !== 'committing') {
      commitTxIdRef.current = null;
    }
  }, [state.kind]);

  // Show syncing animation after commit + start undo countdown
  const prevKindRef = useRef(state.kind);
  useEffect(() => {
    if (prevKindRef.current !== 'success' && state.kind === 'success') {
      setSyncing(true);
      const t = setTimeout(() => {
        setSyncing(false);
        setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 5));
      }, 800);

      // Start undo countdown via ref to avoid setState-in-effect lint
      const allTx = usePosStore.getState().transactions;
      const latestTx = allTx[0];
      if (latestTx && latestTx.syncStatus === 'local') {
        lastCommittedTxIdRef.current = latestTx.transactionId;
      }

      // Clear crash draft after successful commit
      clearCrashDraft();

      prevKindRef.current = state.kind;
      return () => {
        clearTimeout(t);
        // Defer setState to avoid sync-set-in-effect
        if (lastCommittedTxIdRef.current) {
          setTimeout(() => setUndoCountdown(5), 0);
        }
      };
    }
    prevKindRef.current = state.kind;
  }, [state.kind]);

  const hasFlash = state.kind === 'success';
  const isStudentSelected = picked !== null && (state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing');
  const isExpenseFlow = state.kind === 'expense_input' || state.kind === 'expense_direction'
    || state.kind === 'expense_reason' || state.kind === 'expense_other_note';

  const selectedMode = state.kind === 'student_selected' ? state.mode : undefined;

  // Synchronize focusZone with state mode when student selection state changes
  useEffect(() => {
    if (state.kind === 'student_selected') {
      setFocusZone('mode-' + state.mode);
    }
  }, [state.kind, selectedMode]);

  // POS keyboard shortcuts — Q/W/E + Enter/Escape
  useKeyboardShortcuts({
    enabled: tab === 'pos' && !hasFlash && !isExpenseFlow,
    changeMode,
    cancelOrder: openCancelConfirm,
    isStudentSelected,
    handleConfirm,
    cancelFlow,
    enterExpenseMode,
    setFocusZone,
    isDialogOpen: cancelDialogOpen || noOrderDialogOpen,
  });

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

  const [tweaks, setTweaks] = useState({ theme: 'warm', fontSize: 'lg' });
  const setTweak = (k: string, v: string) => setTweaks(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    document.body.setAttribute('data-fs', tweaks.fontSize);
    document.body.setAttribute('data-theme', tweaks.theme);
  }, [tweaks]);

  // 任何時候回到 idle 介面，或切換回櫃台且為 idle 時，都要離開焦點，並清空搜尋內容
  // 並且在處於非 idle 狀態時，提前將 searchFocusKey 重置為 0，避免回到 idle 時 SearchBox 自動聚焦
  useEffect(() => {
    if (state.kind === 'idle' && tab === 'pos') {
      (document.activeElement as HTMLElement)?.blur();
      setSearchText('');
      setSearchFocusKey(0);
    } else if (state.kind !== 'idle') {
      setSearchFocusKey(0);
    }
  }, [state.kind, tab, setSearchText]);

  // Derived expense props for ExpensePanel — type-narrowed, no `as` cast
  const expenseProps = (() => {
    if (state.kind === 'expense_input') {
      return { kind: 'expense_input' as const, amountText: state.amountText, amount: 0 };
    }
    if (state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note') {
      return { kind: state.kind, amountText: '', amount: state.amount };
    }
    return null;
  })();
  const isSuccess = state.kind === 'success';
  const flashData = useMemo(() => {
    if (!isSuccess || !picked) {
      // F4-2: expense mode — picked is null, generate virtual flashData
      if (isSuccess && !picked) {
        const latestExpense = allTx.find(t => t.studentId === '__cashier__' && t.type === 'expense');
        if (!latestExpense) return null;
        const counterNetCash = allTx
          .filter(t => t.studentId === '__cashier__' && t.type === 'expense')
          .reduce((sum, t) => sum + (t.paidAmount > 0 ? t.paidAmount : -t.mealPrice), 0);
        const isIncome = latestExpense.paidAmount > 0;
        return {
          id: flashKey,
          name: '櫃台',
          sid: '',
          detail: isIncome
            ? `收入: ${latestExpense.note} +$${latestExpense.paidAmount}`
            : `支出: ${latestExpense.note} −$${latestExpense.mealPrice}`,
          amount: isIncome ? latestExpense.paidAmount : -latestExpense.mealPrice,
          after: counterNetCash,
        };
      }
      return null;
    }
    const amt = Number(currentPaidAmount || 0);
    const mealPrice = currentMode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
    return {
      id: flashKey,
      name: picked.displayName,
      sid: picked.studentId,
      detail: currentMode === 'order' ? `訂餐: ${todayMenu.itemName}` + (amt > 0 ? `, 收現 ${amt}` : '') :
              currentMode === 'payment' ? `繳費: 收現 ${amt}` :
                '',
      amount: amt - mealPrice,
      after: picked.currentBalance,
    };
  }, [isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride, allTx]);

  // Keyboard shortcuts: F-keys + digit auto-focus + arrow navigation
  useAppNavigationShortcuts({
    tab, setTab, setShowDashboard,
    picked, expenseProps, currentMode, hasFlash, focusZone, setFocusZone,
    changeMode: changeMode as (m: PosMode) => void,
    cancelFlow, handleConfirm, setSearchText, setSearchFocusKey,
    cancelOrder: openCancelConfirm,
    isDialogOpen: cancelDialogOpen || noOrderDialogOpen,
  });

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => console.error('[ErrorBoundary]', e)}>
    <MainLayout
      tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync}
      todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate}
      queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount}
      onDashboard={() => setShowDashboard(true)}
      flashData={flashData} onDismissFlash={dismissFlash}
      onUndo={handleUndo} undoCountdown={undoCountdown}
      cancelDialogOpen={cancelDialogOpen} picked={picked}
      onCancelDialogConfirm={() => {
        handleDeleteOrder();
        setCancelDialogOpen(false);
        cancelFlow();
      }}
      onCancelDialogCancel={() => setCancelDialogOpen(false)}
      noOrderDialogOpen={noOrderDialogOpen}
      onNoOrderDialogClose={() => setNoOrderDialogOpen(false)}
      showDashboard={showDashboard} onCloseDashboard={() => setShowDashboard(false)}
    >
      {tab === 'pos' && (
        <div className="main">
          <div className="col-main">
            {!isHistorical && !(state.kind === 'historical_readonly') && getBusinessDateStatus(viewDate) !== 'closed' && viewDate !== systemDate && (
              <MidnightBanner viewDate={viewDate} systemDate={systemDate} onSwitchToToday={() => setViewDate(systemDate)} />
            )}
            {isHistorical || state.kind === 'historical_readonly' || getBusinessDateStatus(viewDate) === 'closed' ? (
              <div className="historical-lock" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--c-text-dim)', textAlign: 'center' }}>
                <h2 style={{ color: 'var(--c-warn)', fontSize: '1.5rem', marginBottom: '8px' }}>目前檢視歷史紀錄</h2>
                <p style={{ marginBottom: '24px' }}>您正在檢視 {viewDate} 的資料。<br />為確保帳務正確，歷史紀錄模式下已暫停結帳與訂餐功能。</p>
                <button className="btn-confirm" onClick={() => setViewDate(systemDate)}>返回今日</button>
              </div>
            ) : !picked ? (
              <>
                {expenseProps ? (
                  <ExpensePanel
                    kind={expenseProps.kind}
                    amountText={expenseProps.amountText}
                    amount={expenseProps.amount}
                    onAmountChange={updateExpenseAmount}
                    onAmountConfirm={confirmExpenseAmount}
                    onDirectionSelect={selectExpenseDirection}
                    onReasonSelect={selectExpenseReason}
                    onNoteChange={updateExpenseNote}
                    onNoteConfirm={confirmExpenseNote}
                    onCancel={cancelFlow}
                  />
                ) : (
                  <>
                    {crashDraftRestored && (
                      <div className="midnight-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--r)', marginBottom: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--accent-ink)' }}>偵測到未完成交易草稿，已自動恢復</span>
                        <button className="ghost-btn" style={{ fontSize: '12px' }} onClick={() => setCrashDraftRestored(false)}>關閉</button>
                      </div>
                    )}
                    <SearchBox
                      value={state.kind === 'idle' ? state.searchText : ''}
                      onChange={(v) => { setSearchText(v); setActiveIdx(0); }}
                      onSubmit={submitSearch}
                      onEsc={() => { setSearchText(''); setActiveIdx(0); }}
                      suggestions={suggestions}
                      activeIdx={activeIdx}
                      onPick={choose}
                      onHover={setActiveIdx}
                      focusKey={searchFocusKey}
                      disabled={hasFlash}
                    />
                    <IdleHero
                      todayMenu={todayMenu}
                      todayCount={todayCount}
                      vendorPhone={vendors.find(v => v.name === todayMenu.vendorNameSnapshot)?.phone}
                      onEnterExpense={enterExpenseMode}
                      queueHint={`全鍵盤操作 · 平均處理 4.2 秒/人`} />
                  </>
                )}
              </>
            ) : (
              <>
                {expenseProps ? (
                  <ExpensePanel
                    kind={expenseProps.kind}
                    amountText={expenseProps.amountText}
                    amount={expenseProps.amount}
                    onAmountChange={updateExpenseAmount}
                    onAmountConfirm={confirmExpenseAmount}
                    onDirectionSelect={selectExpenseDirection}
                    onReasonSelect={selectExpenseReason}
                    onNoteChange={updateExpenseNote}
                    onNoteConfirm={confirmExpenseNote}
                    onCancel={cancelFlow}
                  />
                ) : (
                  <CustomerCard
                    student={picked}
                    todayMenu={todayMenu}
                    mode={currentMode}
                    orderedTodayCount={orderedTodayCount}
                    payAmount={currentPaidAmount}
                    setPayAmount={setPaidAmountText}
                    onViewHistory={() => {
                      setReportStudentFilter(picked!.studentId);
                      setTab('report');
                    }}
                    priceOverride={priceOverride}
                    priceOverrideLabel={priceOverrideLabel}
                    setPriceOverride={setPriceOverride}
                    setPriceOverrideLabel={setPriceOverrideLabel}
                    onDeleteOrder={handleDeleteOrder}
                  />
                )}
                {state.kind === 'duplicate_warning' && (
                  <DuplicateWarningBanner
                    orderedTodayCount={orderedTodayCount}
                    onConfirm={handleConfirm}
                    onCancel={cancelFlow}
                  />
                )}
                <ActionBar
                  mode={currentMode}
                  setMode={(m) => {
                    changeMode(m as PosMode);
                    setFocusZone('mode-' + m);
                  }}
                  onDeleteOrder={openCancelConfirm}
                  focusZone={focusZone}
                  onConfirm={handleConfirm}
                  onCancel={cancelFlow}
                />
              </>
            )}
          </div>
          <div className="col-side">
            <RecentStrip
              recent={tx.slice().reverse().map((t, i) => ({ ...t, uid: i + '-' + t.createdAt }))}
              onItemClick={!isHistorical && getBusinessDateStatus(viewDate) !== 'closed' ? (sid) => selectStudent(sid, 'manual') : undefined}
            />
          </div>
        </div>
      )}

      {tab === 'report' && (
        <ErrorBoundary fallback={<SectionError name="報表" />}>
        <ReportScreen
          todayMenu={todayMenu}
          viewDate={viewDate}
          studentFilter={reportStudentFilter}
          onClearStudentFilter={() => setReportStudentFilter('')}
        />
        </ErrorBoundary>
      )}
      {tab === 'admin' && (
        <ErrorBoundary fallback={<SectionError name="今日設定" />}>
        <AdminScreen
          todayMenu={todayMenu}
          setTodayMenu={setTodayMenu}
          vendors={vendors}
          students={students}
          resetData={resetData}
          openingCash={getOpeningCash(viewDate, dailySettlements || [], cashSessions[viewDate])}
          dateStatus={dateStatus}
          hasCashSession={!!cashSessions[viewDate]}
          onOpeningCashChange={(amount) => openCashSession({ businessDate: viewDate, openingCash: amount, operatorId: 'admin', openedAt: new Date().toISOString() })}
          onUpdateOpeningCash={(amount) => updateOpeningCash(viewDate, amount)}
          tweaks={tweaks} setTweak={setTweak}
        />
        </ErrorBoundary>
      )}
      {tab === 'vendors' && (
        <ErrorBoundary fallback={<SectionError name="供應商" />}>
        <VendorsScreen vendors={vendors} setVendors={setVendors} />
        </ErrorBoundary>
      )}
      {tab === 'history' && (
        <ErrorBoundary fallback={<SectionError name="歷史紀錄" />}>
        <HistoryScreen />
        </ErrorBoundary>
      )}


    </MainLayout>
    </ErrorBoundary>
  );
}
