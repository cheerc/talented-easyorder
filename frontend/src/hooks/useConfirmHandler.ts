import { useCallback, useRef, useEffect } from 'react';
import type { PosFlowState } from '../domain/posFlow';

// Ref: #281 — Extracted from App.tsx to reduce AppContent complexity.
// Ref: #293 — Stabilize callback reference via useRef pattern to avoid
// defeating React.memo on child components that receive handleConfirm.

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
  const stateRef = useRef(state);
  const requestConfirmRef = useRef(requestConfirm);
  const confirmDuplicateRef = useRef(confirmDuplicate);
  const confirmExpenseAmountRef = useRef(confirmExpenseAmount);

  useEffect(() => { stateRef.current = state; });
  useEffect(() => { requestConfirmRef.current = requestConfirm; });
  useEffect(() => { confirmDuplicateRef.current = confirmDuplicate; });
  useEffect(() => { confirmExpenseAmountRef.current = confirmExpenseAmount; });

  return useCallback(() => {
    const s = stateRef.current;
    if (s.kind === 'expense_input') {
      const n = Number(s.amountText);
      if (!Number.isSafeInteger(n) || n <= 0) return;
      confirmExpenseAmountRef.current(n); return;
    }
    if (s.kind === 'duplicate_warning') { confirmDuplicateRef.current(); return; }
    if (s.kind !== 'student_selected') return;
    requestConfirmRef.current();
  }, []);
}
