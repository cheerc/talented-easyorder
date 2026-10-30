import React from 'react';
import { fmt } from '../pos-components';
import { groupRecordSummary, type LedgerGroup } from '../../domain/ledgerReport';
import { ClipboardList } from 'lucide-react';

export interface SummaryRowProps {
  group: LedgerGroup;
  groupIndex: number;
}

export const SUMMARY_ROW_HEIGHT = 36;

export const SummaryRow = React.memo(function SummaryRow({ group, groupIndex }: SummaryRowProps) {
  // M2：淨變動是區間內每一筆的增減加總。原本用「最後結餘 − 第一筆結餘」，少算了第一筆本身。
  const netChange = group.transactions.reduce((sum, t) => sum + t.amount, 0);
  return (
    <div key={`s-${groupIndex}`} className="rpt-detail-row rpt-summary-row" style={{ background: 'var(--bg-2)', fontWeight: 500, fontSize: '12px', borderBottom: '2px solid var(--line-2)', display: 'flex', gap: '12px', padding: '4px 12px', alignItems: 'center', height: SUMMARY_ROW_HEIGHT }}>
      <span><ClipboardList size={14} aria-hidden="true" /> {groupRecordSummary(group.transactions)}</span>
      <span className="pos">收現 +${fmt(group.paidTotal)}</span>
      <span className={netChange < 0 ? 'warn' : 'pos'}>
        淨變動 {netChange < 0 ? '−' : '+'}${fmt(Math.abs(netChange))}
      </span>
    </div>
  );
});
