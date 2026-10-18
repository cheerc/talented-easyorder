import { describe, expect, it } from 'vitest';
import {
  buildCloudLedgerGroups,
  buildCloudMergedTransactions,
  createCloudLedgerDateRange,
  searchCloudReportStudentIds,
  summarizeCloudReportDays,
  validateCloudLedgerRange,
  type CloudReportTransaction,
} from '../cloudLedgerReport';

const makeTx = (overrides: Partial<CloudReportTransaction> = {}): CloudReportTransaction => ({
  transactionId: 'tx-a',
  studentId: '11111111-1111-4111-8111-111111111111',
  businessDate: '2026-10-16',
  type: 'order',
  mealKind: 'bento',
  mealPrice: 80,
  paidAmount: 20,
  amount: -60,
  studentNameSnapshot: '舊姓名',
  menuNameSnapshot: '餐盒',
  vendorNameSnapshot: '店家',
  status: 'active',
  createdAt: '2026-10-16T04:00:00.000Z',
  createdSeq: 1,
  operatorUid: 'operator-a',
  operatorEmail: 'operator@example.test',
  sourceDevice: 'pc',
  note: '',
  revision: 1,
  lastCommandId: '00000000-0000-4000-8000-000000000001',
  updatedAt: '2026-10-16T04:00:00.000Z',
  backfilled: false,
  sourceSeq: 3,
  ...overrides,
});

describe('createCloudLedgerDateRange', () => {
  it('uses Gregorian calendar arithmetic for Monday weeks and month boundaries', () => {
    expect(createCloudLedgerDateRange('week', '2026-10-18')).toMatchObject({
      startDate: '2026-10-12', endDate: '2026-10-18',
    });
    expect(createCloudLedgerDateRange('month', '2028-02-15')).toMatchObject({
      startDate: '2028-02-01', endDate: '2028-02-29',
    });
    expect(createCloudLedgerDateRange('month', '0099-02-15')).toMatchObject({
      startDate: '0099-02-01', endDate: '0099-02-28',
    });
  });

  it('keeps custom dates unchanged and rejects invalid dates, reversed ranges, and ranges over 31 days', () => {
    expect(createCloudLedgerDateRange('custom', '2026-10-18', {
      startDate: '2026-10-01', endDate: '2026-10-18',
    })).toMatchObject({ startDate: '2026-10-01', endDate: '2026-10-18' });
    expect(() => validateCloudLedgerRange({ kind: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }))
      .toThrow();
    expect(() => validateCloudLedgerRange({ kind: 'custom', startDate: '2026-10-18', endDate: '2026-10-17' }))
      .toThrow();
    expect(() => validateCloudLedgerRange({ kind: 'custom', startDate: '2026-01-01', endDate: '2026-02-01' }))
      .toThrow();
  });
});

