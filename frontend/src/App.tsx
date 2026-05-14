import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePosStore } from './store/posStore';
import type { StudentAccount } from './domain/student';

interface FlashData {
  id: number;
  name: string;
  sid: string;
  detail: string;
  amount: number;
  after: number;
}
import { TopBar, SearchBox, CustomerCard, ActionBar, IdleHero, ConfirmBanner, RecentStrip } from './components/pos-components';
import { ReportScreen, AdminScreen, VendorsScreen } from './components/screens';
import { TweaksPanel, TweakSection, TweakRadio } from './components/tweaks-panel';

export default function App() {
  const {
    students, transactions: allTx, todayMenu, vendors,
    processTransaction, updateTransaction, deleteTransaction,
    setTodayMenu, setVendors, resetData
  } = usePosStore();

  const systemDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [viewDate, setViewDate] = useState(systemDate);
  const isHistorical = viewDate !== systemDate;

  const tx = useMemo(() => {
    return allTx.filter(t => t.businessDate === viewDate).reverse();
  }, [allTx, viewDate]);

  const [tab, setTab] = useState('pos');
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [picked, setPicked] = useState<StudentAccount | null>(null);

  const [mode, setMode] = useState('order');
  const [focusZone, setFocusZone] = useState('mode-order');
  const [payAmount, setPayAmount] = useState('');
  const [confirmDup, setConfirmDup] = useState(false);

  const [flash, setFlash] = useState<FlashData | null>(null);
  const online = true;
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState('剛剛');

  const orderedTodayCount = useMemo(() => {
    if (!picked) return 0;
    return tx.filter(t => t.studentId === picked.studentId && t.type === 'order').length
      - tx.filter(t => t.studentId === picked.studentId && t.type === 'cancel').reduce((acc, t) => acc + Math.abs((t.mealPrice || 0) / todayMenu.price), 0);
  }, [tx, picked, todayMenu.price]);

  const suggestions = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    return students.filter(s => s.studentId.includes(q) || s.displayName.toLowerCase().includes(q));
  }, [query, students]);

  const choose = (s: StudentAccount) => {
    setPicked(s);
    setQuery('');
    setMode('order');
    setFocusZone('mode-order');
  };

  const submitSearch = () => {
    if (suggestions.length > 0) choose(suggestions[activeIdx]);
  };

  const reset = useCallback(() => {
    setPicked(null);
    setMode('order');
    setFocusZone('mode-order');
    setConfirmDup(false);
    setPayAmount('');
  }, []);

  const dismissFlash = useCallback(() => setFlash(null), []);

  const doConfirm = useCallback(() => {
    if (!picked) return;
    const pPrice = todayMenu.price;
    const amt = Number(payAmount || 0);

    let mealPrice = 0;
    let paidAmount = 0;
    const actualType = mode;
    let note = '';

    if (mode === 'order') {
      mealPrice = pPrice;
      paidAmount = amt;
      note = todayMenu.itemName + (amt > 0 ? ' (已付)' : '');
    } else if (mode === 'topup') {
      mealPrice = 0;
      paidAmount = amt;
      note = '現金儲值';
    } else if (mode === 'cancel') {
      mealPrice = -(orderedTodayCount * pPrice);
      paidAmount = -amt;
      note = `退餐 ${orderedTodayCount} 筆` + (amt > 0 ? ` (退現 ${amt})` : '');
    }

    processTransaction(picked.studentId, actualType as 'order' | 'topup' | 'cancel', mealPrice, paidAmount, note);

    setFlash({
      id: Date.now(),
      name: picked.displayName,
      sid: picked.studentId,
      detail: mode === 'order' ? `訂餐: ${todayMenu.itemName}` + (amt > 0 ? `, 收現 ${amt}` : '') :
          mode === 'topup' ? `儲值: 收現 ${amt}` :
            `取消 ${orderedTodayCount} 筆訂餐`,
      amount: paidAmount - mealPrice,
      after: picked.currentBalance + (paidAmount - mealPrice)
    });

    setSyncing(true);
    setTimeout(() => {
      setSyncing(false);
      setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 5));
    }, 800);

    reset();
  }, [picked, mode, payAmount, todayMenu, orderedTodayCount, processTransaction, reset]);

  const handleConfirm = useCallback(() => {
    if (!picked) return;
    if (mode === 'order' && orderedTodayCount > 0 && !confirmDup) {
      setConfirmDup(true);
      setFocusZone('btn-confirm');
      return;
    }
    doConfirm();
  }, [picked, mode, orderedTodayCount, confirmDup, doConfirm]);

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setTab('pos'); return; }
      if (e.key === 'F2') { e.preventDefault(); setTab('report'); return; }
      if (e.key === 'F3') { e.preventDefault(); setTab('admin'); return; }
      if (e.key === 'F4') { e.preventDefault(); setTab('vendors'); return; }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  useEffect(() => {
    if (tab !== 'pos' || flash) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!picked) return;
      const keys = ['q', 'w', 'e', 'r', 'Q', 'W', 'E', 'R'];

      if (e.target.tagName === 'INPUT' && e.target.type !== 'radio') {
        if (e.key === 'Escape') {
          e.target.blur();
          reset();
        }
        if (e.key === 'Enter') handleConfirm();

        if (keys.includes(e.key)) {
          e.target.blur();
        } else {
          return;
        }
      }
      if (keys.includes(e.key)) {
        const key = e.key.toLowerCase();
        const map: Record<string, 'order' | 'topup' | 'cancel'> = { 'q': 'order', 'w': 'topup', 'e': 'cancel' };
        if (key === 'e' && orderedTodayCount === 0) return;
        e.preventDefault();
        const m = map[key];
        setMode(m); setFocusZone('mode-' + m); setConfirmDup(false);
        if (m === 'topup') setPayAmount(String(todayMenu.price));
        else setPayAmount('');
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
        if (focusZone === 'btn-confirm' || focusZone === 'btn-cancel') setFocusZone('mode-' + mode);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') reset();
        else if (focusZone === 'btn-confirm') handleConfirm();
        else if (focusZone.startsWith('mode-')) {
          const m = focusZone.replace('mode-', '');
          if (m === 'cancel' && orderedTodayCount === 0) return;
          if (m === mode) {
            handleConfirm();
          } else {
            setMode(m);
            if (m === 'topup') setPayAmount(String(todayMenu.price));
            else setPayAmount('');
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (confirmDup) setConfirmDup(false);
        else reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, picked, flash, mode, orderedTodayCount, confirmDup, payAmount, todayMenu.price, focusZone, handleConfirm, reset]);

  const todayCount = tx.reduce((acc, t) => acc + ((t.mealPrice || 0) / todayMenu.price), 0);

  const [tweaks, setTweaks] = useState({ theme: 'warm', fontSize: 'lg' });
  const setTweak = (k: string, v: string) => setTweaks(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    document.body.setAttribute('data-fs', tweaks.fontSize);
    document.body.setAttribute('data-theme', tweaks.theme);
  }, [tweaks]);

  return (
    <div className="app">
      <TopBar tab={tab} setTab={setTab} online={online} syncing={syncing} lastSync={lastSync} todayCount={todayCount} viewDate={viewDate} setViewDate={setViewDate} />

      {tab === 'pos' && (
        <div className="main">
          <div className="col-main">
            {isHistorical ? (
              <div className="historical-lock" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--c-text-dim)', textAlign: 'center' }}>
                <h2 style={{ color: 'var(--c-warn)', fontSize: '1.5rem', marginBottom: '8px' }}>目前檢視歷史紀錄</h2>
                <p style={{ marginBottom: '24px' }}>您正在檢視 {viewDate} 的資料。<br />為確保帳務正確，歷史紀錄模式下已暫停結帳與訂餐功能。</p>
                <button className="btn-confirm" onClick={() => setViewDate(systemDate)}>返回今日</button>
              </div>
            ) : !picked ? (
              <>
                <SearchBox
                  value={query}
                  onChange={(v) => { setQuery(v); setActiveIdx(0); }}
                  onSubmit={submitSearch}
                  onEsc={() => { setQuery(''); setActiveIdx(0); }}
                  suggestions={suggestions}
                  activeIdx={activeIdx}
                  onPick={choose}
                  onHover={setActiveIdx}
                  focusKey={0}
                  disabled={!!flash}
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
                  mode={mode}
                  orderedTodayCount={orderedTodayCount}
                  payAmount={payAmount}
                  setPayAmount={setPayAmount}
                />
                {confirmDup && (
                  <div className="dup-warn">
                    <div className="dup-warn-icon">⚠</div>
                    <div className="dup-warn-body">
                      <div className="dup-warn-h">已經訂過 {orderedTodayCount} 次便當</div>
                      <div className="dup-warn-sub">
                        確定要再訂一份嗎? (家長可能用同一帳號為多位學員訂餐)
                      </div>
                    </div>
                    <div className="dup-warn-btns">
                      <button className="btn-cancel" onClick={() => setConfirmDup(false)}>
                        <span>否</span><span className="kbd">Esc</span>
                      </button>
                      <button className="btn-confirm" onClick={doConfirm}>
                        <span>是,再訂一份</span><span className="kbd kbd-light">↵</span>
                      </button>
                    </div>
                  </div>
                )}
                <ActionBar
                  mode={mode} setMode={(m) => {
                    setMode(m); setConfirmDup(false); setFocusZone('mode-' + m);
                    if (m === 'topup') setPayAmount(String(todayMenu.price));
                    else setPayAmount('');
                  }}
                  orderedTodayCount={orderedTodayCount}
                  focusZone={focusZone}
                  onConfirm={handleConfirm}
                  onCancel={reset}
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
        <ReportScreen
          tx={tx}
          onUpdate={updateTransaction}
          onDelete={deleteTransaction}
          todayMenu={todayMenu}
          viewDate={viewDate}
        />
      )}
      {tab === 'admin' && <AdminScreen todayMenu={todayMenu} setTodayMenu={setTodayMenu} vendors={vendors} students={students} resetData={resetData} />}
      {tab === 'vendors' && <VendorsScreen vendors={vendors} setVendors={setVendors} />}


      <ConfirmBanner flash={flash} onDismiss={dismissFlash} />

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
    </div>
  );
}
