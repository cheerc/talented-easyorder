import type { Firestore } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import { studentPath } from './firestorePaths';

export function buildStudentDoc(input: {
  studentId: string;
  displayName: string;
  openingBalance: number;
  operatorId: string;
}) {
  const { serverTimestamp } = getFirestoreMod();
  return {
    id: input.studentId,
    displayName: input.displayName,
    aliases: [],
    className: null,
    groupName: null,
    openingBalance: input.openingBalance,
    currentBalance: input.openingBalance,
    status: 'active' as const,
    createdAt: serverTimestamp(),
    createdBy: input.operatorId,
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
    revision: 1,
    lastTransactionId: null,
  };
}

export async function addStudent(db: Firestore, input: Parameters<typeof buildStudentDoc>[0]): Promise<void> {
  const { doc, setDoc } = getFirestoreMod();
  await setDoc(doc(db, studentPath(input.studentId)), buildStudentDoc(input));
}

export async function disableStudent(db: Firestore, input: { studentId: string; operatorId: string }): Promise<void> {
  const { doc, updateDoc, serverTimestamp } = getFirestoreMod();
  await updateDoc(doc(db, studentPath(input.studentId)), {
    status: 'inactive',
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
  });
}
