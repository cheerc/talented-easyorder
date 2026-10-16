import type { PosState } from '../posTypes';
import type { PosTransactionDraft } from '../../domain/posTransaction';
import { buildExpenseTransaction } from './expenseActions';
import { buildOrderTransaction } from './orderActions';
import { createOrderActions } from './orderActions';
import { createPaymentActions } from './paymentActions';
import { createEditActions } from './editActions';
import { rebalanceAccounts } from '../../domain/ledger';
import { checkNewLedgerEntry, type LedgerCommitResult } from '../../domain/ledgerAudit';
import { resolveCurrentBusinessDate } from '../currentBusinessDate';

export function createTransactionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
): Pick<PosState, 'commitPosTransactionDraft' | 'processTransaction' | 'deleteTransaction' | 'deleteOrderWithRefundCheck' | 'editTransaction'> {
  const orderActions = createOrderActions(set);
  const paymentActions = createPaymentActions(set);
  const editActions = createEditActions(set, get);

  return {
    commitPosTransactionDraft: (draft: PosTransactionDraft): LedgerCommitResult => {
      const state = get();
      // M2：關帳日在 store 層就擋下，畫面鎖之外再多一道。
      const check = checkNewLedgerEntry(state.businessDateStatuses[draft.intent.businessDate]);
      if (!check.ok) return check;

      const isExpense = draft.intent.type === 'expense';
      const sid = draft.intent.studentId;

      if (isExpense) {
        const newTransaction = buildExpenseTransaction(draft);
        set({ transactions: [newTransaction, ...state.transactions] });
        return { ok: true, transactionId: newTransaction.transactionId };
      }

      const studentIndex = state.students.findIndex(s => s.studentId === sid);
      if (studentIndex === -1) return { ok: false, message: '找不到這個帳戶。' };

      if (draft.intent.type === 'refund') {
        // U4 #9：退款只能記在目前營業日。來源與 useSystemDate 相同（模擬營業日或台北當天），
        // 不用 viewDate 或菜單快照日期，否則還原舊資料時會誤擋／誤准。
        const activeDate = resolveCurrentBusinessDate(state.simulationDate);
        if (draft.intent.businessDate !== activeDate) {
          return { ok: false, message: '退款只能記在當前營業日。' };
        }
        const student = state.students[studentIndex];
        const refundAmount = draft.amount;
        if (!Number.isInteger(refundAmount) || refundAmount < 1) {
          return { ok: false, message: '退款金額必須是大於 0 的整數。' };
        }
        if (refundAmount > student.currentBalance) {
          return { ok: false, message: '退款金額不能超過目前餘額。' };
        }
        if (!draft.intent.note || draft.intent.note.trim().length === 0) {
          return { ok: false, message: '退款原因必填。' };
        }
      }

      const { newTransaction } = buildOrderTransaction(state, draft, studentIndex);

      // M2 F03：補登前幾天的交易時，之後各筆的結餘也要一起重算。
      set(rebalanceAccounts(state.students, state.transactions, [newTransaction, ...state.transactions], [sid]));
      return { ok: true, transactionId: newTransaction.transactionId };
    },

    ...orderActions,
    ...paymentActions,
    ...editActions,
  };
}
