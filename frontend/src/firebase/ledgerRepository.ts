import type { Firestore } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import { studentPath, transactionPath } from './firestorePaths';
import { buildTransactionDoc, type TransactionDocInput } from './firestoreSchema';

export function createTransactionId(deviceId: string, sequence: number): string {
  return `${deviceId}:tx:${sequence}`;
}

export function shouldUseOfflineCommitPath(input: { online: boolean; forceOffline: boolean }): boolean {
  return input.forceOffline || !input.online;
}

export interface CommitLedgerInput extends TransactionDocInput {
  expectedStudentRevision: number;
}

export async function commitLedgerOnline(db: Firestore, input: CommitLedgerInput): Promise<'accepted' | 'duplicate'> {
  const { doc, increment, runTransaction, serverTimestamp } = getFirestoreMod();
  const txRef = doc(db, transactionPath(input.id));
  const studentRef = doc(db, studentPath(input.studentId));

  return runTransaction(db, async transaction => {
    const existing = await transaction.get(txRef);
    if (existing.exists()) return 'duplicate';

    const student = await transaction.get(studentRef);
    if (!student.exists()) throw new Error(`Unknown student: ${input.studentId}`);

    const studentData = student.data() as { currentBalance: number; revision: number; displayName: string };
    if (studentData.revision !== input.expectedStudentRevision) {
      throw new Error(`Student revision conflict: expected ${input.expectedStudentRevision}, actual ${studentData.revision}`);
    }

    const balanceBefore = studentData.currentBalance;
    const balanceAfter = balanceBefore + input.amount;
    transaction.set(txRef, buildTransactionDoc({
      ...input,
      balanceBefore,
      balanceAfter,
      clientBalanceAfterPreview: balanceAfter,
      status: 'synced',
    }));
    transaction.update(studentRef, {
      currentBalance: balanceAfter,
      revision: increment(1),
      updatedAt: serverTimestamp(),
      updatedBy: input.operatorId,
      lastTransactionId: input.id,
    });
    return 'accepted';
  });
}

export async function commitLedgerOfflineBatch(db: Firestore, input: CommitLedgerInput): Promise<'queued'> {
  const { doc, getDoc, increment, serverTimestamp, writeBatch } = getFirestoreMod();
  const txRef = doc(db, transactionPath(input.id));
  const studentRef = doc(db, studentPath(input.studentId));
  const existing = await getDoc(txRef);
  if (existing.exists()) return 'queued';

  const batch = writeBatch(db);
  batch.set(txRef, buildTransactionDoc({
    ...input,
    balanceBefore: null,
    balanceAfter: null,
    status: 'pending',
  }));
  batch.update(studentRef, {
    currentBalance: increment(input.amount),
    revision: increment(1),
    updatedAt: serverTimestamp(),
    updatedBy: input.operatorId,
    lastTransactionId: input.id,
  });
  await batch.commit();
  return 'queued';
}
