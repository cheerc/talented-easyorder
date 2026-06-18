import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { getIncome, getExpense } from '../../domain/transactionUtils';

interface TransactionStatusViewProps {
  transactions: LedgerTransaction[];
  actions?: (tx: LedgerTransaction) => React.ReactNode;
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
  actions,
}: TransactionStatusViewProps) {
  if (transactions.length === 0) {
    return (
      <div className="tx-status-view">
        <div className="tx-status-header">
          <span />
          <span />
          <span className="tx-col-income">收入</span>
          <span className="tx-col-expense">支出</span>
        </div>
        <div className="tx-status-empty">今日無交易紀錄</div>
      </div>
    );
  }

  return (
    <div className="tx-status-view">
      <div className="tx-status-header">
        <span />
        <span />
        <span className="tx-col-income">收入</span>
        <span className="tx-col-expense">支出</span>
      </div>
      {transactions.map((tx) => {
        const income = getIncome(tx);
        const expense = getExpense(tx);
        return (
          <div key={tx.transactionId} className="tx-status-row">
            <span className="tx-time">{formatTime(tx.createdAt)}</span>
            <span className={'tx-type-badge tx-type-' + tx.type}>{TYPE_LABELS[tx.type] ?? tx.type}</span>
            <span className="tx-col-income">{income != null ? `+${income}` : ''}</span>
            <span className="tx-col-expense">{expense != null ? `-${expense}` : ''}</span>
            {actions?.(tx)}
          </div>
        );
      })}
    </div>
  );
});
