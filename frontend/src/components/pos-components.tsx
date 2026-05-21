// POS Main Screen — search, order, checkout flow (v2)
import React, { useEffect, useRef, useMemo } from "react";
import type { StudentAccount } from '../domain/student';
import type { TodayMenu } from '../domain/menu';
import type { PosMode } from '../domain/posFlow';
import { NumericInput } from './ui/NumericInput';

// eslint-disable-next-line react-refresh/only-export-components
export const fmt = (n: number) => new Intl.NumberFormat('zh-TW').format(Math.abs(n));
// eslint-disable-next-line react-refresh/only-export-components
export const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

// eslint-disable-next-line react-refresh/only-export-components
export function getQuickAmounts(input: {
  mode: PosMode;
  todayPrice: number;
  currentDebt: number;
}): number[] {
  if (input.mode === 'payment') return [100, 500, 1000, 2000, 3000];

  const amounts = [input.todayPrice, 100, 200, 500, 1000];
  if (input.currentDebt > 0) {
    amounts.splice(1, 0, input.todayPrice + input.currentDebt);
  }
  return [...new Set(amounts)].filter(amount => Number.isInteger(amount) && amount > 0);
}

interface TopBarProps {
  tab: string;
  setTab: (tab: string) => void;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  todayCount: number;
  viewDate: string;
  setViewDate: (date: string) => void;
  queuedCount?: number;
  failedSyncCount?: number;
  conflictSyncCount?: number;
  onDashboard?: () => void;
}
export const TopBar = React.memo(function TopBar({ tab, setTab, online, syncing, lastSync, todayCount, viewDate, setViewDate, queuedCount = 0, failedSyncCount = 0, conflictSyncCount = 0, onDashboard }: TopBarProps) {
  const tabs = [
    { id: 'pos', label: '櫃台', hint: 'F1' },
    { id: 'report', label: '今日帳', hint: 'F2' },
    { id: 'admin', label: '今日設定', hint: 'F3' },
    { id: 'vendors', label: '供應商', hint: 'F4' },
    { id: 'history', label: '歷史', hint: 'F5' },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">●</div>
        <div className="brand-text">
          <div className="brand-name">便當櫃台</div>
          <div className="brand-sub" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="date"
              value={viewDate}
              onChange={e => setViewDate(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'inherit', fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}
            />
            <button
              className="db-trigger"
              title="前一天"
              style={{ width: '22px', height: '22px', fontSize: '10px', borderRadius: '4px' }}
              onClick={() => {
                const d = new Date(viewDate);
                d.setDate(d.getDate() - 1);
                setViewDate(d.toISOString().split('T')[0]);
              }}
            >◀</button>
            <button
              className="db-trigger"
              title="後一天"
              style={{ width: '22px', height: '22px', fontSize: '10px', borderRadius: '4px' }}
              onClick={() => {
                const d = new Date(viewDate);
                d.setDate(d.getDate() + 1);
                setViewDate(d.toISOString().split('T')[0]);
              }}
            >▶</button>
          </div>
        </div>
      </div>
      <nav className="tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={'tab ' + (tab === t.id ? 'tab-on' : '')}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            <span className="tab-key">{t.hint}</span>
          </button>
        ))}
      </nav>
      <div className="status">
        <div className={'sync ' + (online ? 'sync-on' : 'sync-off')}>
          <span className={'dot ' + (syncing ? 'dot-pulse' : '') + (!online ? ' dot-red' : '')}></span>
          <div className="sync-txt">
            <div className="sync-label">{online ? '雲端已同步' : '⚠ 離線中'}</div>
            <div className="sync-meta">{syncing ? '推送中…' : online ? `上次 ${lastSync}` : '等待連線恢復…'}</div>
          </div>
        </div>
        {(failedSyncCount > 0 || conflictSyncCount > 0) && (
          <div className="sync sync-err" style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: 'var(--r)', background: 'var(--red-soft)', border: '1px solid var(--red)', fontSize: '12px', color: 'var(--red)' }}>
            <span>⚠ 同步異常</span>
            <span style={{ marginLeft: '4px' }}>
              {failedSyncCount > 0 && `${failedSyncCount} 筆失敗`}
              {failedSyncCount > 0 && conflictSyncCount > 0 && '、'}
              {conflictSyncCount > 0 && `${conflictSyncCount} 筆衝突`}
            </span>
          </div>
        )}
        <div className="counter">
          <div className="counter-num">{todayCount}</div>
          <div className="counter-lbl">今日訂單</div>
          {queuedCount > 0 && (
            <div className="counter-queued">{queuedCount} 筆待傳</div>
          )}
        </div>
        {onDashboard && (
          <button className="db-trigger" onClick={onDashboard} title="今日營運概覽 (F6)">
            <span style={{ fontSize: '16px' }}>📊</span>
          </button>
        )}
      </div>
    </header>
  );
});

