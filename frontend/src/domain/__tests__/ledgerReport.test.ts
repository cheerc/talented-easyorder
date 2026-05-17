import { describe, it, expect } from 'vitest';
import {
  createLedgerDateRange,
  filterTransactionsByBusinessDate,
  calculateLedgerTotals,
  groupLedgerRowsByStudent,
} from '../ledgerReport';
import type { LedgerTransaction } from '../ledger';

const makeTx = (overrides: Partial<LedgerTransaction> = {}): LedgerTransaction => ({
  transactionId: 'tx-1',
  businessDate: '2026-05-15',
  createdAt: '2026-05-15T12:00:00.000Z',
  studentId: '015',
  studentNameSnapshot: '王小明',
  type: 'order',
  mealPrice: 85,
  paidAmount: 0,
  amount: -85,
  afterBalance: 15,
  menuNameSnapshot: '雞腿飯',
  vendorNameSnapshot: '便當王',
  sourceDevice: 'pc',
  syncStatus: 'local',
  revision: 1,
  note: '',
  ...overrides,
});

describe('createLedgerDateRange', () => {
  it('today uses anchorDate as both start and end', () => {
    const range = createLedgerDateRange('today', '2026-05-15');
    expect(range.startDate).toBe('2026-05-15');
    expect(range.endDate).toBe('2026-05-15');
    expect(range.kind).toBe('today');
  });

  it('week uses Monday through Sunday for anchor week', () => {
    const range = createLedgerDateRange('week', '2026-05-15');
    expect(range.startDate).toBe('2026-05-11'); // Monday
    expect(range.endDate).toBe('2026-05-17'); // Sunday
    expect(range.kind).toBe('week');
  });

  it('month uses first through last date of anchor month', () => {
    const range = createLedgerDateRange('month', '2026-05-15');
    expect(range.startDate).toBe('2026-05-01');
    expect(range.endDate).toBe('2026-05-31');
    expect(range.kind).toBe('month');
  });

  it('custom requires explicit startDate and endDate', () => {
    const range = createLedgerDateRange('custom', '2026-05-15', { startDate: '2026-04-01', endDate: '2026-04-30' });
    expect(range.startDate).toBe('2026-04-01');
    expect(range.endDate).toBe('2026-04-30');
    expect(range.kind).toBe('custom');
  });
});

describe('filterTransactionsByBusinessDate', () => {
  it('returns transactions within range', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ businessDate: '2026-05-10', transactionId: 'tx-a' }),
      makeTx({ businessDate: '2026-05-15', transactionId: 'tx-b' }),
      makeTx({ businessDate: '2026-05-20', transactionId: 'tx-c' }),
    ];
    const range = createLedgerDateRange('week', '2026-05-15');
    const filtered = filterTransactionsByBusinessDate(txs, range);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].transactionId).toBe('tx-b');
  });

  it('returns empty array when no transactions in range', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ businessDate: '2026-04-01', transactionId: 'tx-a' }),
      makeTx({ businessDate: '2026-04-15', transactionId: 'tx-b' }),
    ];
    const range = createLedgerDateRange('week', '2026-05-15');
    const filtered = filterTransactionsByBusinessDate(txs, range);
    expect(filtered).toHaveLength(0);
  });
});

