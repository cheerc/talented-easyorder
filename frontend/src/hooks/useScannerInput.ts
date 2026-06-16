/**
 * Ref: #318 — L3 hook in composition chain (see usePosFlow.ts for diagram).
 * Encapsulates barcode scanner input handling: converts raw scanner events
 * into PosFlowEvent dispatches for student lookup.
 */
import { useCallback } from 'react';
import type { PosFlowEvent } from '../domain/posFlow';
import type { ScannerInput } from '../domain/posSearch';
import { resolveScannedStudent } from '../domain/posSearch';
import type { Student } from '../domain/student';

export function useScannerInput(
  dispatch: (action: PosFlowEvent) => void,
  students: Student[],
) {
  const receiveScannerInput = useCallback((input: ScannerInput) => {
    const result = resolveScannedStudent(students, input);
    if (result.ok && result.students.length === 1) {
      dispatch({ type: 'selectStudent', studentId: result.students[0].studentId, source: 'scan' });
    }
  }, [dispatch, students]);

  return { receiveScannerInput };
}