describe('buildCloudLedgerGroups', () => {
  it('keeps days and accounts separate, preserves source IDs and voided rows, and excludes voided values from totals', () => {
    const rows = buildCloudLedgerGroups([
      makeTx({ transactionId: 'tx-1' }),
      makeTx({ transactionId: 'tx-2', businessDate: '2026-10-17', mealPrice: 50, paidAmount: 10 }),
      makeTx({ transactionId: 'tx-3', status: 'voided', mealPrice: 900, paidAmount: 900 }),
      makeTx({ transactionId: 'tx-4', studentId: '__cashier__', type: 'expense', mealKind: null,
        mealPrice: 15, paidAmount: 0, amount: -15, studentNameSnapshot: '櫃台' }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.businessDate === '2026-10-16' && row.studentId !== '__cashier__'))
      .toMatchObject({ transactionIds: ['tx-1', 'tx-3'], activeMealTotal: 80, activePaidTotal: 20, voidedCount: 1 });
    expect(rows.find(row => row.businessDate === '2026-10-17'))
      .toMatchObject({ transactionIds: ['tx-2'], activeMealTotal: 50, activePaidTotal: 10 });
    expect(rows.find(row => row.studentId === '__cashier__'))
      .toMatchObject({ transactionIds: ['tx-4'], activeCount: 1 });
  });
});

describe('buildCloudMergedTransactions', () => {
  it('uses ledger row semantics and preserves each source ID and voided audit row', () => {
    const rows = buildCloudMergedTransactions([
      makeTx({ transactionId: 'order-bento', mealPrice: 80, paidAmount: 0, amount: -80 }),
      makeTx({ transactionId: 'payment', type: 'payment', mealKind: null, mealPrice: 0, paidAmount: 100,
        amount: 100, menuNameSnapshot: '', vendorNameSnapshot: '' }),
      makeTx({ transactionId: 'order-other', mealKind: 'other', otherItemName: '麵', mealPrice: 40,
        paidAmount: 0, amount: -40 }),
      makeTx({ transactionId: 'refund', type: 'refund', mealKind: null, mealPrice: 0, paidAmount: 0,
        amount: 10, menuNameSnapshot: '', vendorNameSnapshot: '', afterBalance: 70 }),
      makeTx({ transactionId: 'voided', status: 'voided', mealPrice: 900, paidAmount: 900, afterBalance: 70 }),
      makeTx({ transactionId: 'cashier', studentId: '__cashier__', type: 'expense', mealKind: null,
        mealPrice: 15, paidAmount: 0, amount: -15, studentNameSnapshot: '櫃台' }),
      makeTx({ transactionId: 'next-day-order', businessDate: '2026-10-17' }),
      makeTx({ transactionId: 'payment-only-1', studentId: 'student-b', type: 'payment', mealKind: null,
        mealPrice: 0, paidAmount: 8, amount: 8, menuNameSnapshot: '', vendorNameSnapshot: '' }),
      makeTx({ transactionId: 'payment-only-2', studentId: 'student-b', type: 'payment', mealKind: null,
        mealPrice: 0, paidAmount: 9, amount: 9, menuNameSnapshot: '', vendorNameSnapshot: '' }),
    ]);

    const mergedOrder = rows.find(row => row.kind === 'merged-order');
    expect(mergedOrder).toMatchObject({
      transactionIds: ['order-bento', 'payment', 'order-other'],
      orderCount: 2, bentoOrderCount: 1, otherMealItems: ['麵'],
      mealPrice: 120, paidAmount: 100, unpaidAmount: 20, afterBalance: 70,
    });
    expect(rows.find(row => row.kind === 'refund')?.transactionIds).toEqual(['refund']);
    expect(rows.find(row => row.kind === 'voided')).toMatchObject({
      transactionIds: ['voided'], mealPrice: 0, paidAmount: 0, amount: 0, balanceDelta: 0,
    });
    expect(rows.filter(row => row.kind === 'cashier')).toHaveLength(1);
    expect(rows.filter(row => row.kind === 'payment').map(row => row.transactionId))
      .toEqual(['payment-only-1', 'payment-only-2']);
    expect(rows.filter(row => row.kind === 'payment').map(row => row.depositAmount)).toEqual([8, 9]);
    expect(rows.filter(row => row.businessDate === '2026-10-17')).toHaveLength(1);
  });
});

describe('cloud report search and summary', () => {
  it('matches current identifiers, aliases, and transaction-time names without rewriting snapshots', () => {
    const ids = searchCloudReportStudentIds(
      [{ studentId: 'student-a', studentCode: '001', displayName: '新姓名', aliases: ['甲別名'] }],
      [{ studentId: 'student-a', studentNameSnapshot: '舊姓名' }],
      '舊姓名',
    );
    expect(ids).toEqual(['student-a']);
    expect(searchCloudReportStudentIds(
      [{ studentId: 'student-a', studentCode: '001', displayName: '新姓名', aliases: ['甲別名'] }], [], '001',
    )).toEqual(['student-a']);
  });

  it('does not invent order-unpaid or add daily cash stocks into range totals', () => {
    const totals = summarizeCloudReportDays([
      {
        businessDate: '2026-10-16', exists: true, status: 'closed', revision: 3, openingCash: 100,
        totals: { activeTransactionCount: 2, bentoCount: 1, otherMealCount: 0, mealTotal: 80,
          retainedReceipts: 20, cashierIncome: 5, cashierExpense: 3, accountRefunds: 2 },
        lastSettlementRevision: 2, backfillReason: null, settlements: [], postCloseEntries: [], effectiveCash: 120,
      },
      {
        businessDate: '2026-10-17', exists: true, status: 'closed', revision: 2, openingCash: 500,
        totals: { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
          retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 },
        lastSettlementRevision: 1, backfillReason: null, settlements: [], postCloseEntries: [], effectiveCash: 500,
      },
    ]);
    expect(totals).toMatchObject({
      activeTransactionCount: 2, orderCount: 1, mealTotal: 80, orderUnpaid: null,
      totalIncome: 25, totalExpense: 3, totalRefund: 2, netCash: 20,
    });
    expect(totals).not.toHaveProperty('effectiveCash');
  });
});
