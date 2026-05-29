import React, { useMemo } from "react";

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
