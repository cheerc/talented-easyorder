import React from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import { fmt } from './utils';

interface RecentStripProps {
  groups: LedgerGroup[];
  /** M2 F03：各帳戶目前餘額。有提供時顯示它，而不是這一串交易最後一筆的結餘。 */
  balances?: ReadonlyMap<string, number>;
  onStudentClick?: (studentId: string) => void;
  // dateStatus kept in interface for backward compatibility but not used internally
  dateStatus?: string;
}

export const RecentStrip = React.memo(function RecentStrip({
  groups,
  balances,
  onStudentClick,
}: RecentStripProps) {
  // Show max 20 groups
  const displayGroups = groups.slice(0, 20);

  return (
    <div className="recent">
      <div className="recent-head">最近帳戶</div>
      <div className="recent-list">
        {displayGroups.length === 0 && <div className="recent-empty">尚無交易</div>}
        {displayGroups.map(g => {
          const balance = balances?.get(g.studentId) ?? g.afterBalance;
          const isNeg = balance < 0;
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
                  餘額 {isNeg ? '−' : '+'}{fmt(balance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
