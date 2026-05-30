import { useCallback } from 'react';
import type { PosFlowEvent } from '../domain/posFlow';
import {
  validateIpadHandoffMessage,
  readHandoffIntent,
  toHandoffScannerInput,
} from '../domain/ipadHandoff';
import { resolveScannedStudent } from '../domain/posSearch';
import type { Student } from '../domain/student';

export function useIpadHandoff(
  dispatch: (action: PosFlowEvent) => void,
  students: Student[],
) {
  const receiveIpadHandoff = useCallback((channel: string) => {
    const msg = readHandoffIntent(channel);
    if (!msg) return { ok: false };
    const validation = validateIpadHandoffMessage(msg);
    if (!validation.ok) return { ok: false };
    const scannerInput = toHandoffScannerInput(msg);
    const result = resolveScannedStudent(students, scannerInput);
    if (result.ok && result.students.length === 1) {
      dispatch({
        type: 'selectStudent',
        studentId: result.students[0].studentId,
        source: 'ipad',
      });
      return { ok: true, studentId: result.students[0].studentId };
    }
    return { ok: false };
  }, [dispatch, students]);

  return { receiveIpadHandoff };
}
