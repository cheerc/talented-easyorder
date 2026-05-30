import { useCallback } from 'react';
import type { PosFlowEvent, ExpenseDirection } from '../domain/posFlow';

export function useExpenseFlow(dispatch: (action: PosFlowEvent) => void) {
  const enterExpenseMode = useCallback(() => {
    dispatch({ type: 'enterExpenseMode' });
  }, [dispatch]);

  const updateExpenseAmount = useCallback((text: string) => {
    dispatch({ type: 'expenseUpdateAmount', text });
  }, [dispatch]);

  const confirmExpenseAmount = useCallback((amount: number) => {
    dispatch({ type: 'expenseConfirmAmount', amount });
  }, [dispatch]);

  const selectExpenseDirection = useCallback((direction: ExpenseDirection) => {
    dispatch({ type: 'expenseSelectDirection', direction });
  }, [dispatch]);

  const selectExpenseReason = useCallback((reason: '付便當錢' | '支出其他' | '收入其他') => {
    dispatch({ type: 'expenseSelectReason', reason });
  }, [dispatch]);

  const updateExpenseNote = useCallback((note: string) => {
    dispatch({ type: 'expenseUpdateNote', note });
  }, [dispatch]);

  const confirmExpenseNote = useCallback((note: string) => {
    dispatch({ type: 'expenseConfirmNote', note });
  }, [dispatch]);

  return {
    enterExpenseMode,
    updateExpenseAmount,
    confirmExpenseAmount,
    selectExpenseDirection,
    selectExpenseReason,
    updateExpenseNote,
    confirmExpenseNote,
  };
}
