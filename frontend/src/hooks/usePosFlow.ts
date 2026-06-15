import { useCallback, useEffect, useReducer } from 'react';
import {
  createInitialPosFlowState,
  reducePosFlow,
} from '../domain/posFlow';
import type { PosFlowState, PosMode, PosSelectionSource, ExpenseDirection } from '../domain/posFlow';
import type { ScannerInput } from '../domain/posSearch';
import { countActiveOrdersForStudent } from '../domain/ledger';
import { useStudents, useTransactions, useMenu, useTransactionActions } from '../store/selectors';
import { useExpenseFlow } from './useExpenseFlow';
import { useScannerInput } from './useScannerInput';
import { useIpadHandoff } from './useIpadHandoff';
import { useTransactionCommit } from './useTransactionCommit';

export interface UsePosFlowArgs {
  businessDate: string;
  isHistorical: boolean;
  priceOverride: number | null;
  priceOverrideLabel: string;
}

export interface UsePosFlowReturn {
  state: PosFlowState;
  setSearchText: (text: string) => void;
  selectStudent: (studentId: string, source: PosSelectionSource) => void;
  changeMode: (mode: PosMode) => void;
  setPaidAmountText: (text: string) => void;
  enterExpenseMode: () => void;
  updateExpenseAmount: (text: string) => void;
  confirmExpenseAmount: (amount: number) => void;
  selectExpenseDirection: (direction: ExpenseDirection) => void;
  selectExpenseReason: (reason: '付便當錢' | '支出其他' | '收入其他') => void;
  updateExpenseNote: (note: string) => void;
  confirmExpenseNote: (note: string) => void;
  receiveScannerInput: (input: ScannerInput) => void;
  receiveIpadHandoff: (channel: string) => { ok: boolean; studentId?: string };
  requestConfirm: () => void;
  confirmDuplicate: () => void;
  cancelFlow: () => void;
  dismissSuccess: () => void;
  commitTransaction: () => void;
}

export function usePosFlow(args: UsePosFlowArgs): UsePosFlowReturn {
  const [state, dispatch] = useReducer(
    reducePosFlow,
    createInitialPosFlowState(args.isHistorical, args.businessDate),
  );

  const { students } = useStudents();
  const { todayMenu } = useMenu();
  const { transactions } = useTransactions();
  const { commitPosTransactionDraft } = useTransactionActions();

  const setSearchText = useCallback((text: string) => {
    dispatch({ type: 'updateSearchText', text });
  }, []);

  const hintSearchText = state.kind === 'idle' ? state.searchText : '';
  const selectStudent = useCallback((studentId: string, source: PosSelectionSource) => {
    const searchTextHint = hintSearchText;
    const hasOrderToday = countActiveOrdersForStudent(transactions, studentId, args.businessDate) > 0;
    dispatch({ type: 'selectStudent', studentId, source, searchTextHint, hasOrderToday });
  }, [hintSearchText, transactions, args.businessDate]);

  const changeMode = useCallback((mode: PosMode) => {
    dispatch({ type: 'changeMode', mode });
  }, []);

  const setPaidAmountText = useCallback((text: string) => {
    dispatch({ type: 'updatePaidAmount', text });
  }, []);

  const expenseFlow = useExpenseFlow(dispatch);
  const { enterExpenseMode, updateExpenseAmount, confirmExpenseAmount, selectExpenseDirection, selectExpenseReason, updateExpenseNote, confirmExpenseNote } = expenseFlow;

  const { receiveScannerInput } = useScannerInput(dispatch, students);

  const { receiveIpadHandoff } = useIpadHandoff(dispatch, students);

  const transactionCommit = useTransactionCommit(dispatch, state, students, todayMenu, transactions, commitPosTransactionDraft, {
    businessDate: args.businessDate,
    priceOverride: args.priceOverride,
    priceOverrideLabel: args.priceOverrideLabel,
  });
  const { requestConfirm, confirmDuplicate, commitTransaction } = transactionCommit;

  // Auto-trigger commitTransaction when state transitions to committing
  useEffect(() => {
    if (state.kind !== 'committing') return;
    commitTransaction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  const cancelFlow = useCallback(() => {
    dispatch({ type: 'cancel' });
  }, []);

  const dismissSuccess = useCallback(() => {
    dispatch({ type: 'dismissSuccess' });
  }, []);

  return {
    state,
    setSearchText,
    selectStudent,
    changeMode,
    setPaidAmountText,
    enterExpenseMode,
    updateExpenseAmount,
    confirmExpenseAmount,
    selectExpenseDirection,
    selectExpenseReason,
    updateExpenseNote,
    confirmExpenseNote,
    receiveScannerInput,
    receiveIpadHandoff,
    requestConfirm,
    confirmDuplicate,
    cancelFlow,
    dismissSuccess,
    commitTransaction,
  };
}
