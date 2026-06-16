import type { PosState } from '../posTypes';
import { addStudent as repoAddStudent, disableStudent as repoDisableStudent } from '../../firebase/studentRepository';
import { ensureFirebaseInitialized } from '../../firebase/firebaseApp';
import { appendErrorLog } from '../../errors/errorLogger';

// Ref: #289 — Actions obtain Firestore internally instead of receiving it as a parameter.
// This removes the Firestore type leak from the store interface.
export function createFirebaseActions(): Pick<PosState, 'addStudent' | 'disableStudent'> {
  return {
    addStudent: async (input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => {
      try {
        const { db } = await ensureFirebaseInitialized();
        await repoAddStudent(db, input);
      } catch (error) {
        // Ref: #326 — Catch and log Firebase write failures
        appendErrorLog({ source: 'firebase', message: `[addStudent] failed: ${error instanceof Error ? error.message : String(error)}` });
        throw error; // Re-throw so caller can handle UI feedback
      }
    },

    disableStudent: async (input: { studentId: string; operatorId: string }) => {
      try {
        const { db } = await ensureFirebaseInitialized();
        await repoDisableStudent(db, input);
      } catch (error) {
        // Ref: #326 — Catch and log Firebase write failures
        appendErrorLog({ source: 'firebase', message: `[disableStudent] failed: ${error instanceof Error ? error.message : String(error)}` });
        throw error;
      }
    },
  };
}
