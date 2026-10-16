import React from "react";
import type { TodayMenu } from '../../domain/menu';
import { fmt } from './utils';
import { isMenuReady } from '../../domain/menu';
import { useMenuForDate } from '../../store/selectors';

interface IdleHeroProps {
  todayMenu: TodayMenu;
  todayCount: number;
  /** 其他餐點份數（不算進今日餐點）。 */
  todayOtherCount?: number;
  vendorPhone: string;
  queueHint?: string;
  onEnterExpense?: () => void;
}
export const IdleHero = React.memo(function IdleHero({ todayMenu, todayCount, todayOtherCount = 0, vendorPhone }: IdleHeroProps) {
  // M3 D06：這天沒有自己的晚餐設定、沿用較早日期時提醒確認，不讓新的一天默默用舊菜單。
  const resolved = useMenuForDate(todayMenu.businessDate);
  const inheritedFrom = resolved.source === 'inherited' ? resolved.fromDate : null;
  if (!isMenuReady(todayMenu)) {
    // M0：空白資料集尚未設定今日晚餐。
    return (
      <div className="idle">
        <div className="idle-menu">
          <div className="idle-tag">今日餐點</div>
          <div className="idle-name">尚未設定今日晚餐</div>
          <div className="idle-meta">請到 F3 今日設定填寫餐點名稱與單價；設定前只能繳費，不能訂餐。</div>
        </div>
      </div>
    );
  }
  return (
    <div className="idle">
      <div className="idle-menu">
        <div className="idle-tag">今日餐點</div>
        <div className="idle-name" style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
          <span className="mono" style={{ color: 'var(--c-brand)' }}>${fmt(todayMenu.price)}</span>
          <span>{todayMenu.itemName}</span>
        </div>
        <div className="idle-meta" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span>{todayMenu.vendorNameSnapshot}</span>
            {vendorPhone && <span className="mono">{vendorPhone}</span>}
          </div>
          <div>
            已訂 今日餐點 <span className="mono">{todayCount}</span> 份
            {todayOtherCount > 0 && <> ＋ 其他 <span className="mono">{todayOtherCount}</span> 份</>}
          </div>
          {inheritedFrom && (
            <div role="note" style={{ color: 'var(--c-warn)' }}>
              {todayMenu.businessDate} 還沒有自己的晚餐設定，目前沿用 {inheritedFrom} 的菜單；請到 F3 確認後按「儲存今日設定」。
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
