import type { PosState } from '../posTypes';
import type { PosTransactionDraft } from '../../domain/posTransaction';
import { buildExpenseTransaction } from './expenseActions';
import { buildOrderTransaction } from './orderActions';
import { createOrderActions } from './orderActions';
import { createPaymentActions } from './paymentActions';
import { createEditActions } from './editActions';
import { rebalanceAccounts } from '../../domain/ledger';

export function createTransactionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
): Pick<PosState, 'commitPosTransactionDraft' | 'processTransaction' | 'updateTransaction' | 'deleteTransaction' | 'deleteOrderWithRefundCheck' | 'editTransaction'> {
  const orderActions = createOrderActions(set);
  const paymentActions = createPaymentActions(set);
  const editActions = createEditActions(set, get);

  return {
    commitPosTransactionDraft: (draft: PosTransactionDraft) => {
      set((state) => {
        const isExpense = draft.intent.type === 'expense';
        const sid = draft.intent.studentId;

        if (isExpense) {
          const newTransaction = buildExpenseTransaction(draft);
          return { transactions: [newTransaction, ...state.transactions] };
        }

        const studentIndex = state.students.findIndex(s => s.studentId === sid);
        if (studentIndex === -1) return state;

        const { newTransaction } = buildOrderTransaction(state, draft, studentIndex);

        // M2 F03：補登前幾天的交易時，之後各筆的結餘也要一起重算。
        return rebalanceAccounts(state.students, state.transactions, [newTransaction, ...state.transactions], [sid]);
      });
    },

    ...orderActions,
    ...paymentActions,
    ...editActions,
  };
}
