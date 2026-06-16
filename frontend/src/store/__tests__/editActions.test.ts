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
