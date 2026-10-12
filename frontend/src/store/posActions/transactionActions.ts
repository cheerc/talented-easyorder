import type { PosState } from '../posTypes';
import type { PosTransactionDraft } from '../../domain/posTransaction';
import { buildExpenseTransaction } from './expenseActions';
import { buildOrderTransaction } from './orderActions';
import { createOrderActions } from './orderActions';
import { createPaymentActions } from './paymentActions';
import { createEditActions } from './editActions';
import { rebalanceAccounts } from '../../domain/ledger';
import { checkNewLedgerEntry, type LedgerMutationResult } from '../../domain/ledgerAudit';

export function createTransactionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
): Pick<PosState, 'commitPosTransactionDraft' | 'processTransaction' | 'deleteTransaction' | 'deleteOrderWithRefundCheck' | 'editTransaction'> {
  const orderActions = createOrderActions(set);
  const paymentActions = createPaymentActions(set);
  const editActions = createEditActions(set, get);

  return {
    commitPosTransactionDraft: (draft: PosTransactionDraft): LedgerMutationResult => {
      const state = get();
      // M2：關帳日在 store 層就擋下，畫面鎖之外再多一道。
      const check = checkNewLedgerEntry(state.businessDateStatuses[draft.intent.businessDate]);
      if (!check.ok) return check;

      const isExpense = draft.intent.type === 'expense';
      const sid = draft.intent.studentId;

      if (isExpense) {
        const newTransaction = buildExpenseTransaction(draft);
        set({ transactions: [newTransaction, ...state.transactions] });
        return { ok: true };
      }

      const studentIndex = state.students.findIndex(s => s.studentId === sid);
      if (studentIndex === -1) return { ok: false, message: '找不到這個帳戶。' };

      const { newTransaction } = buildOrderTransaction(state, draft, studentIndex);

      // M2 F03：補登前幾天的交易時，之後各筆的結餘也要一起重算。
      set(rebalanceAccounts(state.students, state.transactions, [newTransaction, ...state.transactions], [sid]));
      return { ok: true };
    },

    ...orderActions,
    ...paymentActions,
    ...editActions,
  };
}
