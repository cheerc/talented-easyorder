// POS Main Screen — search, order, checkout flow (v2)
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const fmt = (n) => new Intl.NumberFormat('zh-TW').format(Math.abs(n));
const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');

// ============ Top Bar ============
function TopBar({ tab, setTab, online, syncing, lastSync, todayCount }) {
  const tabs = [
    { id: 'pos',     label: '櫃台', hint: 'F1' },
    { id: 'report',  label: '今日帳', hint: 'F2' },
    { id: 'admin',   label: '今日設定', hint: 'F3' },
    { id: 'vendors', label: '供應商', hint: 'F5' },
    { id: 'backup',  label: '備份/還原', hint: 'F4' },
  ];
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">●</div>
        <div className="brand-text">
          <div className="brand-name">便當櫃台</div>
          <div className="brand-sub">{TODAY_MENU.date} · 週四</div>
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
        <div className="status-pill">
          <span className="kbd">↵</span> 確認  <span className="kbd">Esc</span> 取消
        </div>
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
function SearchBox({ value, onChange, onSubmit, onEsc, suggestions, activeIdx, onPick, onHover, focusKey }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, [focusKey]);

  return (
    <div className="searchwrap">
      <label className="search-label">輸入編號或姓名</label>
      <div className="search">
        <span className="search-prefix">#</span>
        <input
          ref={ref}
          className="search-input"
          value={value}
          autoFocus
          autoComplete="off"
          spellCheck="false"
          placeholder="例如 015 或 周映彤"
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onEsc(); }
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
              key={s.id}
              className={'sug-row ' + (i === activeIdx ? 'sug-on' : '')}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(s)}
            >
              <span className="sug-id mono">{s.id}</span>
              <span className="sug-name">{s.name}</span>
              <span className={'sug-bal mono ' + (s.balance < 0 ? 'is-debt' : s.balance < 90 ? 'is-low' : '')}>
                {s.balance < 0 ? `欠 ${fmt(s.balance)}` : `$${fmt(s.balance)}`}
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
function CustomerCard({ student, todayMenu, mode, orderedTodayCount, payAmount, setPayAmount }) {
  const after =
    mode === 'order_debt' ? student.balance - todayMenu.price :
    mode === 'order_pay'  ? student.balance + (Number(payAmount || 0) - todayMenu.price) :
    mode === 'topup'      ? student.balance + Number(payAmount || 0) :
    mode === 'cancel'     ? student.balance + (orderedTodayCount * todayMenu.price) :
    student.balance;

  return (
    <div className="card customer">
      <div className="cust-head">
        <div className="cust-id-block">
          <div className="cust-id mono">{student.id}</div>
          <div className="cust-grade">學員</div>
        </div>
        <div className="cust-name">{student.name}</div>
        <div className="cust-bal">
          <div className="bal-lbl">帳戶餘額</div>
          <div className={'bal-num mono ' + (student.balance < 0 ? 'warn' : student.balance < 90 ? 'low' : '')}>
            {student.balance < 0 ? '−' : ''}${fmt(student.balance)}
          </div>
          {orderedTodayCount > 0 && (
            <div className="bal-debt warn-soft-chip">
              ⚠ 今日已訂過 <b>{orderedTodayCount}</b> 次便當
            </div>
          )}
        </div>
      </div>

      {mode === 'order_debt' && (
        <div className="action-block">
          <div className="action-lbl">訂便當 · 記帳 (本次未付款)</div>
          <div className="action-row">
            <div className="action-name">{todayMenu.name}</div>
            <div className="action-amt mono">−${fmt(todayMenu.price)}</div>
          </div>
          <div className="action-after">
            扣款後餘額 <span className={'mono ' + (after < 0 ? 'warn' : '')}>
              {after < 0 ? '−' : ''}${fmt(after)}
            </span>
            {after < 0 && <span className="chip chip-warn">將記為欠款</span>}
          </div>
        </div>
      )}

      {mode === 'order_pay' && (
        <div className="action-block">
          <div className="action-lbl">訂便當 + 順便繳費</div>
          <div className="action-row">
            <div className="action-name">{todayMenu.name}</div>
            <div className="action-amt mono">−${fmt(todayMenu.price)}</div>
          </div>
          <div className="pay-row">
            <span className="pay-row-lbl">收現金額</span>
            <input
              className="cust-input cust-input-num mono pay-input"
              type="number"
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              autoFocus
            />
            <span>元</span>
          </div>
          <div className="topup-quick">
            {[90, 100, 200, 500, 1000].map(v => (
              <button key={v} className="quick" onClick={() => setPayAmount(String(v))}>{v}</button>
            ))}
          </div>
          <div className="action-after">
            收款後餘額 <span className={'mono ' + (after < 0 ? 'warn' : 'accent')}>
              {after < 0 ? '−' : ''}${fmt(after)}
            </span>
          </div>
        </div>
      )}

      {mode === 'topup' && (
        <div className="action-block">
          <div className="action-lbl">純繳費 / 儲值 (不訂餐)</div>
          <div className="pay-row">
            <span className="pay-row-lbl">收現金額</span>
            <input
              className="cust-input cust-input-num mono pay-input"
              type="number"
              value={payAmount}
              onChange={e => setPayAmount(e.target.value)}
              autoFocus
            />
            <span>元</span>
          </div>
          <div className="topup-quick">
            {[90, 100, 200, 500, 1000, 2000].map(v => (
              <button key={v} className="quick" onClick={() => setPayAmount(String(v))}>+{v}</button>
            ))}
          </div>
          <div className="action-after">
            儲值後餘額 <span className="mono accent">${fmt(student.balance + Number(payAmount || 0))}</span>
          </div>
        </div>
      )}

      {mode === 'cancel' && (
        <div className="action-block">
          <div className="action-lbl">取消當日訂餐</div>
          {orderedTodayCount === 0 ? (
            <div className="cancel-empty">本日尚無訂餐紀錄,無可取消項目。</div>
          ) : (
            <>
              <div className="action-row">
                <div className="action-name">取消 <b>{orderedTodayCount}</b> 筆 · {todayMenu.name}</div>
                <div className="action-amt mono accent">+${fmt(orderedTodayCount * todayMenu.price)}</div>
              </div>
              <div className="action-after">
                退款後餘額 <span className="mono accent">${fmt(after)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============ Action Bar ============
function ActionBar({ mode, setMode, student, orderedTodayCount, onConfirm, onCancel, focusZone, setFocusZone }) {
  const opts = [
    { id: 'order_debt', label: '訂便當 (記帳)',     hint: '1' },
    { id: 'order_pay',  label: '訂便當 + 繳費',     hint: '2' },
    { id: 'topup',      label: '純繳費 / 儲值',     hint: '3' },
    { id: 'cancel',     label: '取消當日訂餐',       hint: '4',
      disabled: orderedTodayCount === 0 },
  ];

  return (
    <div className="actionbar">
      <div className="modes modes-4">
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
function IdleHero({ todayMenu, todayCount, queueHint }) {
  return (
    <div className="idle">
      <div className="idle-menu">
        <div className="idle-tag">本日便當</div>
        <div className="idle-name">{todayMenu.name}</div>
        <div className="idle-meta">
          <span className="mono">${fmt(todayMenu.price)}</span>
          <span className="dot-sep">·</span>
          <span>{todayMenu.vendor}</span>
          <span className="dot-sep">·</span>
          <span>已訂 <span className="mono">{todayCount}</span> 份</span>
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
function ConfirmBanner({ flash, onDismiss }) {
  useEffect(() => {
    if (!flash) return;
    const onKey = (e) => {
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
function RecentStrip({ recent }) {
  return (
    <div className="recent">
      <div className="recent-head">最近 5 筆</div>
      <div className="recent-list">
        {recent.length === 0 && <div className="recent-empty">尚無交易</div>}
        {recent.slice(0, 5).map(r => (
          <div key={r.uid} className="recent-row">
            <span className="recent-time mono">{r.time}</span>
            <span className="recent-id mono">{r.sid}</span>
            <span className="recent-name">{r.name}</span>
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

window.TopBar = TopBar;
window.SearchBox = SearchBox;
window.CustomerCard = CustomerCard;
window.ActionBar = ActionBar;
window.IdleHero = IdleHero;
window.ConfirmBanner = ConfirmBanner;
window.RecentStrip = RecentStrip;
window.fmt = fmt;
window.sign = sign;
