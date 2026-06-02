import type { Firestore, Unsubscribe } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import { appendErrorLog } from '../errors/errorLogger';

export interface RealtimeHandlers {
  onStudents: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onTransactions: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onSettlements: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onError: (error: Error) => void;
}

function pendingCount(snapshot: { docs: Array<{ metadata: { hasPendingWrites: boolean } }> }): number {
  return snapshot.docs.filter(doc => doc.metadata.hasPendingWrites).length;
}

export function subscribeBusinessDate(db: Firestore, businessDate: string, handlers: RealtimeHandlers): Unsubscribe {
  const { collection, onSnapshot, orderBy, query, where } = getFirestoreMod();
  const unsubscribers: Unsubscribe[] = [];

  let batchPending = false;
  const pending: Array<() => void> = [];

  function scheduleBatch(fn: () => void) {
    pending.push(fn);
    if (!batchPending) {
      batchPending = true;
      queueMicrotask(() => {
        batchPending = false;
        const calls = pending.splice(0);
        for (const call of calls) call();
      });
    }
  }

  unsubscribers.push(onSnapshot(
    query(collection(db, 'students'), orderBy('displayName')),
    { includeMetadataChanges: true },
    snapshot => scheduleBatch(() => handlers.onStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache)),
    error => { handlers.onError(error); appendErrorLog({ source: 'firebase', message: 'onSnapshot error: ' + error.message }); },
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'transactions'), where('businessDate', '==', businessDate), orderBy('createdAt', 'desc')),
    { includeMetadataChanges: true },
    snapshot => scheduleBatch(() => handlers.onTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache)),
    error => { handlers.onError(error); appendErrorLog({ source: 'firebase', message: 'onSnapshot error: ' + error.message }); },
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'daily_settlements'), where('businessDate', '==', businessDate)),
    { includeMetadataChanges: true },
    snapshot => scheduleBatch(() => handlers.onSettlements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache)),
    error => { handlers.onError(error); appendErrorLog({ source: 'firebase', message: 'onSnapshot error: ' + error.message }); },
  ));

  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
