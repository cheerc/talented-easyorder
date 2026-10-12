import type { DeleteOrderResult, PosState } from '../posTypes';
import type { LedgerTransaction } from '../../domain/ledger';
import { rebalanceAccounts, calculateTransactionAmount } from '../../domain/ledger';
import {
  checkLedgerMutation,
  createLedgerAuditEvent,
  type LedgerAuditEvent,
  type LedgerMutationOptions,
  type LedgerMutationResult,
} from '../../domain/ledgerAudit';
import { SYSTEM_OPERATOR_ID } from '../../domain/operatorId';

const NOT_FOUND = '找不到這筆交易，可能已經被刪除。';

/**
 * M2：更正、刪除、取消訂餐只走這裡。每個入口都先過 checkLedgerMutation（關帳日、理由），
 * 交易、餘額與稽核紀錄在同一次 set 寫入，不會出現「交易改了、稽核沒寫」。
 * 刪除時整筆原單存在稽核的 before，事後查得到。
 */
export function createEditActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
) {
  const audit = (
    eventType: LedgerAuditEvent['eventType'],
    tx: LedgerTransaction,
    before: Record<string, unknown>,
    after: Record<string, unknown> | null,
    opts: LedgerMutationOptions,
  ) => createLedgerAuditEvent({
    auditEventId: `evt-${crypto.randomUUID()}`,
    eventType,
    entityType: 'transaction',
    entityId: tx.transactionId,
    businessDate: tx.businessDate,
    before,
    after,
    reason: opts.reason.trim(),
    operatorId: opts.operatorId ?? SYSTEM_OPERATOR_ID,
    createdAt: new Date().toISOString(),
  });

  return {
    deleteTransaction: (id: string, opts: LedgerMutationOptions): LedgerMutationResult => {
      const state = get();
      const tx = state.transactions.find(t => t.transactionId === id);
      if (!tx) return { ok: false, message: NOT_FOUND };
      const check = checkLedgerMutation(state.businessDateStatuses[tx.businessDate], opts.reason);
      if (!check.ok) return check;

      const newTransactions = state.transactions.filter(t => t.transactionId !== id);
      const rebalanced = rebalanceAccounts(state.students, state.transactions, newTransactions, [tx.studentId]);
      set({
        ...rebalanced,
        auditEvents: [...state.auditEvents, audit('transaction_deleted', tx, { ...tx }, null, opts)],
      });
      return { ok: true };
    },

    // Ref: #310 — operatorId for audit trail. Falls back to SYSTEM_OPERATOR_ID for automated ops.
    deleteOrderWithRefundCheck: (
      id: string,
      opts: LedgerMutationOptions & { keepPaymentAsDeposit?: boolean },
    ): DeleteOrderResult => {
      const state = get();
      const tx = state.transactions.find(t => t.transactionId === id);
      if (!tx || tx.type !== 'order') {
        return { deleted: false, refundAmount: 0, studentName: '', wasClosedDate: false, message: NOT_FOUND };
      }

      const dateStatus = state.businessDateStatuses[tx.businessDate] || 'open';
      const wasClosedDate = dateStatus !== 'open';
      const check = checkLedgerMutation(dateStatus, opts.reason);
      if (!check.ok) {
        return { deleted: false, refundAmount: 0, studentName: tx.studentNameSnapshot, wasClosedDate, message: check.message };
      }

      let remainingTx: LedgerTransaction[];
      let refundAmount = tx.paidAmount;
      let auditEvent: LedgerAuditEvent;

      if (opts.keepPaymentAsDeposit && tx.paidAmount > 0) {
        // 取消餐費、收款留在帳戶：原單改成同金額的繳費。
        refundAmount = 0;
        const note = `取消訂餐：保留繳費 ${tx.paidAmount}`;
        auditEvent = audit(
          'transaction_edited', tx,
          { type: tx.type, mealPrice: tx.mealPrice, paidAmount: tx.paidAmount, note: tx.note },
          { type: 'payment', mealPrice: 0, paidAmount: tx.paidAmount, note },
          opts,
        );
        remainingTx = state.transactions.map(t => t.transactionId === id
          ? { ...t, type: 'payment', mealPrice: 0, amount: t.paidAmount, note, revision: t.revision + 1 }
          : t);
      } else {
        // 取消餐費並退還本筆收款：原單移除，整筆存在稽核。
        auditEvent = audit('transaction_deleted', tx, { ...tx }, null, opts);
        remainingTx = state.transactions.filter(t => t.transactionId !== id);
      }

      // M2：只重算這個帳戶；其他帳戶不動。
      const rebalanced = rebalanceAccounts(state.students, state.transactions, remainingTx, [tx.studentId]);
      set({ ...rebalanced, auditEvents: [...state.auditEvents, auditEvent] });

      return { deleted: true, refundAmount, studentName: tx.studentNameSnapshot, wasClosedDate };
    },

    // Ref: #310 — operatorId for audit trail
    editTransaction: (
      id: string,
      updates: { mealPrice?: number; paidAmount?: number; note?: string },
      opts: LedgerMutationOptions,
    ): LedgerMutationResult => {
      const state = get();
      const txIndex = state.transactions.findIndex(t => t.transactionId === id);
      if (txIndex === -1) return { ok: false, message: NOT_FOUND };

      const original = state.transactions[txIndex];
      const check = checkLedgerMutation(state.businessDateStatuses[original.businessDate], opts.reason);
      if (!check.ok) return check;

      const newMealPrice = Math.round(updates.mealPrice ?? original.mealPrice);
      const newPaidAmount = Math.round(updates.paidAmount ?? original.paidAmount);
      const newNote = updates.note ?? original.note;

      const auditEvent = audit(
        'transaction_edited', original,
        { mealPrice: original.mealPrice, paidAmount: original.paidAmount, note: original.note },
        { mealPrice: newMealPrice, paidAmount: newPaidAmount, note: newNote },
        opts,
      );

      const newTx: LedgerTransaction = {
        ...original,
        mealPrice: newMealPrice,
        paidAmount: newPaidAmount,
        amount: calculateTransactionAmount(newMealPrice, newPaidAmount),
        note: newNote,
        revision: original.revision + 1,
      };

      const newTransactions = state.transactions.map((t, i) => (i === txIndex ? newTx : t));
      // M2 F03：修改後這個帳戶之後每一筆的結餘都要跟著變，不只目前餘額。
      const rebalanced = rebalanceAccounts(state.students, state.transactions, newTransactions, [original.studentId]);
      set({ ...rebalanced, auditEvents: [...state.auditEvents, auditEvent] });
      return { ok: true };
    },
  };
}
