import { describe, expect, it, beforeEach } from 'vitest';
import {
  createLedgerTransaction,
  computeTransactionBalanceDelta,
  recalculateStudentBalances,
  rebalanceAccounts,
  type LedgerTransaction,
} from '../ledger';
import { calculateLedgerTotals } from '../ledgerReport';
import { buildRefundTransactionDraft } from '../posTransaction';
import { buildTransactionCsvRows } from '../ledgerExport';
import { usePosStore } from '../../store/posStore';
import { resolveCurrentBusinessDate } from '../../store/currentBusinessDate';
import type { StudentAccount } from '../student';

const makeStudent = (overrides: Partial<StudentAccount> = {}): StudentAccount => ({
  studentId: '001',
  displayName: '王小明',
  status: 'active',
  currentBalance: 500,
  aliases: [],
  faceEnrollmentStatus: 'none',
  createdAt: '2026-05-01T08:00:00.000Z',
  updatedAt: '2026-05-01T08:00:00.000Z',
  revision: 1,
  ...overrides,
});

/**
 * 退款可寫入的「今天」：與 store 擋下檢查同一個來源。
 * 測試環境不是 prototype mode，所以模擬營業日不生效，不能寫死日期。
 */
const TODAY = resolveCurrentBusinessDate(null);

describe('Refund domain accounting', () => {
  it('createLedgerTransaction initializes refund with mealPrice=0, paidAmount=0, and reduces afterBalance', () => {
    const student = makeStudent({ currentBalance: 300 });
    const tx = createLedgerTransaction({
      transactionId: 'tx-refund-1',
      businessDate: TODAY,
      createdAt: '2026-10-15T12:00:00.000Z',
      studentSnapshot: { studentId: student.studentId, studentNameSnapshot: student.displayName },
      menuSnapshot: { menuNameSnapshot: '', menuPriceSnapshot: 0, vendorNameSnapshot: '', vendorIdSnapshot: '' },
      type: 'refund',
      mealPrice: 0,
      paidAmount: 0,
      amount: 100,
      previousBalance: student.currentBalance,
      sourceDevice: 'pc',
      note: '結清離班',
    });

    expect(tx.type).toBe('refund');
    expect(tx.mealPrice).toBe(0);
    expect(tx.paidAmount).toBe(0);
    expect(tx.amount).toBe(100);
    expect(tx.afterBalance).toBe(200);
    expect(tx.note).toBe('結清離班');
  });

  it('computeTransactionBalanceDelta returns negative amount for refund', () => {
    expect(computeTransactionBalanceDelta({ type: 'refund', paidAmount: 0, mealPrice: 0, amount: 80 })).toBe(-80);
    expect(computeTransactionBalanceDelta({ type: 'payment', paidAmount: 100, mealPrice: 0, amount: 100 })).toBe(100);
    expect(computeTransactionBalanceDelta({ type: 'order', paidAmount: 0, mealPrice: 90, amount: -90 })).toBe(-90);
  });

  it('recalculateStudentBalances recalculates balances correctly with refunds', () => {
    const student = makeStudent({ currentBalance: 0, openingBalance: { amount: 500, asOfDate: '2026-10-01', note: '期初', createdAt: '2026-10-01T00:00:00.000Z' } });
    const order: LedgerTransaction = {
      transactionId: 'tx-1', businessDate: '2026-10-15', createdAt: '2026-10-15T10:00:00.000Z',
      studentId: '001', studentNameSnapshot: '王小明', type: 'order',
      mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 410,
      menuNameSnapshot: '排骨便當', vendorNameSnapshot: '老王', sourceDevice: 'pc',
      syncStatus: 'local', revision: 1, note: '',
    };
    const refund: LedgerTransaction = {
      transactionId: 'tx-2', businessDate: '2026-10-15', createdAt: '2026-10-15T11:00:00.000Z',
      studentId: '001', studentNameSnapshot: '王小明', type: 'refund',
      mealPrice: 0, paidAmount: 0, amount: 200, afterBalance: 210,
      menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc',
      syncStatus: 'local', revision: 1, note: '部分退費',
    };

    const result = recalculateStudentBalances([student], [order, refund]);
    expect(result.students[0].currentBalance).toBe(210);
    expect(result.transactions[0].afterBalance).toBe(410);
    expect(result.transactions[1].afterBalance).toBe(210);
  });

  it('rebalanceAccounts correctly updates subsequent transaction balances after refund insertion', () => {
    const student = makeStudent({ currentBalance: 500, openingBalance: { amount: 500, asOfDate: '2026-10-01', note: '期初', createdAt: '2026-10-01T00:00:00.000Z' } });
    const refund: LedgerTransaction = {
      transactionId: 'tx-refund', businessDate: '2026-10-15', createdAt: '2026-10-15T10:00:00.000Z',
      studentId: '001', studentNameSnapshot: '王小明', type: 'refund',
      mealPrice: 0, paidAmount: 0, amount: 150, afterBalance: 350,
      menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc',
      syncStatus: 'local', revision: 1, note: '退款',
    };

    const rebalanced = rebalanceAccounts([student], [], [refund], ['001']);
    expect(rebalanced.students[0].currentBalance).toBe(350);
    expect(rebalanced.transactions[0].afterBalance).toBe(350);
  });

  it('calculateLedgerTotals includes refunds in totalRefund and netCash without offsetting totalIncome or adding to mealTotal', () => {
    const txs: LedgerTransaction[] = [
      {
        transactionId: 'tx-order', businessDate: '2026-10-15', createdAt: '2026-10-15T10:00:00.000Z',
        studentId: '001', studentNameSnapshot: '王小明', type: 'order',
        mealPrice: 90, paidAmount: 100, amount: 10, afterBalance: 10,
        menuNameSnapshot: '排骨便當', vendorNameSnapshot: '老王', sourceDevice: 'pc',
        syncStatus: 'local', revision: 1, note: '',
      },
      {
        transactionId: 'tx-expense', businessDate: '2026-10-15', createdAt: '2026-10-15T11:00:00.000Z',
        studentId: '__cashier__', studentNameSnapshot: '櫃台', type: 'expense',
        mealPrice: 50, paidAmount: 0, amount: 50, afterBalance: 0,
        menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc',
        syncStatus: 'local', revision: 1, note: '文具',
      },
      {
        transactionId: 'tx-refund', businessDate: '2026-10-15', createdAt: '2026-10-15T12:00:00.000Z',
        studentId: '001', studentNameSnapshot: '王小明', type: 'refund',
        mealPrice: 0, paidAmount: 0, amount: 30, afterBalance: -20,
        menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc',
        syncStatus: 'local', revision: 1, note: '溢繳退還',
      },
    ];

    const totals = calculateLedgerTotals(txs);
    expect(totals.orderCount).toBe(1);
    expect(totals.mealTotal).toBe(90);
    expect(totals.totalIncome).toBe(100);
    expect(totals.totalExpense).toBe(50);
    expect(totals.totalRefund).toBe(30);
    // netCash = 100 - 50 - 30 = 20
    expect(totals.netCash).toBe(20);
    expect(totals.transactionCount).toBe(3);
  });
});

