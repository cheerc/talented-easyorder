import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { getIncome, getExpense } from '../../domain/transactionUtils';
import { formatTaipeiTime } from '../../utils/dateTime';
import { isFaceTransaction } from '../../domain/faceOrder';

interface TransactionStatusViewProps {
  transactions: LedgerTransaction[];
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  locked?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  order: '訂',
  payment: '繳',
  expense: '支',
};


// Ref: #402 — dual-column income/expense display
// Ref: #419 — type badge, edit/delete buttons, locked prop, font-size
// Ref: #421 — restore dual-column (regression fix from #419 PR #420)
export const TransactionStatusView = React.memo(function TransactionStatusView({
  transactions,
  onEditClick,
  onDeleteClick,
  locked,
}: TransactionStatusViewProps) {
  const header = (
    <div className="tx-status-header">
      <span />
      <span />
      <span className="tx-col-income">收入</span>
      <span className="tx-col-expense">支出</span>
      <span />{/* action column placeholder (#423) */}
    </div>
  );

  if (transactions.length === 0) {
    return (
      <div className="tx-status-view">
        {header}
        <div className="tx-status-empty">今日無交易紀錄</div>
      </div>
    );
  }

  return (
    <div className="tx-status-view">
      {header}
      {transactions.map((tx) => {
        const income = getIncome(tx);
        const expense = getExpense(tx);
        return (
          <div key={tx.transactionId} className="tx-status-row">
            <span className="tx-time">{formatTaipeiTime(tx.createdAt)}</span>
            <span className="tx-type-cell">
              <span className={'tx-type-badge tx-type-' + tx.type}>{TYPE_LABELS[tx.type] ?? tx.type}</span>
              {isFaceTransaction(tx) && <span className="tx-face-tag" title={tx.note}>刷臉</span>}
            </span>
            <span className="tx-col-income">{income != null ? `+${income}` : ''}</span>
            <span className="tx-col-expense">{expense != null ? `-${expense}` : ''}</span>
            {/* Action buttons (#419) — always render .tx-actions for grid alignment (#423) */}
            <span className="tx-actions">
              {!locked && onEditClick && tx.type !== 'expense' && (
                <button
                  className="recent-mini-btn"
                  onClick={() => onEditClick(tx)}
                  aria-label="編輯"
                >✏️</button>
              )}
              {!locked && onDeleteClick && (
                <button
                  className="recent-mini-btn recent-mini-del"
                  onClick={() => onDeleteClick(tx)}
                  aria-label="刪除"
                >✕</button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
});
