import type { PosState } from '../posTypes';
import { addStudent as repoAddStudent, disableStudent as repoDisableStudent } from '../../firebase/studentRepository';
import { ensureFirebaseInitialized } from '../../firebase/firebaseApp';

// Ref: #289 — Actions obtain Firestore internally instead of receiving it as a parameter.
// This removes the Firestore type leak from the store interface.
export function createFirebaseActions(): Pick<PosState, 'addStudent' | 'disableStudent'> {
  return {
    addStudent: async (input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => {
      const { db } = await ensureFirebaseInitialized();
      await repoAddStudent(db, input);
    },

    disableStudent: async (input: { studentId: string; operatorId: string }) => {
      const { db } = await ensureFirebaseInitialized();
      await repoDisableStudent(db, input);
    },
  };
}