describe('Refund store actions and lifecycle', () => {
  beforeEach(() => {
    usePosStore.getState().loadSampleData();
    // #9：退款只認當前營業日（prototype 以 simulationDate 為準），所以測試要先設定當前營業日。
    usePosStore.setState(state => ({
      simulationDate: TODAY,
      todayMenu: { ...state.todayMenu, businessDate: TODAY },
      students: state.students.map((s, i) => i === 0 ? { ...s, currentBalance: 500 } : s),
    }));
  });

  it('commitPosTransactionDraft successfully executes refund on student with positive balance', () => {
    const student = usePosStore.getState().students[0];
    const initialBalance = student.currentBalance;
    expect(initialBalance).toBeGreaterThan(0);

    const draft = buildRefundTransactionDraft({
      businessDate: TODAY,
      student,
      amount: 50,
      note: '結清離班',
      sourceDevice: 'pc',
    });

    const result = usePosStore.getState().commitPosTransactionDraft(draft);
    expect(result.ok).toBe(true);

    const updatedStudent = usePosStore.getState().students.find(s => s.studentId === student.studentId)!;
    expect(updatedStudent.currentBalance).toBe(initialBalance - 50);

    const latestTx = usePosStore.getState().transactions[0];
    expect(latestTx.type).toBe('refund');
    expect(latestTx.amount).toBe(50);
    expect(latestTx.afterBalance).toBe(initialBalance - 50);
    expect(latestTx.note).toBe('結清離班');
  });

  it('rejects refund when amount exceeds student currentBalance', () => {
    const student = usePosStore.getState().students[0];
    const draft = buildRefundTransactionDraft({
      businessDate: TODAY,
      student,
      amount: student.currentBalance + 100,
      note: '超額退款',
      sourceDevice: 'pc',
    });

    const result = usePosStore.getState().commitPosTransactionDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('退款金額不能超過目前餘額');
    }
  });

  it('rejects refund when amount is 0, negative, or not integer', () => {
    const student = usePosStore.getState().students[0];
    const draft = buildRefundTransactionDraft({
      businessDate: TODAY,
      student,
      amount: 0,
      note: '無效退款',
      sourceDevice: 'pc',
    });

    const result = usePosStore.getState().commitPosTransactionDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('退款金額必須是大於 0 的整數');
    }
  });

  it('rejects refund when reason is empty', () => {
    const student = usePosStore.getState().students[0];
    const draft = buildRefundTransactionDraft({
      businessDate: TODAY,
      student,
      amount: 50,
      note: '   ',
      sourceDevice: 'pc',
    });

    const result = usePosStore.getState().commitPosTransactionDraft(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('退款原因必填');
    }
  });

  it('allows refund for inactive students', () => {
    // Deactivate a student
    usePosStore.setState(state => ({
      students: state.students.map((s, i) => i === 0 ? { ...s, status: 'inactive' as const, currentBalance: 200 } : s),
    }));

    const student = usePosStore.getState().students[0];
    expect(student.status).toBe('inactive');

    const draft = buildRefundTransactionDraft({
      businessDate: TODAY,
      student,
      amount: 200,
      note: '停用離班結清',
      sourceDevice: 'pc',
    });

    const result = usePosStore.getState().commitPosTransactionDraft(draft);
    expect(result.ok).toBe(true);

    const updated = usePosStore.getState().students.find(s => s.studentId === student.studentId)!;
    expect(updated.currentBalance).toBe(0);
  });

  it('deleting a refund transaction restores student balance and records audit event', () => {
    const student = usePosStore.getState().students[0];
    const initialBalance = student.currentBalance;

    const draft = buildRefundTransactionDraft({
      businessDate: TODAY,
      student,
      amount: 70,
      note: '送出測試',
      sourceDevice: 'pc',
    });
    const commitRes = usePosStore.getState().commitPosTransactionDraft(draft);
    expect(commitRes.ok).toBe(true);

    const txId = (commitRes as { transactionId: string }).transactionId;
    expect(usePosStore.getState().students[0].currentBalance).toBe(initialBalance - 70);

    // Delete the refund (simulating 5-second undo or report deletion)
    const deleteRes = usePosStore.getState().deleteTransaction(txId, { reason: '誤退撤回' });
    expect(deleteRes.ok).toBe(true);

    // Balance is fully restored
    expect(usePosStore.getState().students[0].currentBalance).toBe(initialBalance);
    expect(usePosStore.getState().transactions.find(t => t.transactionId === txId)).toBeUndefined();

    // Audit event recorded
    const auditEvt = usePosStore.getState().auditEvents.find(e => e.entityId === txId);
    expect(auditEvt).toBeTruthy();
    expect(auditEvt?.eventType).toBe('transaction_deleted');
    expect(auditEvt?.reason).toBe('誤退撤回');
  });

  it('CSV export accurately represents refund rows', () => {
    const student = makeStudent();
    const refundTx: LedgerTransaction = {
      transactionId: 'tx-csv-ref',
      businessDate: TODAY,
      createdAt: '2026-10-15T15:30:00.000Z',
      studentId: student.studentId,
      studentNameSnapshot: student.displayName,
      type: 'refund',
      mealPrice: 0,
      paidAmount: 0,
      amount: 120,
      afterBalance: 380,
      menuNameSnapshot: '',
      vendorNameSnapshot: '',
      sourceDevice: 'pc',
      syncStatus: 'local',
      revision: 1,
      note: '溢繳退還',
    };

    const rows = buildTransactionCsvRows([refundTx]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Column 5 is 'type'
    expect(row[5]).toBe('refund');
    // Column 6 mealPrice is 0, Column 7 paidAmount is 0, Column 8 amount is 120
    expect(row[6]).toBe('0');
    expect(row[7]).toBe('0');
    expect(row[8]).toBe('120');
    expect(row[9]).toBe('380');
    expect(row[16]).toBe('溢繳退還');
    // Bento count is '0', otherMealItems is ''
    expect(row[row.length - 2]).toBe('0');
    expect(row[row.length - 1]).toBe('');
  });
});
