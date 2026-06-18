import React from 'react';
import { fmt } from '../pos-components';
import type { ReportTransactionView } from '../../domain/transactionViews';

export interface ExpenseOnlyRowProps {
  tx: ReportTransactionView;
  onDeleteClick: (t: ReportTransactionView) => void;
  dateStatus: string;
}

export const DETAIL_ROW_HEIGHT = 40;

export const ExpenseOnlyRow = React.memo(function ExpenseOnlyRow({ tx: t, onDeleteClick, dateStatus }: ExpenseOnlyRowProps) {
  const mealPrice = Number(t.mealPrice) || 0;
  const timeStr = t.createdAt ? t.createdAt.slice(11, 19) : '';
  return (
    <div key={t.transactionId} className="rpt-detail-row counter-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center', borderBottom: '1px solid var(--line-1)', padding: '0 18px', background: 'rgba(239,68,68,0.04)' }}>
      <div className="mono dim">{timeStr}</div>
      <div className="dim">櫃台</div>
      <div className="neg" style={{ fontWeight: 600 }}>支出</div>
      <div className="r mono neg">−${fmt(mealPrice)}</div>
      <div className="r dim">-</div>
      <div className="r dim">-</div>
      <div className="rpt-detail-actions">
        <span className="dim italic rpt-detail-note">{t.note}</span>
        <div className="rpt-row-actions">
          {dateStatus !== 'closed' && <button className="rpt-mini-btn rpt-mini-del" onClick={() => onDeleteClick(t)}>刪除</button>}
        </div>
      </div>
    </div>
  );
});
