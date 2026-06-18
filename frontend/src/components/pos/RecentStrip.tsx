import React, { useState, useCallback } from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';
import { fmt } from './utils';
import { getIncome, getExpense } from '../../domain/transactionUtils';

interface RecentStripProps {
  groups: LedgerGroup[];
  onStudentClick?: (studentId: string) => void;
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  dateStatus: string;
}

const TYPE_LABELS: Record<string, string> = {
  order: '訂',
  payment: '繳',
  expense: '支',
};

const RecentDetailRow = React.memo(function RecentDetailRow({
  tx,
  locked,
  onEditClick,
  onDeleteClick,
}: {
  tx: LedgerTransaction;
  locked: boolean;
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
}) {
  const time = tx.createdAt.slice(11, 19);
  const typeLabel = TYPE_LABELS[tx.type] ?? tx.type;
  const income = getIncome(tx);
  const expense = getExpense(tx);

  return (
    <div className="recent-detail-row">
      <span className="recent-time mono">{time}</span>
      <span className={'recent-type type-' + tx.type}>{typeLabel}</span>
      <span className="tx-col-income mono">{income != null ? `+${fmt(income)}` : ''}</span>
      <span className="tx-col-expense mono">{expense != null ? `−${fmt(expense)}` : ''}</span>
      {!locked && (onEditClick || onDeleteClick) && (
        <span className="recent-detail-actions">
          {onEditClick && tx.type !== 'expense' && (
            <button
              className="recent-mini-btn"
              onClick={(e) => { e.stopPropagation(); onEditClick(tx); }}
              aria-label="編輯"
            >✏️</button>
          )}
          {onDeleteClick && (
            <button
              className="recent-mini-btn recent-mini-del"
              onClick={(e) => { e.stopPropagation(); onDeleteClick(tx); }}
              aria-label="刪除"
            >✕</button>
          )}
        </span>
      )}
    </div>
  );
});

export const RecentStrip = React.memo(function RecentStrip({
  groups,
  onStudentClick,
  onEditClick,
  onDeleteClick,
  dateStatus,
}: RecentStripProps) {
  const [expandedSids, setExpandedSids] = useState<Set<string>>(new Set());
  const locked = dateStatus === 'closed';

  const toggleExpand = useCallback((sid: string) => {
    setExpandedSids(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }, []);

  const handleStudentRowClick = useCallback((sid: string) => {
    toggleExpand(sid);
    onStudentClick?.(sid);
  }, [toggleExpand, onStudentClick]);

  // Show max 20 groups
  const displayGroups = groups.slice(0, 20);

  return (
    <div className="recent">
      <div className="recent-head">最近帳戶</div>
      <div className="recent-list">
        {displayGroups.length === 0 && <div className="recent-empty">尚無交易</div>}
        {displayGroups.map(g => {
          const isExpanded = expandedSids.has(g.studentId);
          const isNeg = g.afterBalance < 0;
          return (
            <div key={g.studentId} className="recent-group">
              {/* Student summary row */}
              <div
                className={'recent-row recent-row--group' + (isExpanded ? ' recent-row--expanded' : '')}
                onClick={() => handleStudentRowClick(g.studentId)}
                style={{ cursor: 'pointer' }}
              >
                <span className="recent-expand-icon">{isExpanded ? '▾' : '▸'}</span>
                <span className="recent-name">{g.studentNameSnapshot}</span>
                <span className="recent-group-count">{g.recordCount}筆</span>
                <span className={'recent-amt mono ' + (isNeg ? 'neg' : 'pos')}>
                  餘額 {isNeg ? '−' : ''}{fmt(g.afterBalance)}
                </span>
              </div>
              {/* Expanded detail rows */}
              {isExpanded && (
                <div className="recent-details">
                  <div className="recent-detail-header">
                    <span />
                    <span />
                    <span className="tx-col-income">收入</span>
                    <span className="tx-col-expense">支出</span>
                  </div>
                  {g.transactions.map(tx => (
                    <RecentDetailRow
                      key={tx.transactionId}
                      tx={tx}
                      locked={locked}
                      onEditClick={onEditClick}
                      onDeleteClick={onDeleteClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
