import React, { useState, useMemo } from 'react';
import { usePosStore } from '../../store/posStore';
import { fmt } from '../pos-components';

function statusLabel(status: string) {
  if (status === 'closed') return '已關帳';
  if (status === 'reopened') return '已重開';
  return '營業中';
}

function statusClass(status: string) {
  if (status === 'closed') return 'pill-ok';
  if (status === 'reopened') return 'pill-warn';
  return 'pill';
}

export const SettlementHistoryTable = React.memo(function SettlementHistoryTable() {
  const dailySettlements = usePosStore((s) => s.dailySettlements);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...dailySettlements].sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  }, [dailySettlements]);

  if (sorted.length === 0) {
    return <div className="rpt-empty">尚無關帳紀錄</div>;
  }

  return (
    <div className="rpt-table">
      <div className="rpt-th" style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px 100px 80px 100px 120px' }}>
        <div>日期</div>
        <div>狀態</div>
        <div>訂餐數</div>
        <div>系統現金</div>
        <div>實際點算</div>
        <div>差異</div>
        <div>關帳人</div>
        <div>關帳時間</div>
      </div>
      {sorted.map((s) => (
        <React.Fragment key={s.settlementId}>
          <div
            className="rpt-tr"
            style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px 100px 80px 100px 120px', cursor: 'pointer' }}
            onClick={() => setExpandedId(expandedId === s.settlementId ? null : s.settlementId)}
          >
            <div className="mono">{s.businessDate}</div>
            <div><span className={statusClass(s.status)}>{statusLabel(s.status)}</span></div>
            <div className="mono">{s.orderCount}</div>
            <div className="mono">${fmt(s.expectedCash)}</div>
            <div className="mono">${fmt(s.countedCash)}</div>
            <div className={`mono ${s.difference !== 0 ? 'warn' : ''}`}>
              {s.difference > 0 ? '+' : ''}{fmt(s.difference)}
            </div>
            <div>{s.closedBy}</div>
            <div className="mono dim" style={{ fontSize: '12px' }}>{s.closedAt.slice(11, 19)}</div>
          </div>
          {expandedId === s.settlementId && (
            <div className="rpt-expand" style={{ padding: '12px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--line-2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', fontSize: '13px' }}>
                <div><span className="dim">交易筆數：</span><span className="mono">{s.transactionCount}</span></div>
                <div><span className="dim">備註：</span>{s.note || '-'}</div>
                <div><span className="dim">同步狀態：</span><span className="mono">{s.syncStatus}</span></div>
                {s.reopenedBy && (
                  <>
                    <div><span className="dim">重開人：</span>{s.reopenedBy}</div>
                    <div><span className="dim">重開時間：</span><span className="mono">{s.reopenedAt?.slice(0, 19)}</span></div>
                    <div><span className="dim">重開原因：</span>{s.reopenReason || '-'}</div>
                  </>
                )}
              </div>
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
});
