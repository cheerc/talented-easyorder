import React from "react";
import type { TodayMenu } from '../../domain/menu';
import { fmt } from './utils';

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
