import { getIncome, getExpense } from '../transactionUtils';

const baseTx = {
  transactionId: 'tx-1', businessDate: '2026-06-18', createdAt: '2026-06-18T09:00:00Z',
  studentId: 's1', studentNameSnapshot: '王柏翰', menuNameSnapshot: '', vendorNameSnapshot: '',
  sourceDevice: 'pc' as const, syncStatus: 'synced' as const, revision: 1, note: '',
  afterBalance: 0, mealPrice: 0, paidAmount: 0, amount: 0,
};

describe('getIncome', () => {
  it('returns paidAmount for payment', () => {
    expect(getIncome({ ...baseTx, type: 'payment', paidAmount: 300 })).toBe(300);
  });
  it('returns null for order', () => {
    expect(getIncome({ ...baseTx, type: 'order', mealPrice: 60 })).toBeNull();
  });
  it('returns null for expense', () => {
    expect(getIncome({ ...baseTx, type: 'expense', amount: 100 })).toBeNull();
  });
});

describe('getExpense', () => {
  it('returns mealPrice for order', () => {
    expect(getExpense({ ...baseTx, type: 'order', mealPrice: 60 })).toBe(60);
  });
  it('returns amount for expense', () => {
    expect(getExpense({ ...baseTx, type: 'expense', amount: 100 })).toBe(100);
  });
  it('returns null for payment', () => {
    expect(getExpense({ ...baseTx, type: 'payment', paidAmount: 300 })).toBeNull();
  });
  it('returns 0 for order with mealPrice=0', () => {
    expect(getExpense({ ...baseTx, type: 'order', mealPrice: 0 })).toBe(0);
  });
});
