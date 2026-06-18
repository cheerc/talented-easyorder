import { getIncome, getExpense } from '../transactionUtils';

const baseTx = {
  transactionId: 'tx-1', businessDate: '2026-06-18', createdAt: '2026-06-18T09:00:00Z',
  studentId: 's1', studentNameSnapshot: '王柏翰', menuNameSnapshot: '', vendorNameSnapshot: '',
  sourceDevice: 'pc' as const, syncStatus: 'synced' as any, revision: 1, note: '',
  afterBalance: 0, mealPrice: 0, paidAmount: 0, amount: 0,
};

describe('getIncome', () => {
  it('returns paidAmount for payment', () => {
    expect(getIncome({ ...baseTx, type: 'payment', paidAmount: 500 })).toBe(500);
  });
  it('returns paidAmount for order with payment', () => {
    expect(getIncome({ ...baseTx, type: 'order', paidAmount: 90, mealPrice: 90 })).toBe(90);
  });
  it('returns null for order without payment', () => {
    expect(getIncome({ ...baseTx, type: 'order', paidAmount: 0, mealPrice: 90 })).toBeNull();
  });
  it('returns null for expense', () => {
    expect(getIncome({ ...baseTx, type: 'expense', amount: 100 })).toBeNull();
  });
});

describe('getExpense', () => {
  it('returns mealPrice for order', () => {
    expect(getExpense({ ...baseTx, type: 'order', mealPrice: 90 })).toBe(90);
  });
  it('returns amount for expense', () => {
    expect(getExpense({ ...baseTx, type: 'expense', amount: 100 })).toBe(100);
  });
  it('returns null for payment', () => {
    expect(getExpense({ ...baseTx, type: 'payment', paidAmount: 500 })).toBeNull();
  });
});