describe('calculateLedgerTotals', () => {
  it('counts order rows', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', type: 'order', mealPrice: 85 }),
      makeTx({ transactionId: 'tx-2', type: 'order', mealPrice: 85 }),
      makeTx({ transactionId: 'tx-3', type: 'payment', paidAmount: 500 }),
    ];
    const totals = calculateLedgerTotals(txs);
    expect(totals.orderCount).toBe(2);
  });

  it('sums paid amount for income across order and payment rows', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', type: 'order', paidAmount: 50 }),
      makeTx({ transactionId: 'tx-2', type: 'payment', paidAmount: 500 }),
    ];
    const totals = calculateLedgerTotals(txs);
    expect(totals.totalIncome).toBe(550);
  });

  it('sums mealPrice for expense rows', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', type: 'expense', studentId: '__cashier__', mealPrice: 200, paidAmount: 0 }),
      makeTx({ transactionId: 'tx-2', type: 'expense', studentId: '__cashier__', mealPrice: 50, paidAmount: 0 }),
    ];
    const totals = calculateLedgerTotals(txs);
    expect(totals.totalExpense).toBe(250);
  });

  it('calculates netCash as totalIncome minus totalExpense', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', type: 'order', paidAmount: 85 }),
      makeTx({ transactionId: 'tx-2', type: 'expense', studentId: '__cashier__', mealPrice: 35, paidAmount: 0 }),
    ];
    const totals = calculateLedgerTotals(txs);
    expect(totals.netCash).toBe(50);
  });

  it('calculates newDebt as unpaid meal price', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', type: 'order', mealPrice: 85, paidAmount: 0 }),
      makeTx({ transactionId: 'tx-2', type: 'order', mealPrice: 85, paidAmount: 50 }),
    ];
    const totals = calculateLedgerTotals(txs);
    expect(totals.newDebt).toBe(120); // 85-0 + 85-50
  });

  it('counts transactionCount as total rows', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1' }),
      makeTx({ transactionId: 'tx-2' }),
      makeTx({ transactionId: 'tx-3' }),
    ];
    const totals = calculateLedgerTotals(txs);
    expect(totals.transactionCount).toBe(3);
  });

  it('handles empty transactions array', () => {
    const totals = calculateLedgerTotals([]);
    expect(totals.orderCount).toBe(0);
    expect(totals.netCash).toBe(0);
    expect(totals.newDebt).toBe(0);
  });
});

describe('groupLedgerRowsByStudent', () => {
  it('groups transactions by studentId', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', studentId: '015', studentNameSnapshot: '王小明', createdAt: '2026-05-15T12:00:00.000Z', amount: -85 }),
      makeTx({ transactionId: 'tx-2', studentId: '016', studentNameSnapshot: '李小華', createdAt: '2026-05-15T12:05:00.000Z', amount: 0 }),
      makeTx({ transactionId: 'tx-3', studentId: '015', studentNameSnapshot: '王小明', createdAt: '2026-05-15T13:00:00.000Z', amount: -85 }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    expect(groups).toHaveLength(2);
  });

  it('preserves Traditional Chinese student name snapshots', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ studentId: '015', studentNameSnapshot: '王小明' }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    expect(groups[0].studentNameSnapshot).toBe('王小明');
  });

  it('calculates mealTotal and paidTotal per student', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', studentId: '015', type: 'order', mealPrice: 85, paidAmount: 0, amount: -85 }),
      makeTx({ transactionId: 'tx-2', studentId: '015', type: 'payment', mealPrice: 0, paidAmount: 500, amount: 500 }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    const group = groups.find(g => g.studentId === '015')!;
    expect(group.mealTotal).toBe(85);
    expect(group.paidTotal).toBe(500);
  });

  it('sorts groups by latest transaction time descending', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', studentId: '015', createdAt: '2026-05-15T12:00:00.000Z' }),
      makeTx({ transactionId: 'tx-2', studentId: '016', createdAt: '2026-05-15T14:00:00.000Z' }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    expect(groups[0].studentId).toBe('016');
  });

  it('sorts transactions within group by created time ascending', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-2', studentId: '015', createdAt: '2026-05-15T13:00:00.000Z' }),
      makeTx({ transactionId: 'tx-1', studentId: '015', createdAt: '2026-05-15T12:00:00.000Z' }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    expect(groups[0].transactions[0].transactionId).toBe('tx-1');
    expect(groups[0].transactions[1].transactionId).toBe('tx-2');
  });

  it('includes recordCount per group', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', studentId: '015' }),
      makeTx({ transactionId: 'tx-2', studentId: '015' }),
      makeTx({ transactionId: 'tx-3', studentId: '015' }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    expect(groups[0].recordCount).toBe(3);
  });

  it('includes afterBalance from the last transaction', () => {
    const txs: LedgerTransaction[] = [
      makeTx({ transactionId: 'tx-1', afterBalance: 50 }),
      makeTx({ transactionId: 'tx-2', afterBalance: 30 }),
    ];
    const groups = groupLedgerRowsByStudent(txs);
    expect(groups[0].afterBalance).toBe(30);
  });
});