// ============ Midnight / Date Mismatch Banner ============
interface MidnightBannerProps {
  viewDate: string;
  systemDate: string;
  onSwitchToToday: () => void;
}
export const MidnightBanner = React.memo(function MidnightBanner({ viewDate, systemDate, onSwitchToToday }: MidnightBannerProps) {
  const isMidnight = useMemo(() => {
    const now = new Date();
    return now.getHours() === 23 && now.getMinutes() >= 55;
  }, []);

  if (isMidnight) {
    return (
      <div className="midnight-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 'var(--r)', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--warn)' }}>⏰ 即將跨日，請確認日期設定</span>
        <button className="ghost-btn" style={{ fontSize: '12px' }} onClick={onSwitchToToday}>切換至今日</button>
      </div>
    );
  }

  return (
    <div className="midnight-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 'var(--r)', marginBottom: '12px' }}>
      <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--accent-ink)' }}>
        目前檢視 {viewDate}，與今日 {systemDate} 不同
      </span>
      <button className="ghost-btn" style={{ fontSize: '12px' }} onClick={onSwitchToToday}>切換至今日</button>
    </div>
  );
});

// ============ Search Box ============
interface SearchBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onEsc: () => void;
  suggestions: StudentAccount[];
  activeIdx: number;
  onPick: (s: StudentAccount) => void;
  onHover: (idx: number) => void;
  focusKey: number;
  disabled: boolean;
  onEnterExpense?: () => void;
}
export const SearchBox = React.memo(function SearchBox({ value, onChange, onSubmit, onEsc, suggestions, activeIdx, onPick, onHover, focusKey, disabled, onEnterExpense }: SearchBoxProps) {
  const ref = useRef(null);
  useEffect(() => { if (focusKey > 0 && !disabled) ref.current?.focus(); }, [focusKey, disabled]);

  return (
    <div className="searchwrap">
      <label className="search-label">輸入編號或姓名</label>
      <div className="search-row">
        <div className="search">
          <span className="search-prefix">#</span>
          <input
            ref={ref}
            className="search-input"
            aria-label="輸入學員編號或姓名"
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
            placeholder="例如 015 或 周映彤"
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (value.trim() === '') {
                  e.currentTarget.blur();
                } else {
                  onSubmit();
                }
              }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); onEsc(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); onHover(Math.min(activeIdx + 1, suggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); onHover(Math.max(activeIdx - 1, 0)); }
            }}
          />
          <span className="search-enter"><span className="kbd kbd-lg">↵</span></span>
        </div>
        {onEnterExpense && (
          <button className="mode" onClick={onEnterExpense} style={{ flex: 'none', width: 'auto', padding: '14px 28px' }}>
            <span className="mode-key">A</span>
            <span className="mode-lbl" style={{ fontSize: '18px' }}>收入/支出</span>
          </button>
        )}
      </div>
      {suggestions.length > 0 && value && (
        <div className="suggest" role="listbox" aria-label="學員建議清單">
          {suggestions.slice(0, 6).map((s, i) => (
            <div
              key={s.studentId}
              role="option"
              aria-selected={i === activeIdx}
              className={'sug-row ' + (i === activeIdx ? 'sug-on' : '')}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(s)}
            >
              <span className="sug-id mono">{s.studentId}</span>
              <span className="sug-name">{s.displayName}</span>
              <span className={'sug-bal mono ' + (s.currentBalance < 0 ? 'is-debt' : s.currentBalance < 90 ? 'is-low' : '')}>
                {s.currentBalance < 0 ? `欠 ${fmt(s.currentBalance)}` : `$${fmt(s.currentBalance)}`}
              </span>
            </div>
          ))}
          <div className="sug-foot">
            <span className="kbd">↑</span><span className="kbd">↓</span> 選擇 ·
            <span className="kbd">↵</span> 確認 ·
            <span className="kbd">Esc</span> 清空
          </div>
        </div>
      )}
    </div>
  );
});

