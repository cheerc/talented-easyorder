import React from 'react';
import { fmt } from '../pos-components';
import type { LedgerGroup } from '../../domain/ledgerReport';

export interface GroupRowProps {
  group: LedgerGroup;
  groupIndex: number;
  isExpanded: boolean;
  onToggleExpand: (sid: string) => void;
}

export const GROUP_ROW_HEIGHT = 48;

export const GroupRow = React.memo(function GroupRow({ group, groupIndex, isExpanded, onToggleExpand }: GroupRowProps) {
  return (
    <div
      key={`g-${groupIndex}`}
      className={'rpt-tr ' + (isExpanded ? 'expanded-head' : '')}
      onClick={() => onToggleExpand(group.studentId)}
      style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', cursor: 'pointer', display: 'grid', height: GROUP_ROW_HEIGHT, alignItems: 'center', borderTop: '1px solid var(--line-2)' }}
    >
      <div className="mono dim">{group.latestCreatedAt.slice(11, 19)}</div>
      <div className="mono">{group.studentId}</div>
      <div style={{ fontWeight: '600' }}>{group.studentNameSnapshot}</div>
      <div className="r mono neg">{group.mealTotal > 0 ? `−$${fmt(group.mealTotal)}` : '-'}</div>
      <div className="r mono pos">{group.paidTotal > 0 ? `+$${fmt(group.paidTotal)}` : '-'}</div>
      <div className="r mono">{group.afterBalance < 0 ? '−' : ''}${fmt(Math.abs(group.afterBalance))}</div>
      <div className="r">
        <span className="pill" style={{ fontSize: '10px', background: isExpanded ? 'var(--ink)' : 'var(--line-2)', color: isExpanded ? '#fff' : 'var(--ink-3)' }}>
          {group.recordCount} 筆紀錄 {isExpanded ? '▴' : '▾'}
        </span>
      </div>
    </div>
  );
});
