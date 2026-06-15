import { describe, it, expect } from 'vitest';
import type { LedgerTransaction } from '../ledger';
import type { ReportTransactionView, WorkflowTransactionView } from '../transactionViews';

describe('transactionViews', () => {
  it('LedgerTransaction satisfies ReportTransactionView', () => {
    // Compile-time assertion: assigning LedgerTransaction to ReportTransactionView should work
    const _report: ReportTransactionView = {} as LedgerTransaction;
    expect(_report).toBeDefined();
  });

  it('LedgerTransaction satisfies WorkflowTransactionView', () => {
    const _workflow: WorkflowTransactionView = {} as LedgerTransaction;
    expect(_workflow).toBeDefined();
  });

  it('ReportTransactionView includes studentId (reviewer finding #1)', () => {
    const view: ReportTransactionView = {
      transactionId: 'tx-1',
      businessDate: '2026-01-01',
      createdAt: '2026-01-01T00:00:00Z',
      studentId: 'S001',
      studentNameSnapshot: 'Test',
      type: 'order',
      mealPrice: 90,
      paidAmount: 90,
      amount: -90,
      afterBalance: 10,
      menuNameSnapshot: '排骨便當',
      vendorNameSnapshot: '老王',
      note: '',
      syncStatus: 'local',
    };
    expect(view.studentId).toBe('S001');
  });

  it('WorkflowTransactionView includes paidAmount + mealPrice (reviewer finding #2)', () => {
    const view: WorkflowTransactionView = {
      transactionId: 'tx-1',
      businessDate: '2026-01-01',
      type: 'order',
      amount: -90,
      studentId: 'S001',
      createdAt: '2026-01-01T00:00:00Z',
      syncStatus: 'local',
      paidAmount: 90,
      mealPrice: 90,
      note: '',
    };
    expect(view.paidAmount).toBe(90);
    expect(view.mealPrice).toBe(90);
  });
});
