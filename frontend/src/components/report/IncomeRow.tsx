import React from 'react';
import { fmt } from '../pos-components';
import type { LedgerTransaction } from '../../domain/ledger';

export interface IncomeRowProps {
  tx: LedgerTransaction;
  onDeleteClick: (t: LedgerTransaction) => void;
  dateStatus: string;
}

export const DETAIL_ROW_HEIGHT = 40;

export const IncomeRow = React.memo(function IncomeRow({ tx: t, onDeleteClick, dateStatus }: IncomeRowProps) {
  const paidAmount = Number(t.paidAmount) || 0;
  const timeStr = t.createdAt ? t.createdAt.slice(11, 19) : '';
  return (
    <div key={t.transactionId} className="rpt-detail-row counter-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center', borderBottom: '1px solid var(--line-1)', padding: '0 18px', background: 'rgba(34,197,94,0.04)' }}>
      <div className="mono dim">{timeStr}</div>
      <div className="dim">櫃台</div>
      <div className="pos" style={{ fontWeight: 600 }}>收入</div>
      <div className="r dim">-</div>
      <div className="r mono pos">+${fmt(paidAmount)}</div>
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
