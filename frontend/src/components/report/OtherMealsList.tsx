import React, { useMemo } from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { isOtherMealOrder, otherMealName } from '../../domain/ledgerReport';
import { formatTaipeiTime } from '../../utils/dateTime';
import { fmt } from '../pos-components';

interface OtherMealsListProps {
  /** 目前區間的交易（和上方卡片同一份）。 */
  transactions: LedgerTransaction[];
}

/**
 * 「訂購其他餐點」清單：今日便當份數以外另外要叫的餐，列出營業日、時間、帳戶、品項、價錢，
 * 方便和供應商分開下訂。沒有其他餐點時不顯示。
 */
export const OtherMealsList = React.memo(function OtherMealsList({ transactions }: OtherMealsListProps) {
  const rows = useMemo(
    () => transactions.filter(isOtherMealOrder).sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.createdAt.localeCompare(b.createdAt)),
    [transactions],
  );
  if (rows.length === 0) return null;
  return (
    <div className="card" role="region" aria-label="其他餐點" style={{ marginBottom: '16px', padding: '12px 20px' }}>
      <div style={{ fontWeight: 600, marginBottom: '8px' }}>其他餐點（{rows.length} 份，不算在今日便當份數）</div>
      {rows.map(t => (
        <div key={t.transactionId} style={{ display: 'grid', gridTemplateColumns: '100px 70px 160px 1fr 80px', gap: '8px', fontSize: '14px', padding: '2px 0' }}>
          <span className="mono dim">{t.businessDate}</span>
          <span className="mono dim">{formatTaipeiTime(t.createdAt)}</span>
          <span>{t.studentId} {t.studentNameSnapshot}</span>
          <span>{otherMealName(t)}</span>
          <span className="mono" style={{ textAlign: 'right' }}>${fmt(t.mealPrice)}</span>
        </div>
      ))}
    </div>
  );
});
