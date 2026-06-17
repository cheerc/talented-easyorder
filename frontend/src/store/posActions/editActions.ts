import type { PosState } from '../posTypes';
import type { LedgerTransaction } from '../../domain/ledger';
import { CASHIER_SENTINEL, recalculateStudentBalances, calculateTransactionAmount } from '../../domain/ledger';
import { createLedgerAuditEvent } from '../../domain/ledgerAudit';
import { SYSTEM_OPERATOR_ID } from '../../domain/operatorId';

export function createEditActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
) {
  return {
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

    // Ref: #310 — operatorId param for audit trail. Falls back to SYSTEM_OPERATOR_ID for automated ops.
    deleteOrderWithRefundCheck: (id: string, operatorId?: string, keepPaymentAsDeposit?: boolean) => {
      const state = get();
      const tx = state.transactions.find(t => t.transactionId === id);
      if (!tx || tx.type !== 'order') {
        return { deleted: false, refundAmount: 0, studentName: '', wasClosedDate: false };
      }

      const dateStatus = state.businessDateStatuses[tx.businessDate] || 'open';
      const wasClosedDate = dateStatus !== 'open';
      
      const now = new Date().toISOString();
      let remainingTx = state.transactions;
      let refundAmount = tx.paidAmount;
      let auditEvent;

      if (keepPaymentAsDeposit && tx.paidAmount > 0) {
        refundAmount = 0;
        auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${crypto.randomUUID()}`,
          eventType: 'transaction_edited',
          entityType: 'transaction',
          entityId: id,
          businessDate: tx.businessDate,
          before: { mealPrice: tx.mealPrice, paidAmount: tx.paidAmount, note: tx.note },
          after: { mealPrice: 0, paidAmount: tx.paidAmount, note: `取消訂餐：保留繳費 ${tx.paidAmount}` },
          reason: 'edit',
          operatorId: operatorId ?? SYSTEM_OPERATOR_ID,
          createdAt: now,
        });

        remainingTx = state.transactions.map(t => {
          if (t.transactionId === id) {
            return {
              ...t,
              type: 'payment',
              mealPrice: 0,
              amount: t.paidAmount,
              note: `取消訂餐：保留繳費 ${t.paidAmount}`,
              revision: t.revision + 1,
            };
          }
          return t;
        });
      } else {
        auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${crypto.randomUUID()}`,
          eventType: 'transaction_deleted',
          entityType: 'transaction',
          entityId: id,
          businessDate: tx.businessDate,
          before: { ...tx },
          after: null,
          reason: 'delete',
          operatorId: operatorId ?? SYSTEM_OPERATOR_ID,
          createdAt: now,
        });
        remainingTx = state.transactions.filter(t => t.transactionId !== id);
      }

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

    // Ref: #310 — operatorId param for audit trail
    editTransaction: (id: string, updates: { mealPrice?: number; paidAmount?: number; note?: string }, operatorId?: string) => {
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
        auditEventId: `evt-${crypto.randomUUID()}`,
        eventType: 'transaction_edited',
        entityType: 'transaction',
        entityId: id,
        businessDate: original.businessDate,
        before: { mealPrice: original.mealPrice, paidAmount: original.paidAmount, note: original.note },
        after: { mealPrice: newMealPrice, paidAmount: newPaidAmount, note: newNote },
        reason: 'edit',
        operatorId: operatorId ?? SYSTEM_OPERATOR_ID,
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
