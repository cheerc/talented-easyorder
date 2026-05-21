import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { fmt, sign } from './QuickAmounts';

interface RecentStripProps {
  recent: (LedgerTransaction & { uid: string })[];
  onItemClick?: (studentId: string) => void;
}

export const RecentStrip = React.memo(function RecentStrip({ recent, onItemClick }: RecentStripProps) {
  return (
    <div className="recent">
      <div className="recent-head">最近 20 筆</div>
      <div className="recent-list">
        {recent.length === 0 && <div className="recent-empty">尚無交易</div>}
        {recent.slice(0, 20).map(r => (
          <div key={r.uid} className="recent-row" onClick={() => onItemClick?.(r.studentId)} style={onItemClick ? { cursor: 'pointer' } : undefined}>
            <span className="recent-time mono">{r.createdAt.slice(11, 19)}</span>
            <span className="recent-id mono">{r.studentId === '__cashier__' ? '' : r.studentId}</span>
            <span className="recent-name">
              {r.studentNameSnapshot}
            </span>
            <span className={'recent-type ' + (r.type === 'expense'
              ? (r.paidAmount > 0 ? 'type-income' : 'type-expense')
              : 'type-' + r.type)}>{
                r.type === 'order' ? '訂' :
                  r.type === 'payment' ? '繳' :
                    r.type === 'expense' ? (r.paidAmount > 0 ? '收' : '支') : ''
              }</span>
            <span className={'recent-amt mono ' + (
              r.type === 'order'
                ? (r.afterBalance >= 0 ? 'pos' : 'neg')
                : r.type === 'payment'
                  ? (r.afterBalance >= 0 ? 'pos' : 'neg')
                  : r.type === 'expense'
                    ? (r.paidAmount > 0 ? 'pos' : 'neg')
                    : (r.amount > 0 ? 'pos' : 'neg')
            )}>
              {r.type === 'order'
                ? (r.afterBalance >= 0
                  ? <><span className="recent-amt-lbl">已繳費</span><span className="recent-amt-val">{fmt(r.mealPrice)}</span></>
                  : <><span className="recent-amt-lbl">待繳費</span><span className="recent-amt-val">{fmt(Math.abs(r.afterBalance))}</span></>)
                : r.type === 'payment'
                  ? (r.afterBalance >= 0
                    ? <span className="recent-amt-val">+{fmt(r.paidAmount)}</span>
                    : <><span className="recent-amt-lbl">待繳費</span><span className="recent-amt-val">{fmt(Math.abs(r.afterBalance))}</span></>)
                  : r.type === 'expense'
                    ? (r.note
                      ? <><span className="recent-amt-lbl">{(r.note.slice(0, 4) + '　　　').slice(0, 4)}</span><span className="recent-amt-val">{r.paidAmount > 0 ? '+' : '−'}{fmt(r.paidAmount > 0 ? r.paidAmount : r.mealPrice)}</span></>
                      : <span className="recent-amt-val">{r.paidAmount > 0 ? '+' : '−'}{fmt(r.paidAmount > 0 ? r.paidAmount : r.mealPrice)}</span>)
                    : <><span className="recent-amt-val">{sign(r.amount)}{fmt(r.amount)}</span></>
              }</span>
          </div>
        ))}
      </div>
    </div>
  );
});
