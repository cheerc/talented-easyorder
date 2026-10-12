import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

// Ref: #358 — Tests for editActions (delete/edit with audit trail)

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('editActions — deleteTransaction', () => {
  it('removes transaction and adjusts student balance', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    const balanceAfterOrder = usePosStore.getState().students.find(s => s.studentId === '001')!.currentBalance;

    usePosStore.getState().deleteTransaction(tx.transactionId);

    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
    // Balance should be restored
    expect(next.students.find(s => s.studentId === '001')!.currentBalance).toBe(
      Math.round(balanceAfterOrder + 90)
    );
  });

  it('does nothing for non-existent transaction', () => {
    const store = usePosStore.getState();
    const txCount = store.transactions.length;
    store.deleteTransaction('NONEXISTENT');
    expect(usePosStore.getState().transactions.length).toBe(txCount);
  });
});

describe('editActions — deleteOrderWithRefundCheck', () => {
  it('deletes an order and returns refund info', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 50);
    const tx = usePosStore.getState().transactions[0];

    const result = usePosStore.getState().deleteOrderWithRefundCheck(tx.transactionId);

    expect(result.deleted).toBe(true);
    expect(result.refundAmount).toBe(50);
    expect(result.wasClosedDate).toBe(false);
    expect(usePosStore.getState().transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
  });

  it('creates audit event on deletion', () => {
    const store = usePosStore.getState();
    const auditsBefore = store.auditEvents.length;
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    usePosStore.getState().deleteOrderWithRefundCheck(tx.transactionId);

    const audits = usePosStore.getState().auditEvents;
    expect(audits.length).toBe(auditsBefore + 1);
    expect(audits[audits.length - 1].eventType).toBe('transaction_deleted');
  });

  it('returns not-deleted for non-order transaction', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'payment', 0, 500);
    const tx = usePosStore.getState().transactions[0];

    const result = usePosStore.getState().deleteOrderWithRefundCheck(tx.transactionId);
    expect(result.deleted).toBe(false);
  });

  it('returns not-deleted for non-existent id', () => {
    const result = usePosStore.getState().deleteOrderWithRefundCheck('NONEXISTENT');
    expect(result.deleted).toBe(false);
    expect(result.refundAmount).toBe(0);
  });
});

describe('editActions — editTransaction', () => {
  it('updates mealPrice and recalculates balance', () => {
    const store = usePosStore.getState();
    const initialBalance = store.students.find(s => s.studentId === '001')!.currentBalance;

    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    usePosStore.getState().editTransaction(tx.transactionId, { mealPrice: 60 });

    const next = usePosStore.getState();
    const editedTx = next.transactions.find(t => t.transactionId === tx.transactionId)!;
    const student = next.students.find(s => s.studentId === '001')!;

    expect(editedTx.mealPrice).toBe(60);
    expect(editedTx.revision).toBe(tx.revision + 1);
    // Balance should reflect cheaper meal: initialBalance - 60
    expect(student.currentBalance).toBe(initialBalance - 60);
  });

  it('creates audit event for edit', () => {
    const store = usePosStore.getState();
    const auditsBefore = store.auditEvents.length;
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    usePosStore.getState().editTransaction(tx.transactionId, { note: 'updated' });

    const audits = usePosStore.getState().auditEvents;
    expect(audits.length).toBe(auditsBefore + 1);
    expect(audits[audits.length - 1].eventType).toBe('transaction_edited');
  });
});

describe('M2 F03：改帳後這個帳戶之後每一筆的結餘都重算', () => {
  function setup() {
    usePosStore.setState({ transactions: [] });
    const start = usePosStore.getState().students.find(s => s.studentId === '001')!.currentBalance;
    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    const order = usePosStore.getState().transactions[0];
    usePosStore.getState().processTransaction('001', 'payment', 0, 100);
    const payment = usePosStore.getState().transactions[0];
    return { start, order, payment };
  }
  const bal = () => usePosStore.getState().students.find(s => s.studentId === '001')!.currentBalance;
  const after = (id: string) => usePosStore.getState().transactions.find(t => t.transactionId === id)!.afterBalance;

  it('editTransaction 把收款 100 改成 120：最後一筆結餘與目前餘額一致', () => {
    const { start, payment } = setup();
    usePosStore.getState().editTransaction(payment.transactionId, { paidAmount: 120 });
    expect(bal()).toBe(start - 90 + 120);
    expect(after(payment.transactionId)).toBe(start - 90 + 120);
  });

  it('editTransaction 改前面那筆訂餐：後面的收款結餘跟著變', () => {
    const { start, order, payment } = setup();
    usePosStore.getState().editTransaction(order.transactionId, { mealPrice: 110 });
    expect(after(order.transactionId)).toBe(start - 110);
    expect(after(payment.transactionId)).toBe(start - 110 + 100);
    expect(bal()).toBe(start - 110 + 100);
  });

  it('deleteTransaction 刪掉中間那筆：後面的結餘往回調', () => {
    const { start, order, payment } = setup();
    usePosStore.getState().deleteTransaction(order.transactionId);
    expect(after(payment.transactionId)).toBe(start + 100);
    expect(bal()).toBe(start + 100);
  });

  it('deleteOrderWithRefundCheck 不會動到其他帳戶的餘額', () => {
    const { order } = setup();
    const others = usePosStore.getState().students.filter(s => s.studentId !== '001').map(s => [s.studentId, s.currentBalance]);
    usePosStore.getState().deleteOrderWithRefundCheck(order.transactionId);
    expect(usePosStore.getState().students.filter(s => s.studentId !== '001').map(s => [s.studentId, s.currentBalance])).toEqual(others);
  });
});

