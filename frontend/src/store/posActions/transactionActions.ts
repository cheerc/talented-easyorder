import type { PosState } from '../posTypes';
import type { PosTransactionDraft } from '../../domain/posTransaction';
import { buildExpenseTransaction } from './expenseActions';
import { buildOrderTransaction } from './orderActions';
import { createOrderActions } from './orderActions';
import { createPaymentActions } from './paymentActions';
import { createEditActions } from './editActions';

export function createTransactionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
): Pick<PosState, 'commitPosTransactionDraft' | 'processTransaction' | 'updateTransaction' | 'deleteTransaction' | 'deleteOrderWithRefundCheck' | 'editTransaction'> {
  const orderActions = createOrderActions(set, get);
  const paymentActions = createPaymentActions(set, get);
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

        const { newStudents, newTransaction } = buildOrderTransaction(state, draft, studentIndex);

        return {
          students: newStudents,
          transactions: [newTransaction, ...state.transactions],
        };
      });
    },

    ...orderActions,
    ...paymentActions,
    ...editActions,
  };
}
