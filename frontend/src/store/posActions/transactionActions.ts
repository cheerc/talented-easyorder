import type { PosState } from '../posTypes';
import { CASHIER_SENTINEL, recalculateStudentBalances } from '../../domain/ledger';
import { createLedgerTransaction, calculateTransactionAmount } from '../../domain/ledger';
import { createStudentSnapshot } from '../../domain/student';
import { createMenuSnapshot } from '../../domain/menu';
import { createLedgerAuditEvent } from '../../domain/ledgerAudit';
import type { PosTransactionDraft } from '../../domain/posTransaction';
import type { LedgerTransaction } from '../../domain/ledger';

export function createTransactionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState
): Pick<PosState, 'commitPosTransactionDraft' | 'processTransaction' | 'updateTransaction' | 'deleteTransaction' | 'deleteOrderWithRefundCheck' | 'editTransaction'> {
  return {
    commitPosTransactionDraft: (draft: PosTransactionDraft) => {
      set((state) => {
        const isExpense = draft.intent.type === 'expense';
        const sid = draft.intent.studentId;

        if (isExpense) {
          const now = new Date().toISOString();
          const newTransaction = createLedgerTransaction({
            transactionId: crypto.randomUUID(),
            businessDate: draft.intent.businessDate,
            createdAt: now,
            studentSnapshot: { studentId: CASHIER_SENTINEL, studentNameSnapshot: '櫃台' },
            menuSnapshot: { menuNameSnapshot: '', vendorNameSnapshot: '' },
            type: 'expense',
            mealPrice: Math.round(draft.intent.mealPrice),
            paidAmount: Math.round(draft.intent.paidAmount),
            previousBalance: 0,
            sourceDevice: draft.intent.sourceDevice,
            note: draft.intent.note,
          });
          return { transactions: [newTransaction, ...state.transactions] };
        }

        const studentIndex = state.students.findIndex(s => s.studentId === sid);
        if (studentIndex === -1) return state;

        const student = state.students[studentIndex];
        const now = new Date().toISOString();

        const newStudents = [...state.students];
        const roundedBalance = Math.round(draft.expectedBalanceAfter);
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

        return {
          students: newStudents,
          transactions: [newTransaction, ...state.transactions],
        };
      });
    },

    processTransaction: (studentId: string, type: LedgerTransaction['type'], mealPrice: number, paidAmount: number, note?: string) => {
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
    },

    updateTransaction: (id: string, updates: Partial<LedgerTransaction>) => {
      set((state) => {
        const txIndex = state.transactions.findIndex(t => t.transactionId === id);
        if (txIndex === -1) return state;

        const oldTx = state.transactions[txIndex];
        const newTx = { ...oldTx, ...updates };

        newTx.amount = calculateTransactionAmount(newTx.mealPrice, newTx.paidAmount);

        const diff = newTx.amount - oldTx.amount;
        newTx.afterBalance = oldTx.afterBalance + diff;

        const newTransactions = [...state.transactions];
        newTransactions[txIndex] = newTx;

        for (let i = 0; i < txIndex; i++) {
          if (newTransactions[i].studentId === oldTx.studentId) {
            newTransactions[i] = {
              ...newTransactions[i],
              afterBalance: newTransactions[i].afterBalance + diff
            };
          }
        }

        const studentIndex = state.students.findIndex(s => s.studentId === oldTx.studentId);
        if (studentIndex === -1) return { transactions: newTransactions };

        const newStudents = [...state.students];
        newStudents[studentIndex] = {
          ...newStudents[studentIndex],
          currentBalance: newStudents[studentIndex].currentBalance + diff
        };

        return { transactions: newTransactions, students: newStudents };
      });
    },

    deleteTransaction: (id: string) => {
      set((state) => {
        const txIndex = state.transactions.findIndex(t => t.transactionId === id);
        if (txIndex === -1) return state;

        const tx = state.transactions[txIndex];
        if (tx.studentId === CASHIER_SENTINEL) {
          const newTransactions = [...state.transactions];
          newTransactions.splice(txIndex, 1);
          return { transactions: newTransactions };
        }

        const studentIndex = state.students.findIndex(s => s.studentId === tx.studentId);

        const newTransactions = [...state.transactions];
        for (let i = 0; i < txIndex; i++) {
          if (newTransactions[i].studentId === tx.studentId) {
            newTransactions[i] = {
              ...newTransactions[i],
              afterBalance: newTransactions[i].afterBalance - tx.amount
            };
          }
        }
        newTransactions.splice(txIndex, 1);

        if (studentIndex === -1) return { transactions: newTransactions };

        const newStudents = [...state.students];
        newStudents[studentIndex] = {
          ...newStudents[studentIndex],
          currentBalance: Math.round(newStudents[studentIndex].currentBalance - tx.amount)
        };

        return { transactions: newTransactions, students: newStudents };
      });
    },

    deleteOrderWithRefundCheck: (id: string) => {
      const state = get();
      const tx = state.transactions.find(t => t.transactionId === id);
      if (!tx || tx.type !== 'order') {
        return { deleted: false, refundAmount: 0, studentName: '', wasClosedDate: false };
      }

      const dateStatus = state.businessDateStatuses[tx.businessDate] || 'open';
      const wasClosedDate = dateStatus !== 'open';
      const refundAmount = tx.paidAmount;

      const now = new Date().toISOString();
      const auditEvent = createLedgerAuditEvent({
        auditEventId: `evt-${Date.now()}`,
        eventType: 'transaction_deleted',
        entityType: 'transaction',
        entityId: id,
        businessDate: tx.businessDate,
        before: { ...tx },
        after: null,
        reason: 'delete',
        operatorId: 'system',
        createdAt: now,
      });

      const remainingTx = state.transactions.filter(t => t.transactionId !== id);

      const { students: newStudents, transactions: newStudentTx } = recalculateStudentBalances(
        state.students,
        remainingTx
      );

      const cashierTx = remainingTx.filter(t => t.studentId === CASHIER_SENTINEL);

      const newTransactions = [...newStudentTx, ...cashierTx].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt)
      );

      set({
        transactions: newTransactions,
        students: newStudents,
        auditEvents: [...state.auditEvents, auditEvent],
      });

      return {
        deleted: true,
        refundAmount,
        studentName: tx.studentNameSnapshot,
        wasClosedDate,
      };
    },

    editTransaction: (id: string, updates: { mealPrice?: number; paidAmount?: number; note?: string }) => {
      const state = get();
      const txIndex = state.transactions.findIndex(t => t.transactionId === id);
      if (txIndex === -1) return;

      const original = state.transactions[txIndex];
      const dateStatus = state.businessDateStatuses[original.businessDate];
      if (dateStatus === 'closed') return;

      const newMealPrice = Math.round(updates.mealPrice ?? original.mealPrice);
      const newPaidAmount = Math.round(updates.paidAmount ?? original.paidAmount);
      const newNote = updates.note ?? original.note;

      const oldDelta = original.paidAmount - original.mealPrice;
      const newDelta = newPaidAmount - newMealPrice;
      const balanceDelta = newDelta - oldDelta;

      const now = new Date().toISOString();
      const auditEvent = createLedgerAuditEvent({
        auditEventId: `evt-${Date.now()}`,
        eventType: 'transaction_edited',
        entityType: 'transaction',
        entityId: id,
        businessDate: original.businessDate,
        before: { mealPrice: original.mealPrice, paidAmount: original.paidAmount, note: original.note },
        after: { mealPrice: newMealPrice, paidAmount: newPaidAmount, note: newNote },
        reason: 'edit',
        operatorId: 'system',
        createdAt: now,
      });

      const newAmount = calculateTransactionAmount(newMealPrice, newPaidAmount);
      const newTx: LedgerTransaction = {
        ...original,
        mealPrice: newMealPrice,
        paidAmount: newPaidAmount,
        amount: newAmount,
        note: newNote,
        revision: original.revision + 1,
      };

      if (original.studentId !== CASHIER_SENTINEL) {
        const studentIndex = state.students.findIndex(s => s.studentId === original.studentId);
        if (studentIndex !== -1) {
          const newStudents = [...state.students];
          newStudents[studentIndex] = {
            ...newStudents[studentIndex],
            currentBalance: Math.round(newStudents[studentIndex].currentBalance + balanceDelta),
          };

          const newTransactions = state.transactions.map((t, i) =>
            i === txIndex ? newTx : t
          );

          set({
            transactions: newTransactions,
            auditEvents: [...state.auditEvents, auditEvent],
            students: newStudents,
          });
          return;
        }
      }

      const newTransactions = state.transactions.map((t, i) =>
        i === txIndex ? newTx : t
      );

      set({
        transactions: newTransactions,
        auditEvents: [...state.auditEvents, auditEvent],
      });
    },
  };
}
