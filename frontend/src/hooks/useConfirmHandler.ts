import { useCallback } from 'react';
import type { PosFlowState } from '../domain/posFlow';

// Ref: #281 — Extracted from App.tsx to reduce AppContent complexity.
// Encapsulates the confirm handler dispatching logic based on flow state.

export interface UseConfirmHandlerArgs {
  state: PosFlowState;
  requestConfirm: () => void;
  confirmDuplicate: () => void;
  confirmExpenseAmount: (n: number) => void;
}

export function useConfirmHandler({
  state,
  requestConfirm,
  confirmDuplicate,
  confirmExpenseAmount,
}: UseConfirmHandlerArgs): () => void {
  return useCallback(() => {
    if (state.kind === 'expense_input') {
      const n = Number(state.amountText);
      if (!Number.isSafeInteger(n) || n <= 0) return;
      confirmExpenseAmount(n); return;
    }
    if (state.kind === 'duplicate_warning') { confirmDuplicate(); return; }
    if (state.kind !== 'student_selected') return;
    requestConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, requestConfirm, confirmDuplicate, confirmExpenseAmount]);
}
