import type { Firestore } from 'firebase/firestore';
import type { PosState } from '../posTypes';
import { addStudent as repoAddStudent, disableStudent as repoDisableStudent } from '../../firebase/studentRepository';

export function createFirebaseActions(
  _set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  _get: () => PosState,
): Pick<PosState, 'addStudent' | 'disableStudent'> {
  return {
    addStudent: async (db: Firestore, input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => {
      await repoAddStudent(db, input);
    },

    disableStudent: async (db: Firestore, input: { studentId: string; operatorId: string }) => {
      await repoDisableStudent(db, input);
    },
  };
}
