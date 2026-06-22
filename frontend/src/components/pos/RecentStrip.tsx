import React from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import { fmt } from './utils';

interface RecentStripProps {
  groups: LedgerGroup[];
  onStudentClick?: (studentId: string) => void;
  dateStatus: string;
}

export const RecentStrip = React.memo(function RecentStrip({
  groups,
  onStudentClick,
  dateStatus,
}: RecentStripProps) {
  // Show max 20 groups
  const displayGroups = groups.slice(0, 20);

  return (
    <div className="recent">
      <div className="recent-head">最近帳戶</div>
      <div className="recent-list">
        {displayGroups.length === 0 && <div className="recent-empty">尚無交易</div>}
        {displayGroups.map(g => {
          const isNeg = g.afterBalance < 0;
          return (
            <div key={g.studentId} className="recent-group">
              <div
                className="recent-row recent-row--group"
                onClick={() => onStudentClick?.(g.studentId)}
                style={{ cursor: onStudentClick ? 'pointer' : 'default' }}
              >
                <span className="recent-name">{g.studentNameSnapshot}</span>
                <span className="recent-group-count">{g.transactions.filter(t => t.type === 'order').length}個便當</span>
                <span className={'recent-amt mono ' + (isNeg ? 'neg' : 'pos')}>
                  餘額 {isNeg ? '−' : '+'}{fmt(g.afterBalance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
