import React from 'react';
import { fmt } from '../pos-components';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';

interface LedgerGroupedTableProps {
  groups: LedgerGroup[];
  onToggleExpand: (sid: string) => void;
  expandedSids: Set<string>;
  onCorrectClick: (t: LedgerTransaction) => void;
  onVoidClick: (t: LedgerTransaction) => void;
  dateStatus: string;
}

export function LedgerGroupedTable({
  groups,
  onToggleExpand,
  expandedSids,
  onCorrectClick,
  onVoidClick,
  dateStatus,
}: LedgerGroupedTableProps) {
  return (
    <div className="rpt-table">
      <div className="rpt-th" style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto' }}>
        <div>最後時間</div><div>編號</div><div>姓名</div>
        <div className="r">當日應付</div><div className="r">當日實收</div><div className="r">目前餘額</div><div className="r">狀態</div>
      </div>
      {groups.map(g => {
        const isExpanded = expandedSids.has(g.studentId);
        return (
          <React.Fragment key={g.studentId}>
            <div className={'rpt-tr ' + (isExpanded ? 'expanded-head' : '')}
                 onClick={() => onToggleExpand(g.studentId)}
                 style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', cursor: 'pointer' }}>
              <div className="mono dim">{g.latestCreatedAt.slice(11, 19)}</div>
              <div className="mono">{g.studentId}</div>
              <div style={{ fontWeight: '600' }}>{g.studentNameSnapshot}</div>
              <div className="r mono neg">{g.mealTotal > 0 ? `−$${fmt(g.mealTotal)}` : '-'}</div>
              <div className="r mono pos">{g.paidTotal > 0 ? `+$${fmt(g.paidTotal)}` : '-'}</div>
              <div className="r mono">{g.afterBalance < 0 ? '−' : ''}${fmt(Math.abs(g.afterBalance))}</div>
              <div className="r">
                <span className="pill" style={{ fontSize: '10px', background: isExpanded ? 'var(--ink)' : 'var(--line-2)', color: isExpanded ? '#fff' : 'var(--ink-3)' }}>
                  {g.recordCount} 筆紀錄 {isExpanded ? '▴' : '▾'}
                </span>
              </div>
            </div>

            {isExpanded && (
              <div className="rpt-details">
                {g.transactions.slice().reverse().map(t => {
                  const locked = dateStatus === 'closed';
                  return (
                    <div key={t.transactionId} className="rpt-detail-row">
                      <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
                      <div className="dim">{t.type === 'order' ? '訂餐' : t.type === 'topup' ? '儲值' : t.type === 'cancel' ? '取消' : t.type === 'correction' ? '更正' : '作廢'}</div>
                      <div className={'r mono ' + (t.mealPrice > 0 ? 'neg' : t.mealPrice < 0 ? 'pos' : '')}>
                        {t.mealPrice !== 0 ? <>{t.mealPrice > 0 ? '−' : '+'}${fmt(Math.abs(t.mealPrice))}</> : <>-</>}
                      </div>
                      <div className={'r mono ' + (t.paidAmount > 0 ? 'pos' : '')}>
                        {t.paidAmount > 0 ? <>+${fmt(t.paidAmount)}</> : <>-</>}
                      </div>
                      <div className="dim italic" style={{ fontSize: '12px' }}>
                        {t.note}
                      </div>
                      <div className="rpt-row-actions">
                        {locked ? (
                          <span className="dim" style={{fontSize:'11px'}}>🔒 已關帳</span>
                        ) : (
                          <>
                            <button className="rpt-mini-btn" onClick={() => onCorrectClick(t)}>更正</button>
                            <button className="rpt-mini-btn rpt-mini-del" onClick={() => onVoidClick(t)}>刪除</button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </React.Fragment>
        );
      })}
      {groups.length === 0 && (
        <div className="rpt-empty">尚無交易紀錄</div>
      )}
    </div>
  );
}