import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePosStore } from './store/posStore';
import { usePosFlow } from './hooks/usePosFlow';
import type { PosMode } from './domain/posFlow';
import type { StudentAccount } from './domain/student';
import { countActiveOrdersForStudent } from './domain/ledger';

import { TopBar, SearchBox, CustomerCard, ActionBar, IdleHero, ConfirmBanner, RecentStrip, DuplicateWarningBanner, MidnightBanner } from './components/pos-components';
import { ReportScreen, AdminScreen, VendorsScreen, HistoryScreen } from './components/screens';
import { TodayDashboard } from './components/TodayDashboard';
import { TweaksPanel, TweakSection, TweakRadio } from './components/tweaks-panel';
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

  const getSystemDate = () => new Date().toISOString().split('T')[0];
  const [systemDate, setSystemDate] = useState(getSystemDate);
  const [viewDate, setViewDate] = useState(systemDate);
  const isHistorical = viewDate !== systemDate;

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
  } = usePosFlow({ businessDate: viewDate, isHistorical });

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

  const currentMode: PosMode = state.kind === 'student_selected' || state.kind === 'committing'
    ? state.mode
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
  }, [dismissSuccess]);

  const handleUndo = useCallback(() => {
    const txId = lastCommittedTxIdRef.current;
    if (!txId) return;
    usePosStore.getState().hardDeleteLocalDraft({
      transactionId: txId,
      reason: '操作者復原 (undo)',
      operatorId: 'op-pos',
    });
    lastCommittedTxIdRef.current = null;
    setUndoCountdown(0);
    dismissFlash();
  }, [dismissFlash]);

  const handleConfirm = useCallback(() => {
    if (state.kind !== 'student_selected' && state.kind !== 'duplicate_warning') return;
    if (state.kind === 'duplicate_warning') {
      confirmDuplicate();
      return;
    }
    requestConfirm();
  }, [state.kind, requestConfirm, confirmDuplicate]);

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

  // Keyboard shortcuts for tab navigation
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

  // POS keyboard shortcuts (when student is selected)
  const hasFlash = state.kind === 'success';
  useEffect(() => {
    if (tab !== 'pos' || hasFlash) return;
    if (!picked) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const keys = ['q', 'w', 'e', 'r', 'Q', 'W', 'E', 'R'];

      if (e.target.tagName === 'INPUT' && e.target.type !== 'radio') {
        if (e.key === 'Escape') {
          e.target.blur();
          cancelFlow();
          return;
        }
        if (e.key === 'Enter') {
          handleConfirm();
          return;
        }
        if (keys.includes(e.key)) {
          e.target.blur();
        } else {
          return;
        }
      }

      if (keys.includes(e.key)) {
        const key = e.key.toLowerCase();
        const map: Record<string, PosMode> = { 'q': 'order', 'w': 'topup', 'e': 'cancel' };
        if (key === 'e' && orderedTodayCount === 0) return;
        e.preventDefault();
        const m = map[key];
        changeMode(m);
        setFocusZone('mode-' + m);
        return;
      }

      const modes = ['mode-order', 'mode-topup', 'mode-cancel'];
      const i = modes.indexOf(focusZone);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (focusZone === 'btn-confirm') setFocusZone('btn-cancel');
        else if (focusZone === 'btn-cancel') setFocusZone('btn-cancel');
        else if (i > 0) setFocusZone(modes[i - 1]);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') setFocusZone('btn-confirm');
        else if (focusZone === 'btn-confirm') setFocusZone('btn-confirm');
        else if (i >= 0 && i < 3) {
          let next = i + 1;
          if (modes[next] === 'mode-cancel' && orderedTodayCount === 0) next = i;
          setFocusZone(modes[next]);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (i >= 0) setFocusZone('btn-confirm');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (focusZone === 'btn-confirm' || focusZone === 'btn-cancel') setFocusZone('mode-' + currentMode);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') cancelFlow();
        else if (focusZone === 'btn-confirm') handleConfirm();
        else if (focusZone.startsWith('mode-')) {
          const m = focusZone.replace('mode-', '') as PosMode;
          if (m === 'cancel' && orderedTodayCount === 0) return;
          if (m === currentMode) {
            handleConfirm();
          } else {
            changeMode(m);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (state.kind === 'duplicate_warning') cancelFlow();
        else cancelFlow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, picked, hasFlash, currentMode, orderedTodayCount, focusZone, state.kind, handleConfirm, cancelFlow, changeMode]);

  const todayCount = tx.reduce((acc, t) => acc + ((t.mealPrice || 0) / todayMenu.price), 0);
  const queuedCount = useMemo(() => allTx.filter(t => t.syncStatus === 'queued').length, [allTx]);

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
    const mealPrice = currentMode === 'order' ? todayMenu.price : 0;
    return {
      id: flashKey,
      name: picked.displayName,
      sid: picked.studentId,
      detail: currentMode === 'order' ? `訂餐: ${todayMenu.itemName}` + (amt > 0 ? `, 收現 ${amt}` : '') :
              currentMode === 'topup' ? `儲值: 收現 ${amt}` :
                `取消 ${orderedTodayCount} 筆訂餐`,
      amount: amt - mealPrice,
      after: picked.currentBalance + (amt - mealPrice),
    };
  }, [isSuccess, picked, currentMode, currentPaidAmount, todayMenu, orderedTodayCount, flashKey]);

  return (
    <ErrorBoundary fallback={<AppCrashPage />} onError={(e) => console.error('[ErrorBoundary]', e)}>
    <div className="app">
      <TopBar tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync} todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} systemDate={systemDate} queuedCount={queuedCount} onDashboard={() => setShowDashboard(true)} />

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
                  queueHint={`全鍵盤操作 · 平均處理 4.2 秒/人`} />
              </>
            ) : (
              <>
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
                />
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
                  orderedTodayCount={orderedTodayCount}
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
    </div>
    </ErrorBoundary>
  );
}
