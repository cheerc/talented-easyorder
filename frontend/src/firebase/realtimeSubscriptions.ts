import type { Firestore, Query, Unsubscribe } from 'firebase/firestore';
import { getFirestoreMod } from './firebaseModules';
import { emitError } from '../errors/errorBus';

export interface RealtimeHandlers {
  onStudents: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onTransactions: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onSettlements: (docs: unknown[], pendingWrites: number, fromCache: boolean) => void;
  onError: (error: Error) => void;
}

function pendingCount(snapshot: { docs: Array<{ metadata: { hasPendingWrites: boolean } }> }): number {
  return snapshot.docs.filter(doc => doc.metadata.hasPendingWrites).length;
}

/**
 * Ref: #343 — Transient Firestore error codes that warrant a resubscribe attempt.
 * Permanent errors (e.g. PERMISSION_DENIED) should NOT trigger retry.
 */
const TRANSIENT_ERROR_CODES = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal']);

function isTransientError(error: Error & { code?: string }): boolean {
  return TRANSIENT_ERROR_CODES.has(error.code ?? '');
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 1000;

/**
 * Ref: #343 — Wraps onSnapshot with exponential backoff resubscribe on transient errors.
 * Permanent errors (PERMISSION_DENIED, NOT_FOUND, etc.) are reported but not retried.
 */
export function retryableOnSnapshot(
  queryRef: Query,
  options: { includeMetadataChanges: boolean },
  onNext: (snapshot: Record<string, unknown>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const { onSnapshot } = getFirestoreMod();
  let retryCount = 0;
  let currentUnsub: Unsubscribe | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function subscribe() {
    currentUnsub = onSnapshot(
      queryRef,
      options,
      snapshot => {
        retryCount = 0; // Reset on successful snapshot
        onNext(snapshot as Record<string, unknown>);
      },
      error => {
        currentUnsub = null;
        const typedError = error as Error & { code?: string };

        if (!disposed && isTransientError(typedError) && retryCount < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, retryCount);
          retryCount++;
          emitError({
            source: 'firebase',
            message: `[onSnapshot] transient error (${typedError.code}), retry ${retryCount}/${MAX_RETRIES} in ${delay}ms`,
          });
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (!disposed) subscribe();
          }, delay);
        } else {
          // Permanent error or max retries exceeded — report and stop
          onError(error);
          emitError({
            source: 'firebase',
            message: `onSnapshot error: ${error.message}` + (retryCount >= MAX_RETRIES ? ' (max retries exceeded)' : ''),
          });
        }
      },
    );
  }

  subscribe();

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    currentUnsub?.();
  };
}

export function subscribeBusinessDate(db: Firestore, businessDate: string, handlers: RealtimeHandlers): Unsubscribe {
  const { collection, orderBy, query, where } = getFirestoreMod();
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

  unsubscribers.push(retryableOnSnapshot(
    query(collection(db, 'students'), orderBy('displayName')),
    { includeMetadataChanges: true },
    snapshot => {
      const s = snapshot as { docs: Array<{ id: string; data: () => Record<string, unknown>; metadata: { hasPendingWrites: boolean } }>; metadata: { fromCache: boolean } };
      scheduleBatch(() => handlers.onStudents(s.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(s), s.metadata.fromCache));
    },
    error => handlers.onError(error),
  ));

  unsubscribers.push(retryableOnSnapshot(
    query(collection(db, 'transactions'), where('businessDate', '==', businessDate), orderBy('createdAt', 'desc')),
    { includeMetadataChanges: true },
    snapshot => {
      const s = snapshot as { docs: Array<{ id: string; data: () => Record<string, unknown>; metadata: { hasPendingWrites: boolean } }>; metadata: { fromCache: boolean } };
      scheduleBatch(() => handlers.onTransactions(s.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(s), s.metadata.fromCache));
    },
    error => handlers.onError(error),
  ));

  unsubscribers.push(retryableOnSnapshot(
    query(collection(db, 'daily_settlements'), where('businessDate', '==', businessDate)),
    { includeMetadataChanges: true },
    snapshot => {
      const s = snapshot as { docs: Array<{ id: string; data: () => Record<string, unknown>; metadata: { hasPendingWrites: boolean } }>; metadata: { fromCache: boolean } };
      scheduleBatch(() => handlers.onSettlements(s.docs.map(doc => ({ id: doc.id, ...doc.data() })), pendingCount(s), s.metadata.fromCache));
    },
    error => handlers.onError(error),
  ));

  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}
