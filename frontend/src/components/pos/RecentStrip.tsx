import React from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import { isOtherMealOrder } from '../../domain/ledger';
import { fmt } from './utils';

/**
 * M2 #2：依該帳戶當天的有效交易內容計算摘要字串：
 * - 只有今日餐點：`今日餐點 N`
 * - 只有其他餐點：`其他餐點 M`
 * - 兩種都有：`今日餐點 N・其他餐點 M`
 * - 沒有訂餐、只有繳費：`僅繳費`
 */
function formatRecentMealSummary(transactions: LedgerGroup['transactions']): string {
  let bento = 0;
  let other = 0;
  let payments = 0;
  let refunds = 0;

  for (const t of transactions) {
    if (t.type === 'order') {
      if (isOtherMealOrder(t)) {
        other++;
      } else {
        bento++;
      }
    } else if (t.type === 'payment') {
      payments++;
    } else if (t.type === 'refund') {
      refunds++;
    }
  }

  if (bento > 0 && other > 0) {
    return `今日餐點 ${bento}・其他餐點 ${other}`;
  }
  if (bento > 0) {
    return `今日餐點 ${bento}`;
  }
  if (other > 0) {
    return `其他餐點 ${other}`;
  }
  if (payments > 0 && refunds > 0) {
    return '繳費・退款';
  }
  if (payments > 0) {
    return '僅繳費';
  }
  if (refunds > 0) {
    return '僅退款';
  }
  return '';
}

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
          const summary = formatRecentMealSummary(g.transactions);
          return (
            <div key={g.studentId} className="recent-group">
              <div
                className="recent-row recent-row--group"
                onClick={() => onStudentClick?.(g.studentId)}
                style={{ cursor: onStudentClick ? 'pointer' : 'default' }}
              >
                <span className="recent-name" title={g.studentNameSnapshot}>{g.studentNameSnapshot}</span>
                {summary && (
                  <span className="recent-group-count" title={summary}>{summary}</span>
                )}
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
