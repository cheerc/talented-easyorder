import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../store/posStore';

describe('order payment integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePosStore.getState().resetData();
  });

  it('full payment: order then pay full amount, balance returns to zero', () => {
    const store = usePosStore.getState();

    // Set up a known student
    const student = store.students[0];
    const initialBalance = student.currentBalance;
    const mealPrice = 90;

    // Create order (mealPrice=90, paidAmount=0)
    store.processTransaction(student.studentId, 'order', mealPrice, 0);
    const afterOrder = usePosStore.getState();
    const orderedStudent = afterOrder.students.find(s => s.studentId === student.studentId)!;
    expect(orderedStudent.currentBalance).toBe(initialBalance - mealPrice);

    // Pay full amount
    store.processTransaction(student.studentId, 'payment', 0, mealPrice);
    const afterPayment = usePosStore.getState();
    const paidStudent = afterPayment.students.find(s => s.studentId === student.studentId)!;
    expect(paidStudent.currentBalance).toBe(initialBalance);

    // Verify transactions recorded
    const txForStudent = afterPayment.transactions.filter(
      t => t.studentId === student.studentId,
    );
    expect(txForStudent).toHaveLength(2);
    expect(txForStudent[0].type).toBe('payment');
    expect(txForStudent[1].type).toBe('order');
  });

  it('partial payment: order then pay half, balance reflects partial', () => {
    const store = usePosStore.getState();
    const student = store.students[0];
    const initialBalance = student.currentBalance;
    const mealPrice = 90;
    const partialPayment = 50;

    // Create order
    store.processTransaction(student.studentId, 'order', mealPrice, 0);
    const afterOrder = usePosStore.getState();
    const orderedStudent = afterOrder.students.find(s => s.studentId === student.studentId)!;
    expect(orderedStudent.currentBalance).toBe(initialBalance - mealPrice);

    // Partial payment
    store.processTransaction(student.studentId, 'payment', 0, partialPayment);
    const afterPayment = usePosStore.getState();
    const partialStudent = afterPayment.students.find(s => s.studentId === student.studentId)!;
    expect(partialStudent.currentBalance).toBe(initialBalance - mealPrice + partialPayment);

    // Still unpaid amount
    const remaining = mealPrice - partialPayment;
    const txForStudent = afterPayment.transactions.filter(
      t => t.studentId === student.studentId,
    );
    const totalPaid = txForStudent.reduce((sum, t) => sum + t.paidAmount, 0);
    expect(totalPaid).toBe(partialPayment);
    expect(remaining).toBeGreaterThan(0);
  });

  it('overpayment: paying more than mealPrice increases balance above initial', () => {
    const store = usePosStore.getState();
    const student = store.students[0];
    const initialBalance = student.currentBalance;
    const mealPrice = 90;
    const overPayment = 150;

    // Create order
    store.processTransaction(student.studentId, 'order', mealPrice, 0);
    const afterOrder = usePosStore.getState();
    const orderedStudent = afterOrder.students.find(s => s.studentId === student.studentId)!;
    expect(orderedStudent.currentBalance).toBe(initialBalance - mealPrice);

    // Overpay — exceeds mealPrice
    store.processTransaction(student.studentId, 'payment', 0, overPayment);
    const afterPayment = usePosStore.getState();
    const paidStudent = afterPayment.students.find(s => s.studentId === student.studentId)!;

    // Balance goes above initial due to overpayment
    const expectedBalance = initialBalance - mealPrice + overPayment;
    expect(paidStudent.currentBalance).toBe(expectedBalance);
    expect(paidStudent.currentBalance).toBeGreaterThan(initialBalance);

    // Verify the deposit amount (overpayment portion)
    const depositAmount = overPayment - mealPrice;
    expect(depositAmount).toBe(60);
  });
});
