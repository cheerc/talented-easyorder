import type { Firestore } from 'firebase/firestore';
import type { TransactionDocInput } from './firestoreSchema';

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
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}

export async function commitLedgerOfflineBatch(db: Firestore, input: CommitLedgerInput): Promise<'queued'> {
  void db;
  void input;
  throw new Error('業務功能暫未開放');
}
