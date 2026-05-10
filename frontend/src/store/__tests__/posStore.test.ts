import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

describe('posStore Accounting Engine', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('calculates order balance correctly', () => {
    const studentId = '001';
    const store = usePosStore.getState();
    const initialBalance = store.students.find(s => s.id === studentId)!.balance;

    store.processTransaction(studentId, 'order', 90, 0);

    const updatedStudent = usePosStore.getState().students.find(s => s.id === studentId)!;
    expect(updatedStudent.balance).toBe(initialBalance - 90);
  });

  it('recalculates after balance correctly on update', () => {
    const studentId = '001';
    const store = usePosStore.getState();
    
    // Clear transactions to start fresh
    usePosStore.setState({ transactions: [] });

    // Tx 1: Order (balance -90)
    store.processTransaction(studentId, 'order', 90, 0);
    const tx1 = usePosStore.getState().transactions[0];
    
    // Tx 2: Order (balance -90)
    store.processTransaction(studentId, 'order', 90, 0);
    const tx2 = usePosStore.getState().transactions[0];

    const balanceAfterTx2 = usePosStore.getState().students.find(s => s.id === studentId)!.balance;
    expect(tx2.after).toBe(balanceAfterTx2);

    // Update Tx 1: Changed to Topup +100
    // So Tx 1 amount goes from -90 to +100 (diff: +190)
    // The later Tx 2 should have its `after` updated to reflect this +190 diff.
    usePosStore.getState().updateTransaction(tx1.id, { type: 'topup', mealPrice: 0, paidAmount: 100 });

    const newTx1 = usePosStore.getState().transactions.find(t => t.id === tx1.id)!;
    const newTx2 = usePosStore.getState().transactions.find(t => t.id === tx2.id)!;
    const finalBalance = usePosStore.getState().students.find(s => s.id === studentId)!.balance;

    expect(newTx1.after).toBe(tx1.after + 190);
    expect(newTx2.after).toBe(tx2.after + 190);
    expect(newTx2.after).toBe(finalBalance);
  });
});
