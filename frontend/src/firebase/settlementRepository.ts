import type { Firestore } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import { closeAttemptPath, settlementPath, cashAdjustmentPath } from './firestorePaths';

export function createCloseAttemptId(deviceId: string, businessDate: string, sequence: number): string {
  return `${deviceId}:close:${businessDate}:${sequence}`;
}

export function summarizeCloseAttemptConflict(attempts: Array<{ id: string; actualDrawer: number; difference: number }>) {
  const signatures = new Set(attempts.map(a => `${a.actualDrawer}:${a.difference}`));
  return { conflict: signatures.size > 1, attemptIds: attempts.map(a => a.id) };
}

export async function writeOfflineCloseAttempt(db: Firestore, input: {
  id: string;
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedDrawer: number;
  actualDrawer: number;
  difference: number;
  transactionIds: string[];
  cashAdjustmentIds: string[];
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
  note: string;
}) {
  const { doc, setDoc, serverTimestamp } = getFirestoreMod();
  await setDoc(doc(db, closeAttemptPath(input.businessDate, input.id)), {
    ...input,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function promoteCloseAttemptOnline(db: Firestore, input: {
  businessDate: string;
  closeAttemptId: string;
  summary: Record<string, unknown>;
}) {
  const { doc, runTransaction } = getFirestoreMod();
  const summaryRef = doc(db, settlementPath(input.businessDate));
  const attemptRef = doc(db, closeAttemptPath(input.businessDate, input.closeAttemptId));
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(summaryRef);
    if (existing.exists() && existing.data().status === 'closed') {
      throw new Error(`Business date already closed: ${input.businessDate}`);
    }
    transaction.set(summaryRef, input.summary);
    transaction.update(attemptRef, { status: 'accepted' });
  });
}

export async function addCashAdjustment(db: Firestore, input: {
  id: string;
  businessDate: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  reason: string;
  operatorId: string;
  operatorEmail: string;
  deviceId: string;
}) {
  const { doc, setDoc, serverTimestamp } = getFirestoreMod();
  await setDoc(doc(db, cashAdjustmentPath(input.businessDate, input.id)), {
    ...input,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}
