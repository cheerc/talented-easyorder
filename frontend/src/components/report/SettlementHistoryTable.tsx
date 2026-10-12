import React, { useState, useMemo } from 'react';
import { useSession } from '../../store/selectors';
import { fmt, sign } from '../pos-components';
import { formatTaipeiDateTime, formatTaipeiTime } from '../../utils/dateTime';
import { operatorLabel } from '../../domain/operatorId';

const PAGE_SIZE = 20;

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
  const { dailySettlements } = useSession();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    return [...dailySettlements].sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  }, [dailySettlements]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (sorted.length === 0) {
    return <div className="rpt-empty">尚無關帳紀錄</div>;
  }

  return (
    <div className="rpt-table">
      <div className="rpt-th" style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 100px 100px 80px 100px 120px' }}>
        <div>日期</div>
        <div>狀態</div>
        <div>訂餐數</div>
        <div>應有現金</div>
        <div>實際點算</div>
        <div>差異</div>
        <div>關帳人</div>
        <div>關帳時間</div>
      </div>
      {paged.map((s) => (
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
              {sign(s.difference)}${fmt(s.difference)}
            </div>
            <div>{operatorLabel(s.closedBy)}</div>
            <div className="mono dim" style={{ fontSize: '12px' }}>{formatTaipeiTime(s.closedAt)}</div>
          </div>
          {expandedId === s.settlementId && (
            <div className="rpt-expand" style={{ padding: '12px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--line-2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', fontSize: '13px' }}>
                <div title="2026-10 起關帳的紀錄含未付款訂餐；更早的紀錄只算有收付現金的交易"><span className="dim">交易筆數：</span><span className="mono">{s.transactionCount}</span></div>
                <div><span className="dim">備註：</span>{s.note || '-'}</div>
                <div><span className="dim">同步狀態：</span><span className="mono">{s.syncStatus}</span></div>
                {s.reopenedBy && (
                  <>
                    <div><span className="dim">重開人：</span>{operatorLabel(s.reopenedBy)}</div>
                    <div><span className="dim">重開時間：</span><span className="mono">{formatTaipeiDateTime(s.reopenedAt)}</span></div>
                    <div><span className="dim">重開原因：</span>{s.reopenReason || '-'}</div>
                  </>
                )}
              </div>
            </div>
          )}
        </React.Fragment>
      ))}
      {sorted.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
          <button className="ghost-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button>
          <span className="dim" style={{ fontSize: '13px' }}>第 {page + 1} / {totalPages} 頁（共 {sorted.length} 筆）</span>
          <button className="ghost-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一頁</button>
        </div>
      )}
    </div>
  );
});
