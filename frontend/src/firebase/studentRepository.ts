import { doc, serverTimestamp, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { studentPath } from './firestorePaths';

export function buildStudentDoc(input: {
  studentId: string;
  displayName: string;
  openingBalance: number;
  operatorId: string;
}) {
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
  await setDoc(doc(db, studentPath(input.studentId)), buildStudentDoc(input));
}

export async function disableStudent(db: Firestore, input: { studentId: string; operatorId: string }): Promise<void> {
  await updateDoc(doc(db, studentPath(input.studentId)), {
    status: 'inactive',
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
  });
}
