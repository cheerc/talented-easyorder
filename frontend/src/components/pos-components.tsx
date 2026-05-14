// POS Main Screen — search, order, checkout flow (v2)
import { useEffect, useRef } from "react";
import type { StudentAccount } from '../domain/student';
import type { TodayMenu } from '../domain/menu';

// eslint-disable-next-line react-refresh/only-export-components
export const fmt = (n: number) => new Intl.NumberFormat('zh-TW').format(Math.abs(n));
// eslint-disable-next-line react-refresh/only-export-components
export const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

interface TopBarProps {
  tab: string;
  setTab: (tab: string) => void;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  todayCount: number;
  viewDate: string;
  setViewDate: (date: string) => void;
}
export function TopBar({ tab, setTab, online, syncing, lastSync, todayCount, viewDate, setViewDate }: TopBarProps) {
  const tabs = [
    { id: 'pos',     label: '櫃台', hint: 'F1' },
    { id: 'report',  label: '今日帳', hint: 'F2' },
    { id: 'admin',   label: '今日設定', hint: 'F3' },
    { id: 'vendors', label: '供應商', hint: 'F4' },
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
          <span className={'dot ' + (syncing ? 'dot-pulse' : '')}></span>
          <div className="sync-txt">
            <div className="sync-label">{online ? '雲端已同步' : '離線中 · 排隊中'}</div>
            <div className="sync-meta">{syncing ? '推送中…' : `上次 ${lastSync}`}</div>
          </div>
        </div>
        <div className="counter">
          <div className="counter-num">{todayCount}</div>
          <div className="counter-lbl">今日訂單</div>
        </div>
      </div>
    </header>
  );
}

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
}
export function SearchBox({ value, onChange, onSubmit, onEsc, suggestions, activeIdx, onPick, onHover, focusKey, disabled }: SearchBoxProps) {
  const ref = useRef(null);
  useEffect(() => { if (!disabled) ref.current?.focus(); }, [focusKey, disabled]);

  return (
    <div className="searchwrap">
      <label className="search-label">輸入編號或姓名</label>
      <div className="search">
        <span className="search-prefix">#</span>
        <input
          ref={ref}
          className="search-input"
          value={value}
          disabled={disabled}
          autoFocus
          autoComplete="off"
          spellCheck="false"
          placeholder="例如 015 或 周映彤"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onSubmit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEsc(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); onHover(Math.min(activeIdx + 1, suggestions.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); onHover(Math.max(activeIdx - 1, 0)); }
          }}
        />
        <span className="search-enter"><span className="kbd kbd-lg">↵</span></span>
      </div>
      {suggestions.length > 0 && value && (
        <div className="suggest">
          {suggestions.slice(0, 6).map((s, i) => (
            <div
              key={s.studentId}
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
}

// ============ Customer Card ============
// Action key map:
//   1 = 訂便當 (記帳)         — balance -= price, becomes debt if negative
//   2 = 訂便當 + 收現付款       — net 0 to balance, debt cleared by payment
//   3 = 純儲值 / 繳費 (不訂餐)  — balance += amount
//   4 = 取消當日訂餐            — refund all of today's orders
interface CustomerCardProps {
  student: StudentAccount;
  todayMenu: TodayMenu;
  mode: string;
  orderedTodayCount: number;
  payAmount: string;
  setPayAmount: (val: string) => void;
}
export function CustomerCard({ student, todayMenu, mode, orderedTodayCount, payAmount, setPayAmount }: CustomerCardProps) {
  const after =
    mode === 'order'      ? student.currentBalance + (Number(payAmount || 0) - todayMenu.price) :
    mode === 'topup'      ? student.currentBalance + Number(payAmount || 0) :
    mode === 'cancel'     ? student.currentBalance + (orderedTodayCount * todayMenu.price) :
    student.currentBalance;

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
          {orderedTodayCount > 0 && (
            <div className="bal-debt warn-soft-chip">
              ⚠ 今日已訂過 <b>{orderedTodayCount}</b> 次便當
            </div>
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
                <span className="bill-label">當日便當 ({todayMenu.itemName})</span>
                <span className="bill-val neg">−${fmt(todayMenu.price)}</span>
              </div>
            )}
            {mode === 'cancel' && (
              <div className="bill-item">
                <span className="bill-label">取消訂餐 ({orderedTodayCount} 筆)</span>
                <span className="bill-val pos">+${fmt(orderedTodayCount * todayMenu.price)}</span>
              </div>
            )}
            {mode === 'topup' && (
              <div className="bill-item">
                <span className="bill-label">目前帳戶餘額</span>
                <span className="bill-val">${fmt(student.currentBalance)}</span>
              </div>
            )}
            
            <div className="after-preview">
              <span className="after-label">交易後預估餘額</span>
              <span className={'after-val ' + (after < 0 ? 'warn' : 'accent')}>
                {after < 0 ? '−' : ''}${fmt(after)}
              </span>
            </div>
            {after < 0 && <div className="chip chip-warn" style={{ alignSelf: 'flex-start', marginTop: '8px' }}>⚠ 將產生欠款</div>}
          </div>

          {/* Right Side: Payment Panel */}
          {(mode !== 'cancel' || orderedTodayCount > 0) ? (
            <div className="pay-panel">
              <div className="pay-header">
                <span className="pay-title">
                  {mode === 'order' ? '本次繳費' : mode === 'topup' ? '儲值金額' : '退還現金'}
                </span>
                {mode === 'order' && <span className="dim" style={{ fontSize: '12px' }}>留空為記帳</span>}
                {mode === 'cancel' && <span className="dim" style={{ fontSize: '12px' }}>若已付現請輸入退款金額</span>}
              </div>
              
              <div className="pay-input-container">
                <span className="pay-input-prefix">$</span>
                <input
                  className="pay-input-main"
                  type="number"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  placeholder={mode === 'cancel' ? "0" : (mode === 'order' ? "0" : "輸入金額")}
                  autoFocus
                />
                <span className="pay-input-suffix">元</span>
              </div>

              <div className="pay-quick-grid">
                {(mode === 'cancel' ? [todayMenu.price] : (mode === 'order' ? [90, 100, 200, 500, 1000] : [100, 500, 1000, 2000, 3000])).map(v => (
                  <button key={v} className="btn-quick" onClick={() => setPayAmount(String(v))}>
                    {mode === 'topup' ? '+' : mode === 'cancel' ? '-' : ''}{v}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="cancel-empty">
              <div>本日尚無訂餐紀錄</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ Action Bar ============
interface ActionBarProps {
  mode: string;
  setMode: (mode: string) => void;
  orderedTodayCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ActionBar({ mode, setMode, orderedTodayCount, onConfirm, onCancel, focusZone }: ActionBarProps) {
  const opts = [
    { id: 'order',  label: '訂便當',           hint: 'Q' },
    { id: 'topup',  label: '純繳費 / 儲值',   hint: 'W' },
    { id: 'cancel', label: '取消當日訂餐',     hint: 'E',
      disabled: orderedTodayCount === 0 },
  ];

  return (
    <div className="actionbar">
      <div className="modes modes-3">
        {opts.map(o => (
          <button
            key={o.id}
            disabled={o.disabled}
            className={'mode ' + (mode === o.id ? 'mode-on' : '') + (o.disabled ? ' mode-disabled' : '') + (focusZone === 'mode-' + o.id ? ' mode-focus' : '')}
            onClick={() => !o.disabled && setMode(o.id)}
          >
            <span className="mode-key">{o.hint}</span>
            <span className="mode-lbl">{o.label}</span>
          </button>
        ))}
      </div>
      <div className="confirm-row">
        <button className={'btn-cancel ' + (focusZone === 'btn-cancel' ? 'btn-focus' : '')} onClick={onCancel}>
          <span>取消</span><span className="kbd">Esc</span>
        </button>
        <button
          className={'btn-confirm ' + (mode === 'cancel' ? 'danger' : '') + (focusZone === 'btn-confirm' ? ' btn-focus' : '')}
          onClick={onConfirm}
          disabled={mode === 'cancel' && orderedTodayCount === 0}
        >
          <span>{mode === 'cancel' ? '確認取消' : '確認'}</span><span className="kbd kbd-light">↵</span>
        </button>
      </div>
    </div>
  );
}

// ============ Idle Hero ============
interface IdleHeroProps {
  todayMenu: TodayMenu;
  todayCount: number;
  vendorPhone: string;
  queueHint?: string;
}
export function IdleHero({ todayMenu, todayCount, vendorPhone, queueHint }: IdleHeroProps) {
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
      <div className="idle-hint">
        <div className="idle-hint-lbl">下一位</div>
        <div className="idle-hint-txt">輸入編號 → 按 <span className="kbd">↵</span></div>
        {queueHint && <div className="idle-queue">{queueHint}</div>}
      </div>
    </div>
  );
}

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
}
export function ConfirmBanner({ flash, onDismiss }: ConfirmBannerProps) {
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
    <div className="flash" key={flash.id}>
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
      <div className="flash-count">
        <span className="kbd kbd-light">↵</span> 下一位 · <span className="kbd kbd-light">Esc</span> 關閉
      </div>
    </div>
  );
}

// ============ Recent strip ============
interface RecentStripProps {
  recent: (import('../domain/ledger').LedgerTransaction & { uid: string })[];
}
export function RecentStrip({ recent }: RecentStripProps) {
  return (
    <div className="recent">
      <div className="recent-head">最近 5 筆</div>
      <div className="recent-list">
        {recent.length === 0 && <div className="recent-empty">尚無交易</div>}
        {recent.slice(0, 5).map(r => (
          <div key={r.uid} className="recent-row">
            <span className="recent-time mono">{r.createdAt.slice(11, 19)}</span>
            <span className="recent-id mono">{r.studentId}</span>
            <span className="recent-name">{r.studentNameSnapshot}</span>
            <span className={'recent-type type-' + r.type}>{
              r.type === 'order' ? '訂' :
              r.type === 'order_pay' ? '訂' :
              r.type === 'topup' ? '儲' :
              r.type === 'pay' ? '繳' :
              r.type === 'debt' ? '欠' :
              r.type === 'cancel' ? '退' : ''
            }</span>
            <span className={'recent-amt mono ' + (r.amount > 0 ? 'pos' : 'neg')}>
              {sign(r.amount)}{fmt(r.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

