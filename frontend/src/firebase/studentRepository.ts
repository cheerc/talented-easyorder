import type { Firestore } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';

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
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}

export async function disableStudent(db: Firestore, input: { studentId: string; operatorId: string }): Promise<void> {
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}
