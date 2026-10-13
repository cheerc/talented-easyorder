import { describe, it, expect } from 'vitest';
import { countMeals, isOtherMealOrder, otherMealName, calculateLedgerTotals } from '../ledgerReport';
import { deriveTransactionAttributes } from '../posTransaction';
import type { LedgerTransaction } from '../ledger';

const tx = (o: Partial<LedgerTransaction>): LedgerTransaction => ({
  transactionId: 't', businessDate: '2026-10-13', createdAt: '', studentId: '001', studentNameSnapshot: '甲',
  type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 0, menuNameSnapshot: '排骨便當',
  vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '排骨便當', ...o,
});

describe('今日便當與其他餐點的分類', () => {
  it('新資料看 otherItemName；舊資料看備註開頭；繳費、櫃台收支不算份數', () => {
    expect(isOtherMealOrder(tx({}))).toBe(false);
    expect(isOtherMealOrder(tx({ otherItemName: '雞腿', note: '改過的備註' }))).toBe(true);
    expect(isOtherMealOrder(tx({ note: '單筆改價：魚排' }))).toBe(true);
    expect(isOtherMealOrder(tx({ type: 'payment', note: '單筆改價：x' }))).toBe(false);
    expect(otherMealName(tx({ otherItemName: '雞腿' }))).toBe('雞腿');
    expect(otherMealName(tx({ note: '單筆改價：魚排' }))).toBe('魚排');
  });

  it('份數：今日便當＋其他；價格和現在菜單不同的今日便當仍算今日便當', () => {
    const list = [
      tx({ mealPrice: 90 }),
      tx({ mealPrice: 100 }), // 當天改價前後
      tx({ otherItemName: '雞腿', mealPrice: 110 }),
      tx({ type: 'payment', mealPrice: 0, paidAmount: 100 }),
      tx({ type: 'expense', studentId: '__cashier__', mealPrice: 270 }),
    ];
    expect(countMeals(list)).toEqual({ bento: 2, other: 1 });
    expect(calculateLedgerTotals(list)).toMatchObject({ orderCount: 3, bentoCount: 2, otherMealCount: 1 });
  });

  it('送出時：訂購其他餐點帶品項（沒填品項記「其他餐點」），今日便當不帶', () => {
    const base = { todayMenuPrice: 90, todayMenuItemName: '排骨便當', paidAmountText: '0' };
    expect(deriveTransactionAttributes({ ...base, mode: 'order', priceOverride: null, priceOverrideLabel: '' }).otherItemName).toBeUndefined();
    expect(deriveTransactionAttributes({ ...base, mode: 'order', priceOverride: 110, priceOverrideLabel: ' 雞腿 ' }).otherItemName).toBe('雞腿');
    expect(deriveTransactionAttributes({ ...base, mode: 'order', priceOverride: 110, priceOverrideLabel: '' }).otherItemName).toBe('其他餐點');
    expect(deriveTransactionAttributes({ ...base, mode: 'payment', priceOverride: 110, priceOverrideLabel: '雞腿' }).otherItemName).toBeUndefined();
  });
});
