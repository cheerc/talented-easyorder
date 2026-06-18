import { useMemo } from 'react';
import type { PosFlowState, PosMode } from '../domain/posFlow';
import type { StudentAccount } from '../domain/student';

// Ref: #281 — Extracted from App.tsx to reduce AppContent complexity.
// Derives pinned student state from the flow state for UI stability
// across committing/success transitions.

export interface UsePinnedStudentResult {
  picked: StudentAccount | null;
  currentMode: PosMode;
  currentPaidAmount: string;
  pinnedStudentId: string | null;
}

export function usePinnedStudent(
  state: PosFlowState,
  students: StudentAccount[],
): UsePinnedStudentResult {
  const { pinnedStudentId, pinnedMode, pinnedPaidAmount } = useMemo(() => {
    if (state.kind === 'student_selected' || state.kind === 'duplicate_warning') {
      return {
        pinnedStudentId: state.studentId,
        pinnedMode: (state.kind === 'student_selected' ? state.mode : 'order') as PosMode,
        pinnedPaidAmount: state.paidAmountText,
      };
    }
    if (state.kind === 'committing' || state.kind === 'success') {
      return {
        pinnedStudentId: state.studentId ?? null,
        pinnedMode: state.mode,
        pinnedPaidAmount: state.paidAmountText,
      };
    }
    if (state.kind === 'error') {
      return {
        pinnedStudentId: state.studentId ?? null,
        pinnedMode: state.mode ?? 'order' as PosMode,
        pinnedPaidAmount: state.paidAmountText ?? '',
      };
    }
    return { pinnedStudentId: null, pinnedMode: 'order' as PosMode, pinnedPaidAmount: '' };
  }, [state]);

  const picked = useMemo(() => {
    if (!pinnedStudentId) return null;
    return students.find(s => s.studentId === pinnedStudentId) ?? null;
  }, [students, pinnedStudentId]);

  const currentMode: PosMode = (state.kind === 'student_selected' || state.kind === 'committing')
    ? state.mode : (state.kind === 'expense_input' || state.kind === 'expense_direction' || state.kind === 'expense_reason' || state.kind === 'expense_other_note')
      ? 'expense' : pinnedMode;

  const currentPaidAmount = state.kind === 'student_selected' || state.kind === 'duplicate_warning' || state.kind === 'committing'
    ? state.paidAmountText : pinnedPaidAmount;

  return { picked, currentMode, currentPaidAmount, pinnedStudentId };
}
