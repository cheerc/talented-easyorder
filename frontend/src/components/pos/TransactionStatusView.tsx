import React from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { isOtherMealOrder } from '../../domain/ledger';
import { formatTaipeiTime } from '../../utils/dateTime';
import { isFaceTransaction } from '../../domain/faceOrder';
import { fmt } from './utils';

interface TransactionStatusViewProps {
  transactions: LedgerTransaction[];
  student?: {
    displayName: string;
    currentBalance: number;
  };
  todayMenu?: {
    itemName: string;
  } | null;
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  onViewAllHistory?: () => void;
  locked?: boolean;
}

function getTxItemLabel(tx: LedgerTransaction, todayMenu?: { itemName: string } | null): string {
  if (tx.type === 'order') {
    if (isOtherMealOrder(tx)) {
      return `其他餐點：${tx.otherItemName || tx.note || '未命名'}`;
    }
    return `今日餐點：${tx.menuNameSnapshot || todayMenu?.itemName || '未命名'}`;
  }
  if (tx.type === 'payment') {
    return '繳費';
  }
  if (tx.type === 'refund') {
    return tx.note ? `退款：${tx.note}` : '退款';
  }
  return tx.note || '櫃台收支';
}

export const TransactionStatusView = React.memo(function TransactionStatusView({
  transactions,
  student = { displayName: '學員', currentBalance: 0 },
  todayMenu,
  onEditClick,
  onDeleteClick,
  onViewAllHistory,
  locked,
}: TransactionStatusViewProps) {
  let totalMealPrice = 0;
  let totalPaidAmount = 0;
  let totalRefundAmount = 0;
  for (const tx of transactions) {
    if (tx.type === 'order') {
      totalMealPrice += tx.mealPrice;
    }
    totalPaidAmount += tx.paidAmount;
    if (tx.type === 'refund') {
      totalRefundAmount += tx.amount;
    }
  }

  const header = (
    <div className="tx-status-header">
      <span className="tx-col-time">時間</span>
      <span className="tx-col-item">項目</span>
      <span className="tx-col-meal-price">餐費</span>
      <span className="tx-col-paid">收款</span>
      <span className="tx-actions" />{/* action column placeholder (#423) */}
    </div>
  );

  return (
    <div className="tx-status-view">
      <div className="tx-status-title-row">
        <h3 className="tx-status-title">{student.displayName} 今日付款明細</h3>
        {onViewAllHistory && (
          <button
            type="button"
            className="ghost-btn tx-status-all-btn"
            onClick={onViewAllHistory}
          >
            查看全部紀錄
          </button>
        )}
      </div>
      {header}
      {transactions.length === 0 ? (
        <div className="tx-status-empty">今日無交易紀錄</div>
      ) : (
        transactions.map((tx) => {
          const itemLabel = getTxItemLabel(tx, todayMenu);
          const mealPriceText = tx.type === 'order' ? `$${fmt(tx.mealPrice)}` : '—';
          const paidAmountText = tx.type === 'refund'
            ? `−$${fmt(tx.amount)}`
            : (tx.paidAmount > 0 ? `$${fmt(tx.paidAmount)}` : (tx.type === 'order' ? '$0' : '—'));
          return (
            <div key={tx.transactionId} className="tx-status-row">
              <span className="tx-time">{formatTaipeiTime(tx.createdAt)}</span>
              <span className="tx-col-item" title={itemLabel}>
                <span className="tx-item-name">{itemLabel}</span>
                {isFaceTransaction(tx) && <span className="tx-face-tag" title={tx.note}>刷臉</span>}
              </span>
              <span className="tx-col-meal-price mono">{mealPriceText}</span>
              <span className="tx-col-paid mono">{paidAmountText}</span>
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
        })
      )}
      <div className="tx-status-footer">
        <div className="tx-status-total-item">
          <span className="tx-status-total-label">今日餐費</span>
          <span className="mono">${fmt(totalMealPrice)}</span>
        </div>
        <div className="tx-status-total-item">
          <span className="tx-status-total-label">今日收款</span>
          <span className="mono">${fmt(totalPaidAmount)}</span>
        </div>
        {totalRefundAmount > 0 && (
          <div className="tx-status-total-item">
            <span className="tx-status-total-label">今日退款</span>
            <span className="mono warn">−${fmt(totalRefundAmount)}</span>
          </div>
        )}
        <div className="tx-status-total-item">
          <span className="tx-status-total-label">帳戶餘額</span>
          <span className={'mono ' + (student.currentBalance < 0 ? 'neg' : '')}>
            {student.currentBalance < 0 ? '−' : ''}${fmt(Math.abs(student.currentBalance))}
          </span>
        </div>
      </div>
    </div>
  );
});
