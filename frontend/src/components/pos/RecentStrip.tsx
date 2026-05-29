import React from "react";
import { fmt } from './utils';

interface RecentStripProps {
  recent: (import('../../domain/ledger').MergedTransaction & { uid: string })[];
  onItemClick?: (studentId: string) => void;
}
export const RecentStrip = React.memo(function RecentStrip({ recent, onItemClick }: RecentStripProps) {
  const orders = recent.filter(r => r.type === 'order');
  return (
    <div className="recent">
      <div className="recent-head">最近 20 筆</div>
      <div className="recent-list">
        {orders.length === 0 && <div className="recent-empty">尚無交易</div>}
        {orders.slice(0, 20).map(r => {
          const isNeg = r.displayBalance < 0;
          return (
          <div key={r.uid} className="recent-row" onClick={() => onItemClick?.(r.studentId)} style={onItemClick ? { cursor: 'pointer' } : undefined}>
            <span className="recent-time mono">{r.createdAt.slice(11, 19)}</span>
            <span className="recent-id mono">{r.studentId === '__cashier__' ? '' : r.studentId}</span>
            <span className="recent-name">
              {r.studentNameSnapshot}
            </span>
            <span className="recent-type type-order">訂</span>
            <span className={'recent-amt mono ' + (isNeg ? 'neg' : 'pos')}>
              <span className="recent-amt-lbl">{r.orderCount}份</span>
              <span className="recent-amt-val">餘額 {isNeg ? '−' : ''}{fmt(r.displayBalance)}</span>
            </span>
          </div>
          );
        })}
      </div>
    </div>
  );
});
