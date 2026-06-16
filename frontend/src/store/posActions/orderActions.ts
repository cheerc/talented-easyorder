import type { PosState } from '../posTypes';
import type { LedgerTransaction } from '../../domain/ledger';
import { createLedgerTransaction, calculateTransactionAmount } from '../../domain/ledger';
import { createStudentSnapshot } from '../../domain/student';
import { createMenuSnapshot } from '../../domain/menu';
import type { PosTransactionDraft } from '../../domain/posTransaction';

export function buildOrderTransaction(
  state: PosState,
  draft: PosTransactionDraft,
  studentIndex: number,
) {
  const student = state.students[studentIndex];
  const now = new Date().toISOString();
  const roundedBalance = Math.round(draft.expectedBalanceAfter);

  const newStudents = [...state.students];
  newStudents[studentIndex] = { ...student, currentBalance: roundedBalance };

  const newTransaction = createLedgerTransaction({
    transactionId: crypto.randomUUID(),
    businessDate: draft.intent.businessDate,
    createdAt: now,
    studentSnapshot: draft.snapshots.student,
    menuSnapshot: draft.snapshots.menu,
    type: draft.intent.type,
    mealPrice: Math.round(draft.intent.mealPrice),
    paidAmount: Math.round(draft.intent.paidAmount),
    previousBalance: student.currentBalance,
    sourceDevice: draft.intent.sourceDevice,
    note: draft.intent.note,
  });

  return { newStudents, newTransaction };
}

export function createOrderActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
) {
  return {
    processTransaction: (studentId: string, type: LedgerTransaction['type'], mealPrice: number, paidAmount: number, note?: string) => {
      const markKey = `pos-tx-${crypto.randomUUID()}`;
      performance.mark(`${markKey}-start`);
      try {
        set((state) => {
          const studentIndex = state.students.findIndex(s => s.studentId === studentId);
          if (studentIndex === -1) return state;

          const student = state.students[studentIndex];
          const now = new Date().toISOString();
          const amount = calculateTransactionAmount(mealPrice, paidAmount);
          const newBalance = student.currentBalance + amount;

          const newStudents = [...state.students];
          newStudents[studentIndex] = { ...student, currentBalance: newBalance };

          const newTransaction = createLedgerTransaction({
            transactionId: crypto.randomUUID(),
            businessDate: state.todayMenu.businessDate,
            createdAt: now,
            studentSnapshot: createStudentSnapshot(student),
            menuSnapshot: createMenuSnapshot(state.todayMenu),
            type,
            mealPrice,
            paidAmount,
            previousBalance: student.currentBalance,
            sourceDevice: 'pc',
            note: note || (type === 'order' ? state.todayMenu.itemName : type),
          });

          return {
            students: newStudents,
            transactions: [newTransaction, ...state.transactions]
          };
        });
      } finally {
        performance.mark(`${markKey}-end`);
        performance.measure('pos-transaction', `${markKey}-start`, `${markKey}-end`);
        // Ref: #322 — Clear entries to prevent PerformanceEntry buffer leak
        performance.clearMarks(`${markKey}-start`);
        performance.clearMarks(`${markKey}-end`);
        performance.clearMeasures('pos-transaction');
      }
    },
  };
}
