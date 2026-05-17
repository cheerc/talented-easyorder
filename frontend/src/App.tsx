import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePosStore } from './store/posStore';
import { usePosFlow } from './hooks/usePosFlow';
import type { PosMode } from './domain/posFlow';
import type { StudentAccount } from './domain/student';
import { countActiveOrdersForStudent } from './domain/ledger';
import { saveCrashDraft, loadCrashDraft, clearCrashDraft } from './storage/crashDraft';
import { checkStorageHealth } from './storage/storageHealth';

import { TopBar, SearchBox, CustomerCard, ActionBar, IdleHero, ConfirmBanner, RecentStrip, DuplicateWarningBanner, MidnightBanner, ExpensePanel } from './components/pos-components';
import { ConfirmDialog } from './components/ui/ConfirmDialog';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ReportScreen, AdminScreen, VendorsScreen, HistoryScreen } from './components/screens';
import { TodayDashboard } from './components/TodayDashboard';
import { TweaksPanel, TweakSection, TweakRadio } from './components/tweaks-panel';
import { ErrorBoundary, AppCrashPage, SectionError } from './components/ErrorBoundary';
import { PwaInstallBanner } from './components/PwaInstallBanner';

export default function App() {
  const students = usePosStore((s) => s.students);
  const allTx = usePosStore((s) => s.transactions);
  const todayMenu = usePosStore((s) => s.todayMenu);
  const vendors = usePosStore((s) => s.vendors);
  const setTodayMenu = usePosStore((s) => s.setTodayMenu);
  const setVendors = usePosStore((s) => s.setVendors);
  const resetData = usePosStore((s) => s.resetData);
  const getBusinessDateStatus = usePosStore((s) => s.getBusinessDateStatus);

  const getSystemDate = () => new Date().toISOString().split('T')[0];
  const [systemDate, setSystemDate] = useState(getSystemDate);
  const [viewDate, setViewDate] = useState(systemDate);
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
    commitTransaction,
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
    if (state.kind !== 'student_selected' && state.kind !== 'duplicate_warning') return;
    if (state.kind === 'duplicate_warning') {
      confirmDuplicate();
      return;
    }
    requestConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, requestConfirm, confirmDuplicate, confirmExpenseAmount]);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  const openCancelConfirm = useCallback(() => {
    if (!picked) return;
    const orderTx = allTx.find(t =>
      t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
    );
    if (orderTx) setCancelDialogOpen(true);
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

  // After requestConfirm transitions to committing or duplicate_warning,
  // and after confirmDuplicate transitions to committing, fire commitTransaction
  useEffect(() => {
    if (state.kind === 'committing') {
      commitTransaction();
    }
  }, [state.kind, commitTransaction]);

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

  // Save crash draft when committing (before store mutation)
  useEffect(() => {
    if (state.kind !== 'committing') return;
    if (!storageHealthyRef.current) return;
    const sid = state.studentId;
    if (state.mode === 'expense') return; // expense doesn't need crash recovery
    if (!sid) return;
    const student = students.find(s => s.studentId === sid);
    if (!student) return;
    const mealPrice = state.mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
    const paidAmount = state.mode === 'payment' ? Number(state.paidAmountText || 0) : 0;
    const amount = state.mode === 'order' ? -mealPrice : (state.mode === 'payment' ? paidAmount : 0);
    const note =
      state.mode === 'order' && priceOverride !== null
        ? `單筆改價：${priceOverrideLabel.trim() || todayMenu.itemName}`
        : state.mode === 'order'
          ? todayMenu.itemName
          : state.mode === 'payment'
            ? '現金繳費'
            : '';
    const draft = {
      intent: {
        businessDate: viewDate,
        studentId: sid,
        type: state.mode,
        mealPrice,
        paidAmount,
        note,
        sourceDevice: 'pc' as const,
      },
      snapshots: {
        student: { studentId: sid, studentNameSnapshot: student.displayName },
        menu: { menuNameSnapshot: todayMenu.itemName, menuPriceSnapshot: mealPrice, vendorIdSnapshot: todayMenu.vendorId, vendorNameSnapshot: todayMenu.vendorNameSnapshot },
      },
      amount,
      expectedBalanceAfter: student.currentBalance + amount,
    };
    saveCrashDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  // Keyboard shortcuts for tab navigation (F-keys only)
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setTab('pos'); return; }
      if (e.key === 'F2') { e.preventDefault(); setTab('report'); return; }
      if (e.key === 'F3') { e.preventDefault(); setTab('admin'); return; }
      if (e.key === 'F4') { e.preventDefault(); setTab('vendors'); return; }
      if (e.key === 'F5') { e.preventDefault(); setTab('history'); return; }
      if (e.key === 'F6') { e.preventDefault(); setShowDashboard((v: boolean) => !v); return; }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  // POS keyboard shortcuts — Q/W/E + Enter/Escape + arrow navigation
  const hasFlash = state.kind === 'success';
  const isStudentSelected = picked !== null && (state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing');
  useKeyboardShortcuts({
    enabled: tab === 'pos' && !hasFlash,
    changeMode,
    cancelOrder: openCancelConfirm,
    isStudentSelected,
    handleConfirm,
    cancelFlow,
  });

  // Arrow key navigation for focus zones
  useEffect(() => {
    if (tab !== 'pos' || hasFlash || !picked) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      // Enter: handle focus zone confirm
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') cancelFlow();
        else if (focusZone === 'btn-confirm') handleConfirm();
        else if (focusZone.startsWith('mode-')) {
          const m = focusZone.replace('mode-', '') as PosMode;
          if (m === currentMode) {
            handleConfirm();
          } else {
            changeMode(m);
            setFocusZone('mode-' + m);
          }
        }
        return;
      }

      // Escape: cancel flow
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelFlow();
        return;
      }

      const modes = ['mode-order', 'mode-payment'];
      const i = modes.indexOf(focusZone);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (focusZone === 'btn-confirm') setFocusZone('btn-cancel');
        else if (focusZone === 'btn-cancel') setFocusZone('btn-cancel');
        else if (i > 0) { const m = modes[i - 1].replace('mode-', ''); setFocusZone(modes[i - 1]); changeMode(m as PosMode); }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') setFocusZone('btn-confirm');
        else if (focusZone === 'btn-confirm') setFocusZone('btn-confirm');
        else if (i >= 0 && i < 3) {
          const next = i + 1;
          const m = modes[next].replace('mode-', '');
          setFocusZone(modes[next]);
          changeMode(m as PosMode);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (i >= 0) setFocusZone('btn-confirm');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (focusZone === 'btn-confirm' || focusZone === 'btn-cancel') setFocusZone('mode-' + currentMode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, picked, hasFlash, currentMode, focusZone, handleConfirm, cancelFlow, changeMode]);

  const todayCount = tx.filter(t => t.type === 'order').length;
  const queuedCount = useMemo(() => allTx.filter(t => t.syncStatus === 'queued').length, [allTx]);
  const failedSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'failed').length, [allTx]);
  const conflictSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'conflict').length, [allTx]);

  const [tweaks, setTweaks] = useState({ theme: 'warm', fontSize: 'lg' });
  const setTweak = (k: string, v: string) => setTweaks(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    document.body.setAttribute('data-fs', tweaks.fontSize);
    document.body.setAttribute('data-theme', tweaks.theme);
  }, [tweaks]);

  // Build flash data from success state
  const isSuccess = state.kind === 'success';
  const flashData = useMemo(() => {
    if (!isSuccess || !picked) return null;
    const amt = Number(currentPaidAmount || 0);
    const mealPrice = currentMode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
    return {
      id: flashKey,
      name: picked.displayName,
      sid: picked.studentId,
      detail: currentMode === 'order' ? `訂餐: ${todayMenu.itemName}` + (amt > 0 ? `, 收現 ${amt}` : '') :
              currentMode === 'payment' ? `繳費: 收現 ${amt}` :
                `支出: ${mealPrice}`,
      amount: amt - mealPrice,
      after: picked.currentBalance + (amt - mealPrice),
    };
  }, [isSuccess, picked, currentMode, currentPaidAmount, todayMenu, flashKey, priceOverride]);

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => console.error('[ErrorBoundary]', e)}>
    <div className="app">
      <TopBar tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync} todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate} queuedCount={queuedCount} failedSyncCount={failedSyncCount} conflictSyncCount={conflictSyncCount} onDashboard={() => setShowDashboard(true)} />

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
                {(state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note') ? (
                  <ExpensePanel
                    kind={state.kind}
                    amountText={(state as { amountText?: string }).amountText ?? ''}
                    amount={(state as { amount?: number }).amount ?? 0}
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
                      focusKey={0}
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
                {(state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note') ? (
                  <ExpensePanel
                    kind={state.kind}
                    amountText={(state as { amountText?: string }).amountText ?? ''}
                    amount={(state as { amount?: number }).amount ?? 0}
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
            <div className="card side-menu">
              <div className="recent-head">本日便當</div>
              <div style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.01em', marginTop: '4px' }}>{todayMenu.itemName}</div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', marginTop: '8px' }}>
                <span className="mono" style={{ fontSize: '24px', fontWeight: 600 }}>${Math.abs(todayMenu.price)}</span>
                <span style={{ fontSize: '12px', color: 'var(--ink-3)' }}>{todayMenu.vendorNameSnapshot}</span>
              </div>
              <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--ink-2)' }}>
                已訂 <span className="mono" style={{ fontSize: '20px', fontWeight: 600, color: 'var(--ink)' }}>{todayCount}</span> 份
              </div>
            </div>
            <RecentStrip recent={tx.slice().reverse().map((t, i) => ({ ...t, uid: i + '-' + t.createdAt }))} />
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
        <AdminScreen todayMenu={todayMenu} setTodayMenu={setTodayMenu} vendors={vendors} students={students} resetData={resetData} />
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


      <ConfirmBanner flash={flashData} onDismiss={dismissFlash} onUndo={handleUndo} undoCountdown={undoCountdown} />

      <ConfirmDialog
        open={cancelDialogOpen}
        title="取消訂餐"
        message={`確定要取消 ${picked?.displayName ?? ''} 的訂餐嗎？`}
        confirmLabel="確認取消"
        cancelLabel="返回"
        variant="danger"
        onConfirm={() => {
          handleDeleteOrder();
          setCancelDialogOpen(false);
        }}
        onCancel={() => setCancelDialogOpen(false)}
      />

      <ConfirmDialog
        open={cancelDialogOpen}
        title="取消訂餐"
        message={`確定要取消 ${picked?.displayName ?? ''} 的訂餐嗎？`}
        confirmLabel="確認取消"
        cancelLabel="返回"
        variant="danger"
        onConfirm={() => {
          handleDeleteOrder();
          setCancelDialogOpen(false);
        }}
        onCancel={() => setCancelDialogOpen(false)}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="顯示">
          <TweakRadio label="主題" value={tweaks.theme}
            onChange={v => setTweak('theme', v)}
            options={[
              { value: 'light', label: '亮色' },
              { value: 'dark', label: '深色' },
              { value: 'warm', label: '暖色' },
            ]} />
          <TweakRadio label="字體大小" value={tweaks.fontSize}
            onChange={v => setTweak('fontSize', v)}
            options={[
              { value: 'md', label: '普通' },
              { value: 'lg', label: '大字' },
            ]} />
        </TweakSection>
      </TweaksPanel>

      {showDashboard && <TodayDashboard onClose={() => setShowDashboard(false)} />}
      <PwaInstallBanner />
    </div>
    </ErrorBoundary>
  );
}
