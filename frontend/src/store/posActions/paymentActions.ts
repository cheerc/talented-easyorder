import type { PosState } from '../posTypes';
import { createLedgerTransaction, calculateTransactionAmount } from '../../domain/ledger';
import { createStudentSnapshot } from '../../domain/student';
import { createMenuSnapshot } from '../../domain/menu';

export function createPaymentActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  _get: () => PosState,
) {
  return {
    commitPaymentTransaction: (studentId: string, paidAmount: number, note?: string) => {
      set((state) => {
        const studentIndex = state.students.findIndex(s => s.studentId === studentId);
        if (studentIndex === -1) return state;

        const student = state.students[studentIndex];
        const now = new Date().toISOString();
        const amount = calculateTransactionAmount(0, paidAmount);
        const newBalance = student.currentBalance + amount;

        const newStudents = [...state.students];
        newStudents[studentIndex] = { ...student, currentBalance: newBalance };

        const newTransaction = createLedgerTransaction({
          transactionId: crypto.randomUUID(),
          businessDate: state.todayMenu.businessDate,
          createdAt: now,
          studentSnapshot: createStudentSnapshot(student),
          menuSnapshot: createMenuSnapshot(state.todayMenu),
          type: 'payment',
          mealPrice: 0,
          paidAmount,
          previousBalance: student.currentBalance,
          sourceDevice: 'pc',
          note: note || 'payment',
        });

        return {
          students: newStudents,
          transactions: [newTransaction, ...state.transactions],
        };
      });
    },
  };
}
