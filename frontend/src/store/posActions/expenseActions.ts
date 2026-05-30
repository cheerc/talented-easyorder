import type { PosState } from '../posTypes';
import { CASHIER_SENTINEL } from '../../domain/ledger';
import { createLedgerTransaction } from '../../domain/ledger';
import type { PosTransactionDraft } from '../../domain/posTransaction';

export function buildExpenseTransaction(draft: PosTransactionDraft) {
  const now = new Date().toISOString();
  return createLedgerTransaction({
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
}

export function commitExpenseTransaction(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  draft: PosTransactionDraft,
) {
  set((state) => {
    const newTransaction = buildExpenseTransaction(draft);
    return { transactions: [newTransaction, ...state.transactions] };
  });
}
