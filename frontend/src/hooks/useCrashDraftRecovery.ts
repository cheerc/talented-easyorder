import { useState, useEffect } from 'react';
import { loadCrashDraft, clearCrashDraft } from '../storage/crashDraft';
import { usePosStore } from '../store/posStore';
import type { PosMode, PosSelectionSource } from '../domain/posFlow';

interface UseCrashDraftRecoveryArgs {
  selectStudent: (studentId: string, source: PosSelectionSource) => void;
  setPaidAmountText: (text: string) => void;
  changeMode: (mode: PosMode) => void;
}

export function useCrashDraftRecovery({
  selectStudent,
  setPaidAmountText,
  changeMode,
}: UseCrashDraftRecoveryArgs) {
  const [crashDraftRestored, setCrashDraftRestored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const draft = await loadCrashDraft();
      if (cancelled || !draft) return;
      const students = usePosStore.getState().students;
      const student = students.find(s => s.studentId === draft.intent.studentId);
      if (!student) {
        clearCrashDraft();
        return;
      }
      selectStudent(draft.intent.studentId, 'manual');
      if (draft.intent.paidAmount > 0) {
        setPaidAmountText(String(draft.intent.paidAmount));
      }
      if (draft.intent.type !== 'order') {
        changeMode(draft.intent.type);
      }
      setCrashDraftRestored(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: crash draft recovery must run exactly once on app start; re-running on callback identity changes would re-select the student
  }, []);

  return crashDraftRestored;
}
