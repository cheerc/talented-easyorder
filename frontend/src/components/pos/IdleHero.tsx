import React from 'react';
import type { TodayMenu } from '../../domain/menu';
import { fmt } from './QuickAmounts';

interface IdleHeroProps {
  todayMenu: TodayMenu;
  todayCount: number;
  vendorPhone: string | undefined;
  queueHint?: string;
  onEnterExpense?: () => void;
}

export const IdleHero = React.memo(function IdleHero({ todayMenu, todayCount, vendorPhone, queueHint, onEnterExpense }: IdleHeroProps) {
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
        <div style={{ marginTop: '8px' }}>
          <button
            className="mode"
            onClick={onEnterExpense}
            style={{ flex: 'none', width: 'auto' }}
          >
            <span className="mode-key">A</span>
            <span className="mode-lbl">新增 收入/支出</span>
          </button>
        </div>
        <div className="idle-keys" style={{ marginTop: '8px' }}>
          <span className="kbd">Q</span> 訂餐 · <span className="kbd">W</span> 繳費 · <span className="kbd">↵</span> 確認 · <span className="kbd">Esc</span> 返回
        </div>
        {queueHint && <div className="idle-queue">{queueHint}</div>}
      </div>
    </div>
  );
});
