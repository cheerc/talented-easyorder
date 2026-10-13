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

describe('transactionActions — processTransaction / editTransaction', () => {
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

  it('T6: editTransaction nonexistent ID is a no-op', () => {
    const store = usePosStore.getState();
    const txCountBefore = store.transactions.length;

    store.editTransaction('nonexistent-id', { mealPrice: 0, paidAmount: 100 }, { reason: '測試' });

    const next = usePosStore.getState();
    expect(next.transactions.length).toBe(txCountBefore);
  });
});

describe('transactionActions — editTransaction / deleteTransaction', () => {
  it('T7: editTransaction recalculates balance and emits audit event', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    store.editTransaction(tx.transactionId, { mealPrice: 100, paidAmount: 50 }, { reason: '測試' });

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

    store.deleteTransaction(tx.transactionId, { reason: '測試' });

    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();

    const studentAfter = next.students.find(s => s.studentId === '001')!;
    expect(studentAfter.currentBalance).toBe(0);
  });

  it('T9: deleteOrderWithRefundCheck tracks refund details and emits audit event', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 90, 50);
    const tx = usePosStore.getState().transactions[0];

    const result = store.deleteOrderWithRefundCheck(tx.transactionId, { reason: '測試' });

    expect(result.deleted).toBe(true);
    expect(result.refundAmount).toBe(50);
    expect(result.studentName).toBe(tx.studentNameSnapshot);

    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0].eventType).toBe('transaction_deleted');
  });

  it('T9b: deleteOrderWithRefundCheck with keepPaymentAsDeposit converts order to payment', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 90, 50);
    const tx = usePosStore.getState().transactions[0];

    const studentBefore = usePosStore.getState().students.find(s => s.studentId === '001')!;
    // balance is affected by order (amount = 50 - 90 = -40)

    const result = store.deleteOrderWithRefundCheck(tx.transactionId, { reason: '測試', keepPaymentAsDeposit: true });

    expect(result.deleted).toBe(true);
    expect(result.refundAmount).toBe(0); // Kept as deposit

    const next = usePosStore.getState();
    const updatedTx = next.transactions.find(t => t.transactionId === tx.transactionId)!;
    const studentAfter = next.students.find(s => s.studentId === '001')!;

    expect(updatedTx.type).toBe('payment');
    expect(updatedTx.mealPrice).toBe(0);
    expect(updatedTx.paidAmount).toBe(50);
    expect(updatedTx.amount).toBe(50);
    // Balance was base_balance - 40. Now it is base_balance + 50. Difference is +90.
    expect(studentAfter.currentBalance).toBe(studentBefore.currentBalance + 90);
  });
});

describe('M2：關帳日在 store 層擋下所有新增入口', () => {
  function close(date: string) {
    usePosStore.setState(s => ({ businessDateStatuses: { ...s.businessDateStatuses, [date]: 'closed' } }));
  }
  function draftFor(type: 'order' | 'payment' | 'expense') {
    const store = usePosStore.getState();
    const student = store.students.find(s => s.studentId === '001')!;
    return buildPosTransactionDraft({
      intent: {
        businessDate: store.todayMenu.businessDate,
        studentId: type === 'expense' ? CASHIER_SENTINEL : '001',
        type,
        mealPrice: type === 'order' ? 90 : type === 'expense' ? 50 : 0,
        paidAmount: type === 'payment' ? 100 : 0,
        note: '',
        sourceDevice: 'pc',
      },
      student,
      menu: store.todayMenu,
    });
  }

  it('commitPosTransactionDraft：訂餐、繳費、櫃台支出都回傳失敗，資料不動', () => {
    const date = usePosStore.getState().todayMenu.businessDate;
    close(date);
    const before = usePosStore.getState();
    for (const type of ['order', 'payment', 'expense'] as const) {
      const r = usePosStore.getState().commitPosTransactionDraft(draftFor(type));
      expect(r).toEqual({ ok: false, message: expect.stringContaining('已經關帳') });
    }
    const after = usePosStore.getState();
    expect(after.transactions).toBe(before.transactions);
    expect(after.students).toBe(before.students);
  });

  it('重開（reopened）後可以新增', () => {
    const date = usePosStore.getState().todayMenu.businessDate;
    usePosStore.setState(s => ({ businessDateStatuses: { ...s.businessDateStatuses, [date]: 'reopened' } }));
    expect(usePosStore.getState().commitPosTransactionDraft(draftFor('order'))).toMatchObject({ ok: true });
  });

  it('processTransaction 也不寫入', () => {
    const date = usePosStore.getState().todayMenu.businessDate;
    close(date);
    const before = usePosStore.getState().transactions;
    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    expect(usePosStore.getState().transactions).toBe(before);
  });
});
