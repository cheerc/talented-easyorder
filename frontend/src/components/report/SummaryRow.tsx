import React from 'react';
import { fmt } from '../pos-components';
import type { LedgerGroup } from '../../domain/ledgerReport';

export interface SummaryRowProps {
  group: LedgerGroup;
  groupIndex: number;
}

export const SUMMARY_ROW_HEIGHT = 36;

export const SummaryRow = React.memo(function SummaryRow({ group, groupIndex }: SummaryRowProps) {
  const firstAfter = group.transactions[0]?.afterBalance ?? group.afterBalance;
  const netChange = group.afterBalance - firstAfter;
  return (
    <div key={`s-${groupIndex}`} className="rpt-detail-row rpt-summary-row" style={{ background: 'var(--bg-2)', fontWeight: 500, fontSize: '12px', borderBottom: '2px solid var(--line-2)', display: 'flex', gap: '12px', padding: '4px 12px', alignItems: 'center', height: SUMMARY_ROW_HEIGHT }}>
      <span>📋 訂餐 {group.recordCount} 筆</span>
      <span className="pos">收現 +${fmt(group.paidTotal)}</span>
      <span className={netChange < 0 ? 'warn' : 'pos'}>
        淨變動 {netChange < 0 ? '−' : '+'}${fmt(Math.abs(netChange))}
      </span>
    </div>
  );
});
