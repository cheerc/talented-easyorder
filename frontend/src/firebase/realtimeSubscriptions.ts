import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';

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
  const unsubscribers: Unsubscribe[] = [];

  unsubscribers.push(onSnapshot(
    query(collection(db, 'students'), orderBy('displayName')),
    { includeMetadataChanges: true },
    snapshot => handlers.onStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache),
    error => handlers.onError(error),
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'transactions'), where('businessDate', '==', businessDate), orderBy('createdAt', 'desc')),
    { includeMetadataChanges: true },
    snapshot => handlers.onTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache),
    error => handlers.onError(error),
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'daily_settlements'), where('businessDate', '==', businessDate)),
    { includeMetadataChanges: true },
    snapshot => handlers.onSettlements(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(snapshot), snapshot.metadata.fromCache),
    error => handlers.onError(error),
  ));

  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
