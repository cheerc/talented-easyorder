import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

// Ref: #358 — Tests for paymentActions (balance mutation)

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('paymentActions — commitPaymentTransaction', () => {
  it('creates a payment and adds to student balance', () => {
    const store = usePosStore.getState();
    const student = store.students.find(s => s.studentId === '001')!;
    const initialBalance = student.currentBalance;

    store.commitPaymentTransaction('001', 500);

    const next = usePosStore.getState();
    const tx = next.transactions[0];
    const updated = next.students.find(s => s.studentId === '001')!;

    expect(tx.type).toBe('payment');
    expect(tx.mealPrice).toBe(0);
    expect(tx.paidAmount).toBe(500);
    expect(updated.currentBalance).toBe(initialBalance + 500);
  });

  it('uses custom note when provided', () => {
    usePosStore.getState().commitPaymentTransaction('001', 200, '家長繳費');
    const tx = usePosStore.getState().transactions[0];
    expect(tx.note).toBe('家長繳費');
  });

  it('uses default note "payment" when no note provided', () => {
    usePosStore.getState().commitPaymentTransaction('001', 200);
    const tx = usePosStore.getState().transactions[0];
    expect(tx.note).toBe('payment');
  });

  it('does nothing for non-existent student', () => {
    const txCount = usePosStore.getState().transactions.length;
    usePosStore.getState().commitPaymentTransaction('NONEXISTENT', 500);
    expect(usePosStore.getState().transactions.length).toBe(txCount);
  });

  it('handles multiple payments correctly', () => {
    const store = usePosStore.getState();
    const initialBalance = store.students.find(s => s.studentId === '001')!.currentBalance;

    store.commitPaymentTransaction('001', 100);
    usePosStore.getState().commitPaymentTransaction('001', 200);

    const updated = usePosStore.getState().students.find(s => s.studentId === '001')!;
    expect(updated.currentBalance).toBe(initialBalance + 300);
  });
});
