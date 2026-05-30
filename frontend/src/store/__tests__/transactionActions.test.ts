import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';
import { buildPosTransactionDraft } from '../../domain/posTransaction';
import { CASHIER_SENTINEL } from '../../domain/ledger';
import type { PosTransactionDraft } from '../../domain/posTransaction';

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('transactionActions — commitPosTransactionDraft', () => {
  it('T1: creates order with correct transaction fields and student balance', () => {
    const store = usePosStore.getState();
    const student = store.students.find(s => s.studentId === '001')!;
    const initialBalance = student.currentBalance;

    const draft = buildPosTransactionDraft({
      intent: {
        businessDate: store.todayMenu.businessDate,
        studentId: '001',
        type: 'order',
        mealPrice: 90,
        paidAmount: 0,
        note: '日式唐揚雞便當',
        sourceDevice: 'pc',
      },
      student,
      menu: store.todayMenu,
    });

    store.commitPosTransactionDraft(draft);

    const next = usePosStore.getState();
    const tx = next.transactions[0];
    const updatedStudent = next.students.find(s => s.studentId === '001')!;

    expect(tx.type).toBe('order');
    expect(tx.studentId).toBe('001');
    expect(tx.mealPrice).toBe(90);
    expect(tx.paidAmount).toBe(0);
    expect(tx.studentNameSnapshot).toBe(student.displayName);
    expect(tx.menuNameSnapshot).toBe(store.todayMenu.itemName);
    expect(updatedStudent.currentBalance).toBe(initialBalance - 90);
  });

  it('T2: creates payment with correct paidAmount and balance recalculation', () => {
    const store = usePosStore.getState();
    const student = store.students.find(s => s.studentId === '002')!;

    const draft = buildPosTransactionDraft({
      intent: {
        businessDate: store.todayMenu.businessDate,
        studentId: '002',
        type: 'payment',
        mealPrice: 0,
        paidAmount: 500,
        note: '現金繳費',
        sourceDevice: 'pc',
      },
      student,
      menu: store.todayMenu,
    });

    store.commitPosTransactionDraft(draft);

    const next = usePosStore.getState();
    const tx = next.transactions[0];
    const updatedStudent = next.students.find(s => s.studentId === '002')!;

    expect(tx.type).toBe('payment');
    expect(tx.paidAmount).toBe(500);
    expect(tx.mealPrice).toBe(0);
    expect(tx.amount).toBe(500);
    expect(updatedStudent.currentBalance).toBe(500);
  });

  it('T3: creates expense with CASHIER_SENTINEL student — student balances unchanged', () => {
    const store = usePosStore.getState();
    const studentBalancesBefore = store.students.map(s => s.currentBalance);

    const draft: PosTransactionDraft = {
      intent: {
        businessDate: store.todayMenu.businessDate,
        studentId: CASHIER_SENTINEL,
        type: 'expense',
        mealPrice: 200,
        paidAmount: 0,
        note: '付便當錢',
        sourceDevice: 'pc',
      },
      snapshots: {
        student: { studentId: CASHIER_SENTINEL, studentNameSnapshot: '櫃台' },
        menu: { menuNameSnapshot: '', vendorNameSnapshot: '' },
      },
      amount: -200,
      expectedBalanceAfter: 0,
    };

    store.commitPosTransactionDraft(draft);

    const next = usePosStore.getState();
    const tx = next.transactions[0];

    expect(tx.type).toBe('expense');
    expect(tx.studentId).toBe(CASHIER_SENTINEL);
    expect(tx.mealPrice).toBe(200);

    // Student balances must remain unchanged
    const balancesAfter = next.students.map(s => s.currentBalance);
    expect(balancesAfter).toEqual(studentBalancesBefore);
  });

  it('T4: nonexistent studentId returns state unchanged', () => {
    const store = usePosStore.getState();
    const txCountBefore = store.transactions.length;
    const student = store.students[0];

    const draft = buildPosTransactionDraft({
      intent: {
        businessDate: store.todayMenu.businessDate,
        studentId: 'nonexistent',
        type: 'order',
        mealPrice: 90,
        paidAmount: 0,
        note: 'test',
        sourceDevice: 'pc',
      },
      student: { ...student, studentId: 'nonexistent' },
      menu: store.todayMenu,
    });

    store.commitPosTransactionDraft(draft);

    const next = usePosStore.getState();
    expect(next.transactions.length).toBe(txCountBefore);
  });
});

describe('transactionActions — processTransaction / updateTransaction', () => {
  it('T5: processTransaction batch chains balance across multiple calls', () => {
    const store = usePosStore.getState();
    const studentId = '001';

    store.processTransaction(studentId, 'order', 90, 0);
    store.processTransaction(studentId, 'order', 90, 0);
    store.processTransaction(studentId, 'payment', 0, 100);

    const finalStudent = usePosStore.getState().students.find(s => s.studentId === studentId)!;
    // -90 -90 +100 = -80
    expect(finalStudent.currentBalance).toBe(-80);

    const txs = usePosStore.getState().transactions.filter(t => t.studentId === studentId);
    expect(txs).toHaveLength(3);
    // newest first
    expect(txs[0].afterBalance).toBe(-80);
    expect(txs[1].afterBalance).toBe(-180);
    expect(txs[2].afterBalance).toBe(-90);
  });

  it('T6: updateTransaction nonexistent ID is a no-op', () => {
    const store = usePosStore.getState();
    const txCountBefore = store.transactions.length;

    store.updateTransaction('nonexistent-id', { type: 'payment', mealPrice: 0, paidAmount: 100 });

    const next = usePosStore.getState();
    expect(next.transactions.length).toBe(txCountBefore);
  });
});

describe('transactionActions — editTransaction / deleteTransaction', () => {
  it('T7: editTransaction recalculates balance and emits audit event', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    store.editTransaction(tx.transactionId, { mealPrice: 100, paidAmount: 50 });

    const next = usePosStore.getState();
    const edited = next.transactions.find(t => t.transactionId === tx.transactionId)!;
    const student = next.students.find(s => s.studentId === '001')!;

    // mealPrice 90→100 (+10 cost), paidAmount 0→50 (+50 paid) → delta = +40
    expect(edited.mealPrice).toBe(100);
    expect(edited.paidAmount).toBe(50);
    expect(student.currentBalance).toBe(-50); // was -90, +40 = -50
    expect(edited.revision).toBe(tx.revision + 1);
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0].eventType).toBe('transaction_edited');
  });

  it('T8: deleteTransaction removes transaction and recalculates student balance', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    const studentBefore = usePosStore.getState().students.find(s => s.studentId === '001')!;
    expect(studentBefore.currentBalance).toBe(-90);

    store.deleteTransaction(tx.transactionId);

    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();

    const studentAfter = next.students.find(s => s.studentId === '001')!;
    expect(studentAfter.currentBalance).toBe(0);
  });

  it('T9: deleteOrderWithRefundCheck tracks refund details and emits audit event', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 90, 50);
    const tx = usePosStore.getState().transactions[0];

    const result = store.deleteOrderWithRefundCheck(tx.transactionId);

    expect(result.deleted).toBe(true);
    expect(result.refundAmount).toBe(50);
    expect(result.studentName).toBe(tx.studentNameSnapshot);

    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0].eventType).toBe('transaction_deleted');
  });
});
