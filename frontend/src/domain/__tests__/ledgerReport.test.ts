import { describe, it, expect } from 'vitest';
import {
  createLedgerDateRange,
  filterTransactionsByBusinessDate,
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
  vendorNameSnapshot: '餐點王',
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
