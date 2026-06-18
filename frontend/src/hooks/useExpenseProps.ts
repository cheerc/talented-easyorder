import { useMemo } from 'react';
import type { PosFlowState } from '../domain/posFlow';

// Ref: #281 — Extracted from App.tsx to reduce AppContent complexity.
// Derives expense props from the flow state for the expense flow UI.

export interface ExpenseProps {
  kind: 'expense_input' | 'expense_direction' | 'expense_reason' | 'expense_other_note';
  amountText: string;
  amount: number;
}

export function useExpenseProps(state: PosFlowState): ExpenseProps | null {
  const stateAmountText = state.kind === 'expense_input' ? state.amountText : undefined;
  const stateAmount = (state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note') ? state.amount : undefined;

  return useMemo(() => {
    if (state.kind === 'expense_input') return { kind: 'expense_input' as const, amountText: stateAmountText || '', amount: 0 };
    if (state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note')
      return { kind: state.kind, amountText: '', amount: stateAmount || 0 };
    return null;
  }, [state.kind, stateAmountText, stateAmount]);
}
