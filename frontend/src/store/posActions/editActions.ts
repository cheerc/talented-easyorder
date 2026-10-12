import type { PosState } from '../posTypes';
import type { LedgerTransaction } from '../../domain/ledger';
import { rebalanceAccounts, calculateTransactionAmount } from '../../domain/ledger';
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

        const newTransactions = [...state.transactions];
        newTransactions[txIndex] = newTx;

        // M2 F03：改一筆後，這個帳戶之後每一筆的結餘與目前餘額都重算。
        return rebalanceAccounts(state.students, state.transactions, newTransactions, [oldTx.studentId, newTx.studentId]);
      });
    },

    deleteTransaction: (id: string) => {
      set((state) => {
        const tx = state.transactions.find(t => t.transactionId === id);
        if (!tx) return state;
        const newTransactions = state.transactions.filter(t => t.transactionId !== id);
        return rebalanceAccounts(state.students, state.transactions, newTransactions, [tx.studentId]);
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
      let remainingTx: LedgerTransaction[];
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

      // M2：只重算這個帳戶；其他帳戶不動（舊資料沒有期初時，整批重算會把餘額歸零）。
      const { students: newStudents, transactions: newTransactions } = rebalanceAccounts(
        state.students, state.transactions, remainingTx, [tx.studentId],
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

      const newTransactions = state.transactions.map((t, i) => (i === txIndex ? newTx : t));
      // M2 F03：修改後這個帳戶之後每一筆的結餘都要跟著變，不只目前餘額。
      const rebalanced = rebalanceAccounts(state.students, state.transactions, newTransactions, [original.studentId]);

      set({
        transactions: rebalanced.transactions,
        auditEvents: [...state.auditEvents, auditEvent],
        students: rebalanced.students,
      });
    },
  };
}