// ============ Customer Card ============
interface CustomerCardProps {
  student: StudentAccount;
  todayMenu: TodayMenu;
  mode: PosMode;
  orderedTodayCount: number;
  payAmount: string;
  setPayAmount: (val: string) => void;
  onViewHistory?: () => void;
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (value: number | null) => void;
  setPriceOverrideLabel: (value: string) => void;
  onDeleteOrder?: () => void;
}
export const CustomerCard = React.memo(function CustomerCard({ student, todayMenu, mode, orderedTodayCount, payAmount, setPayAmount, onViewHistory, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel, onDeleteOrder }: CustomerCardProps) {
  const effectiveMealPrice = mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
  const payInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    payInputRef.current?.focus();
  }, [mode]);

  return (
    <div className="card customer">
      <div className="cust-head">
        <div className="cust-id-block">
          <div className="cust-id mono">{student.studentId}</div>
          <div className="cust-grade">學員</div>
        </div>
        <div className="cust-name">{student.displayName}</div>
        <div className="cust-bal">
          <div className="bal-lbl">帳戶餘額</div>
          <div className={'bal-num mono ' + (student.currentBalance < 0 ? 'warn' : student.currentBalance < 90 ? 'low' : '')}>
            {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
          </div>
          {onViewHistory && (
            <button className="ghost-btn" style={{ marginTop: '6px', fontSize: '11px', padding: '2px 10px' }}
              onClick={onViewHistory}>
              檢視歷史
            </button>
          )}
          {orderedTodayCount > 0 && (
            <div className="bal-debt warn-soft-chip">
              ⚠ 今日已訂過 <b>{orderedTodayCount}</b> 次便當
            </div>
          )}
          {onDeleteOrder && (
            <button className="ghost-btn" style={{ marginTop: '6px', fontSize: '11px', padding: '2px 10px', color: 'var(--c-warn)' }}
              onClick={onDeleteOrder}>
              取消訂餐
            </button>
          )}
        </div>
      </div>

      <div className="action-block">
        <div className="action-grid">
          {/* Left Side: Summary */}
          <div className="bill-summary">
            <div className="pay-title">結帳明細</div>
            {mode === 'order' && (
              <div className="bill-item">
                <span className="bill-label">當日便當 ({priceOverrideLabel || todayMenu.itemName})</span>
                <span className="bill-val neg">−${fmt(effectiveMealPrice)}</span>
              </div>
            )}
            {mode === 'payment' && (
              <div className="bill-item">
                <span className="bill-label">目前帳戶餘額</span>
                <span className="bill-val">${fmt(student.currentBalance)}</span>
              </div>
            )}

            {mode === 'order' && (
              <div className="price-override">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setPriceOverride(priceOverride ?? todayMenu.price)}
                >
                  訂購其他餐點
                </button>
                {priceOverride !== null && (
                  <div className="price-override-fields">
                    <label>
                      <span>品項</span>
                      <input
                        className="adm-input"
                        aria-label="品項或原因"
                        value={priceOverrideLabel}
                        onChange={e => setPriceOverrideLabel(e.target.value)}
                        placeholder="例如：雞腿便當"
                      />
                    </label>
                    <label>
                      <span>價格</span>
                      <NumericInput
                        className="adm-input mono"
                        aria-label="價格"
                        value={priceOverride}
                        onChange={v => setPriceOverride(Number(v || todayMenu.price))}
                      />
                    </label>
                    <button type="button" className="ghost-btn" onClick={() => setPriceOverride(null)}>
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* §3.1: removed "將產生欠款" warning per UX spec */}
          </div>

          {/* Right Side: Payment Panel */}
          {mode !== 'expense' ? (
            <div className="pay-panel">
              <div className="pay-header">
                <span className="pay-title">
                  {mode === 'order' ? '本次繳費' : '繳費金額'}
                </span>
                {mode === 'order' && <span className="dim" style={{ fontSize: '12px' }}>留空為記帳</span>}
              </div>

              <div className="pay-input-container">
                <span className="pay-input-prefix">$</span>
                <NumericInput
                  ref={payInputRef}
                  className="pay-input-main"
                  aria-label="付款金額"
                  value={payAmount}
                  onChange={setPayAmount}
                  placeholder={mode === 'order' ? "" : "輸入金額"}
                />
                <span className="pay-input-suffix">元</span>
              </div>

              {/* §3.3: removed quick amount buttons from payment mode */}
            </div>
          ) : (
            <div className="cancel-empty">
              <div>支出模式 — 請在下方輸入金額</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// ============ Action Bar ============
interface ActionBarProps {
  mode: PosMode;
  setMode: (mode: PosMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDeleteOrder?: () => void;
  focusZone: string;
}
export const ActionBar = React.memo(function ActionBar({ mode, setMode, onConfirm, onCancel, onDeleteOrder, focusZone }: ActionBarProps) {
  const opts = [
    { id: 'order' as PosMode, label: '訂便當', hint: 'Q' },
    { id: 'payment' as PosMode, label: '繳費', hint: 'W' },
  ];

  return (
    <div className="actionbar" role="group" aria-label="交易操作">
      <div className="modes modes-3" role="radiogroup" aria-label="交易類型" style={{ display: 'flex', gap: '8px' }}>
        {opts.map(o => {
          const isModeOn = focusZone === 'mode-' + o.id || (mode === o.id && focusZone !== 'btn-delete-order');
          return (
            <button
              key={o.id}
              className={'mode ' + (isModeOn ? 'mode-on' : '') + (focusZone === 'mode-' + o.id ? ' mode-focus' : '')}
              onClick={() => setMode(o.id)}
              role="radio"
              aria-checked={mode === o.id}
              style={{ flex: 1 }}
            >
              <span className="mode-key">{o.hint}</span>
              <span className="mode-lbl">{o.label}</span>
            </button>
          );
        })}
        {onDeleteOrder && (
          <button
            className={'mode ' + (focusZone === 'btn-delete-order' ? 'mode-on mode-focus' : '')}
            onClick={onDeleteOrder}
            style={{ flex: 1 }}
          >
            <span className="mode-key">E</span>
            <span className="mode-lbl">取消訂餐</span>
          </button>
        )}
      </div>
      <div className="confirm-row">
        <button className={'btn-cancel ' + (focusZone === 'btn-cancel' ? 'btn-focus' : '')} onClick={onCancel}>
          <span>取消</span><span className="kbd">Esc</span>
        </button>
        <button
          className={'btn-confirm ' + (focusZone === 'btn-confirm' ? ' btn-focus' : '')}
          onClick={onConfirm}
        >
          <span>確認</span><span className="kbd kbd-light">↵</span>
        </button>
      </div>
    </div>
  );
});

// ============ Idle Hero ============
interface IdleHeroProps {
  todayMenu: TodayMenu;
  todayCount: number;
  vendorPhone: string;
  queueHint?: string;
  onEnterExpense?: () => void;
}
export const IdleHero = React.memo(function IdleHero({ todayMenu, todayCount, vendorPhone }: IdleHeroProps) {
  return (
    <div className="idle">
      <div className="idle-menu">
        <div className="idle-tag">本日便當</div>
        <div className="idle-name" style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span className="mono" style={{ color: 'var(--c-brand)' }}>${fmt(todayMenu.price)}</span>
          <span>{todayMenu.itemName}</span>
        </div>
        <div className="idle-meta" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>{todayMenu.vendorNameSnapshot}</span>
            {vendorPhone && <span className="mono">{vendorPhone}</span>}
          </div>
          <div>已訂 <span className="mono">{todayCount}</span> 份</div>
        </div>
      </div>
    </div>
  );
});

// ============ Duplicate Warning Banner ============
interface DuplicateWarningBannerProps {
  orderedTodayCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}
export const DuplicateWarningBanner = React.memo(function DuplicateWarningBanner({ orderedTodayCount, onConfirm, onCancel }: DuplicateWarningBannerProps) {
  return (
    <div className="dup-warn">
      <div className="dup-warn-icon">⚠</div>
      <div className="dup-warn-body">
        <div className="dup-warn-h">已經訂過 {orderedTodayCount} 次便當</div>
        <div className="dup-warn-sub">
          確定要再訂一份嗎? (家長可能用同一帳號為多位學員訂餐)
        </div>
      </div>
      <div className="dup-warn-btns">
        <button className="btn-cancel" onClick={onCancel}>
          <span>否</span><span className="kbd">Esc</span>
        </button>
        <button className="btn-confirm" onClick={onConfirm}>
          <span>是,再訂一份</span><span className="kbd kbd-light">↵</span>
        </button>
      </div>
    </div>
  );
});

// ============ Confirmation banner (replaces auto-close countdown) ============
interface FlashData {
  id: number;
  name: string;
  sid: string;
  detail: string;
  amount: number;
  after: number;
}
interface ConfirmBannerProps {
  flash: FlashData | null;
  onDismiss: () => void;
  onUndo?: () => void;
  undoCountdown?: number;
}
export const ConfirmBanner = React.memo(function ConfirmBanner({ flash, onDismiss, onUndo, undoCountdown }: ConfirmBannerProps) {
  useEffect(() => {
    if (!flash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flash, onDismiss]);

  if (!flash) return null;
  return (
    <div className="flash" key={flash.id} role="status" aria-live="polite">
      <div className="flash-card">
        <div className="flash-tick">✓</div>
        <div className="flash-body">
          <div className="flash-name">{flash.name} <span className="mono flash-id">#{flash.sid}</span></div>
          <div className="flash-detail">{flash.detail}</div>
          <div className={'flash-amt mono ' + (flash.amount > 0 ? 'pos' : 'neg')}>
            {sign(flash.amount)}${fmt(flash.amount)}
          </div>
        </div>
        <div className="flash-after">
          <div className="flash-after-lbl">餘額</div>
          <div className="flash-after-num mono">
            {flash.after < 0 ? '−' : ''}${fmt(flash.after)}
          </div>
        </div>
      </div>
      <div className="flash-count" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span><span className="kbd kbd-light">↵</span> 下一位 · <span className="kbd kbd-light">Esc</span> 關閉</span>
        {onUndo && undoCountdown !== undefined && undoCountdown > 0 && (
          <button
            className="rpt-mini-btn rpt-mini-del"
            onClick={(e) => { e.stopPropagation(); onUndo(); }}
            style={{ padding: '4px 12px', fontSize: '13px' }}
          >
            復原 ({undoCountdown}s)
          </button>
        )}
      </div>
    </div>
  );
});

// ============ Recent strip ============
interface RecentStripProps {
  recent: (import('../domain/ledger').LedgerTransaction & { uid: string })[];
  onItemClick?: (studentId: string) => void;
}
export const RecentStrip = React.memo(function RecentStrip({ recent, onItemClick }: RecentStripProps) {
  return (
    <div className="recent">
      <div className="recent-head">最近 20 筆</div>
      <div className="recent-list">
        {recent.length === 0 && <div className="recent-empty">尚無交易</div>}
        {recent.slice(0, 20).map(r => (
          <div key={r.uid} className="recent-row" onClick={() => onItemClick?.(r.studentId)} style={onItemClick ? { cursor: 'pointer' } : undefined}>
            <span className="recent-time mono">{r.createdAt.slice(11, 19)}</span>
            <span className="recent-id mono">{r.studentId === '__cashier__' ? '' : r.studentId}</span>
            <span className="recent-name">
              {r.studentNameSnapshot}
            </span>
            <span className={'recent-type ' + (r.type === 'expense'
              ? (r.paidAmount > 0 ? 'type-income' : 'type-expense')
              : 'type-' + r.type)}>{
                r.type === 'order' ? '訂' :
                  r.type === 'payment' ? '繳' :
                    r.type === 'expense' ? (r.paidAmount > 0 ? '收' : '支') : ''
              }</span>
            <span className={'recent-amt mono ' + (
              r.type === 'order'
                ? (r.afterBalance >= 0 ? 'pos' : 'neg')
                : r.type === 'payment'
                  ? (r.afterBalance >= 0 ? 'pos' : 'neg')
                  : r.type === 'expense'
                    ? (r.paidAmount > 0 ? 'pos' : 'neg')
                    : (r.amount > 0 ? 'pos' : 'neg')
            )}>
              {r.type === 'order'
                ? (r.afterBalance >= 0
                  ? <><span className="recent-amt-lbl">已繳費</span><span className="recent-amt-val">{fmt(r.mealPrice)}</span></>
                  : <><span className="recent-amt-lbl">待繳費</span><span className="recent-amt-val">{fmt(Math.abs(r.afterBalance))}</span></>)
                : r.type === 'payment'
                  ? (r.afterBalance >= 0
                    ? <span className="recent-amt-val">+{fmt(r.paidAmount)}</span>
                    : <><span className="recent-amt-lbl">待繳費</span><span className="recent-amt-val">{fmt(Math.abs(r.afterBalance))}</span></>)
                  : r.type === 'expense'
                    ? (r.note
                      ? <><span className="recent-amt-lbl">{(r.note.slice(0, 4) + '　　　').slice(0, 4)}</span><span className="recent-amt-val">{r.paidAmount > 0 ? '+' : '−'}{fmt(r.paidAmount > 0 ? r.paidAmount : r.mealPrice)}</span></>
                      : <span className="recent-amt-val">{r.paidAmount > 0 ? '+' : '−'}{fmt(r.paidAmount > 0 ? r.paidAmount : r.mealPrice)}</span>)
                    : <><span className="recent-amt-val">{sign(r.amount)}{fmt(r.amount)}</span></>
              }</span>
          </div>
        ))}
      </div>
    </div>
  );
});


// ============ Expense Panel ============
const EXPENSE_QUICK_OPTIONS = ['付便當錢', '其他原因'] as const;

interface ExpensePanelProps {
  kind: 'expense_input' | 'expense_direction' | 'expense_reason' | 'expense_other_note';
  amountText: string;
  amount: number;
  onAmountChange: (text: string) => void;
  onAmountConfirm: (amount: number) => void;
  onDirectionSelect: (direction: import('../domain/posFlow').ExpenseDirection) => void;
  onReasonSelect: (reason: '付便當錢' | '支出其他' | '收入其他') => void;
  onNoteChange: (note: string) => void;
  onNoteConfirm: (note: string) => void;
  onCancel: () => void;
}

export const ExpensePanel = React.memo(function ExpensePanel(props: ExpensePanelProps) {
  const { kind, amountText, amount, onAmountChange, onAmountConfirm, onDirectionSelect, onReasonSelect, onNoteChange, onNoteConfirm, onCancel } = props;

  const [selIdx, setSelIdx] = React.useState(0);

  // Reset selection index when step changes
  useEffect(() => {
    setSelIdx(0);
  }, [kind]);

  // Keyboard navigation for expense_direction and expense_reason
  useEffect(() => {
    if (kind !== 'expense_direction' && kind !== 'expense_reason') return;

    const optionCount = kind === 'expense_direction' ? 2 : EXPENSE_QUICK_OPTIONS.length;

    const onKey = (e: KeyboardEvent) => {
      if ((e as any).__handledByExpensePanel) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelIdx(idx => Math.max(0, idx - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelIdx(idx => Math.min(optionCount - 1, idx + 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        (e as any).__handledByExpensePanel = true;
        if (kind === 'expense_direction') {
          onDirectionSelect(selIdx === 0 ? 'expense' : 'income');
        } else {
          const opt = EXPENSE_QUICK_OPTIONS[selIdx];
          onReasonSelect(opt === '其他原因' ? '支出其他' : '付便當錢');
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        (e as any).__handledByExpensePanel = true;
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, onDirectionSelect, onReasonSelect, onCancel, selIdx]);

  return (
    <div className="card customer" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="pay-title">新增 收入/支出</div>

      {kind === 'expense_input' && (
        <>
          <div className="pay-input-container">
            <span className="pay-input-prefix">$</span>
            <NumericInput
              className="pay-input-main"
              aria-label="金額"
              value={amountText}
              onChange={onAmountChange}
              placeholder="輸入金額"
              autoFocus
              onKeyDown={e => {
                if ((e.nativeEvent as any).__handledByExpensePanel) return;

                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.nativeEvent.stopImmediatePropagation();
                  (e.nativeEvent as any).__handledByExpensePanel = true;
                  const n = Number(amountText);
                  if (Number.isFinite(n) && n > 0) {
                    onAmountConfirm(n);
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  (e.nativeEvent as any).__handledByExpensePanel = true;
                  onCancel();
                }
              }}
            />
            <span className="pay-input-suffix">元</span>
          </div>
          {/* §3.3: removed quick amount buttons from expense panel */}
        </>
      )}

      {kind === 'expense_direction' && (
        <>
          <div className="dup-warn" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div className="dup-warn-h">金額 ${Math.abs(amount)} — 選擇類型</div>
            <div className="dup-warn-btns" style={{ marginTop: '12px', gap: '16px' }}>
              <button className="btn-confirm" style={selIdx === 0 ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined} onClick={() => onDirectionSelect('expense')}>
                支出
              </button>
              <button className="btn-confirm" style={selIdx === 1 ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined} onClick={() => onDirectionSelect('income')}>
                收入
              </button>
            </div>
          </div>
          <div className="dim" style={{ textAlign: 'center', fontSize: '12px' }}>
            <span className="kbd">←</span><span className="kbd">→</span> 選擇 · <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
          </div>
        </>
      )}

      {kind === 'expense_reason' && (
        <>
          <div className="dup-warn" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div className="dup-warn-h">{amount ? `$${Math.abs(amount)} — 選擇原因` : '選擇原因'}</div>
            <div className="dup-warn-btns" style={{ marginTop: '12px', gap: '16px' }}>
              {EXPENSE_QUICK_OPTIONS.map((opt, i) => (
                <button key={opt} className="btn-confirm" style={selIdx === i ? { outline: '2px solid var(--accent)', outlineOffset: '2px' } : undefined} onClick={() => onReasonSelect(opt === '其他原因' ? '支出其他' : '付便當錢')}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="dim" style={{ textAlign: 'center', fontSize: '12px' }}>
            <span className="kbd">←</span><span className="kbd">→</span> 選擇 · <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
          </div>
        </>
      )}

      {kind === 'expense_other_note' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
          <span className="dim" style={{ fontSize: '12px' }}>備註（必填）</span>
          <input
            className="adm-input"
            aria-label="備註"
            placeholder="請輸入備註"
            autoFocus
            onKeyDown={e => {
              if ((e.nativeEvent as any).__handledByExpensePanel) return;

              if (e.key === 'Enter') {
                e.preventDefault();
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) {
                  e.nativeEvent.stopImmediatePropagation();
                  (e.nativeEvent as any).__handledByExpensePanel = true;
                  onNoteConfirm(v);
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                (e.nativeEvent as any).__handledByExpensePanel = true;
                onCancel();
              }
            }}
            onChange={e => onNoteChange(e.target.value)}
          />
          <div className="dim" style={{ fontSize: '12px', marginTop: '4px' }}>
            <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 取消
          </div>
        </div>
      )}
    </div>
  );
});
