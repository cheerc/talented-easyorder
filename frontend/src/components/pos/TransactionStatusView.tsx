import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { getIncome, getExpense } from '../../domain/transactionUtils';
import { fmt } from './utils';

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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export const TransactionStatusView = React.memo(function TransactionStatusView({
  transactions,
  onEditClick,
  onDeleteClick,
  locked,
}: TransactionStatusViewProps) {
  if (transactions.length === 0) {
    return (
      <div className="tx-status-view">
        <div className="tx-status-empty">今日無交易紀錄</div>
      </div>
    );
  }

  return (
    <div className="tx-status-view">
      {transactions.map((tx) => {
        const income = getIncome(tx);
        const expense = getExpense(tx);
        const isIncome = income != null;
        const displayAmount = isIncome ? income : expense!;
        const sign = isIncome ? '+' : '−';
        const colorClass = isIncome ? 'pos' : 'neg';

        return (
          <div key={tx.transactionId} className="tx-status-row">
            <span className="tx-time">{formatTime(tx.createdAt)}</span>
            <span className={'tx-type-badge tx-type-' + tx.type}>{TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className={`tx-amount mono ${colorClass}`}>{sign}{fmt(displayAmount)}</span>
            {!locked && (onEditClick || onDeleteClick) && (
              <span className="tx-actions">
                {onEditClick && tx.type !== 'expense' && (
                  <button
                    className="recent-mini-btn"
                    onClick={() => onEditClick(tx)}
                    aria-label="編輯"
                  >✏️</button>
                )}
                {onDeleteClick && (
                  <button
                    className="recent-mini-btn recent-mini-del"
                    onClick={() => onDeleteClick(tx)}
                    aria-label="刪除"
                  >✕</button>
                )}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});
