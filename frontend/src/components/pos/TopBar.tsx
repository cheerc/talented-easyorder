import React, { useMemo } from 'react';

interface TopBarProps {
  tab: string;
  setTab: (tab: string) => void;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  todayCount: number;
  viewDate: string;
  setViewDate: (date: string) => void;
  systemDate: string;
  queuedCount?: number;
  failedSyncCount?: number;
  conflictSyncCount?: number;
  onDashboard?: () => void;
}

export const TopBar = React.memo(function TopBar({ tab, setTab, online, syncing, lastSync, todayCount, viewDate, setViewDate, queuedCount = 0, failedSyncCount = 0, conflictSyncCount = 0, onDashboard }: TopBarProps) {
  const tabs = [
    { id: 'pos',     label: '櫃台', hint: 'F1' },
    { id: 'report',  label: '今日帳', hint: 'F2' },
    { id: 'admin',   label: '今日設定', hint: 'F3' },
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
