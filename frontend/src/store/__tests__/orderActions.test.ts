import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

// Ref: #358 — Tests for orderActions (main POS flow)

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('orderActions — processTransaction', () => {
  it('creates an order transaction and deducts balance', () => {
    const store = usePosStore.getState();
    const student = store.students.find(s => s.studentId === '001')!;
    const initialBalance = student.currentBalance;

    store.processTransaction('001', 'order', 90, 0);

    const next = usePosStore.getState();
    const tx = next.transactions[0];
    const updated = next.students.find(s => s.studentId === '001')!;

    expect(tx.type).toBe('order');
    expect(tx.studentId).toBe('001');
    expect(tx.mealPrice).toBe(90);
    expect(tx.paidAmount).toBe(0);
    expect(tx.sourceDevice).toBe('pc');
    expect(updated.currentBalance).toBe(initialBalance - 90);
  });

  it('creates a payment transaction and adds balance', () => {
    const store = usePosStore.getState();
    const student = store.students.find(s => s.studentId === '001')!;
    const initialBalance = student.currentBalance;

    store.processTransaction('001', 'payment', 0, 500);

    const next = usePosStore.getState();
    const tx = next.transactions[0];
    const updated = next.students.find(s => s.studentId === '001')!;

    expect(tx.type).toBe('payment');
    expect(tx.paidAmount).toBe(500);
    expect(updated.currentBalance).toBe(initialBalance + 500);
  });

  it('does nothing for non-existent student', () => {
    const store = usePosStore.getState();
    const txCountBefore = store.transactions.length;

    store.processTransaction('NONEXISTENT', 'order', 90, 0);

    const next = usePosStore.getState();
    expect(next.transactions.length).toBe(txCountBefore);
  });

  it('prepends transaction to transactions array', () => {
    const store = usePosStore.getState();

    store.processTransaction('001', 'order', 60, 0);
    store.processTransaction('001', 'payment', 0, 200);

    const next = usePosStore.getState();
    // Most recent first
    expect(next.transactions[0].type).toBe('payment');
    expect(next.transactions[1].type).toBe('order');
  });

  it('uses todayMenu.itemName as note for order type', () => {
    const store = usePosStore.getState();
    const menuName = store.todayMenu.itemName;

    store.processTransaction('001', 'order', 90, 0);

    const tx = usePosStore.getState().transactions[0];
    expect(tx.note).toBe(menuName);
  });
});
