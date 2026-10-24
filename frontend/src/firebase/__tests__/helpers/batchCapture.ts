import type { DocumentData, Firestore, Transaction } from 'firebase/firestore';

/**
 * P16b capture and replay (plan R4). A production writer builds its whole batch inside `runTransaction`; this module
 * lets a test run the real writer, take the set / update list it was about to commit, abort that transaction without
 * committing, and send the very same list through a raw `writeBatch` under any identity, with any one thing changed.
 * Nothing here knows what a command is: it only records what the production code asked Firestore to write.
 */

export interface CapturedWrite {
  kind: 'set' | 'update' | 'delete';
  path: string;
  /** The data object passed to set or update; absent for delete. */
  data?: DocumentData;
  /** The third argument of `tx.set` (merge options), passed through unchanged. */
  options?: unknown;
}

class CaptureAbort extends Error {
  constructor() { super('P16b capture: the transaction was aborted on purpose, nothing was committed'); this.name = 'CaptureAbort'; }
}

let armed = false;
let transactionCalls = 0;
let lastCapture: CapturedWrite[] | null = null;

type RunTransaction = (db: Firestore, update: (tx: Transaction) => Promise<unknown>, options?: unknown) => Promise<unknown>;

/** Wraps the real `firebase/firestore` module so that `runTransaction` can be captured while armed; otherwise it is the real one. */
export function wrapFirestoreModule<T extends { runTransaction: unknown }>(actual: T): T {
  const real = actual.runTransaction as RunTransaction;
  const wrapped: RunTransaction = (db, update, options) => {
    if (!armed) return real(db, update, options);
    transactionCalls += 1;
    return real(db, async tx => {
      const writes: CapturedWrite[] = [];
      const recording = {
        get: (ref: unknown) => (tx as unknown as { get(ref: unknown): unknown }).get(ref),
        set: (ref: { path: string }, data: DocumentData, setOptions?: unknown) => {
          writes.push({ kind: 'set', path: ref.path, data, ...(setOptions === undefined ? {} : { options: setOptions }) });
          return recording;
        },
        update: (ref: { path: string }, ...rest: unknown[]) => {
          if (rest.length !== 1) throw new Error('P16b capture only understands tx.update(ref, dataObject)');
          writes.push({ kind: 'update', path: ref.path, data: rest[0] as DocumentData });
          return recording;
        },
        delete: (ref: { path: string }) => {
          writes.push({ kind: 'delete', path: ref.path });
          return recording;
        },
      };
      await update(recording as unknown as Transaction);
      lastCapture = writes;
      // Reached only when the writer decided to commit: roll back instead.
      throw new CaptureAbort();
    }, options);
  };
  return { ...actual, runTransaction: wrapped } as T;
}

/**
 * Runs `run` (a production writer call) with capture armed and returns the batch its single transaction would have
 * committed. The writer's own result is ignored: it reports an unknown result because the transaction never commits.
 */
export async function captureBatch(run: () => Promise<unknown>): Promise<CapturedWrite[]> {
  armed = true;
  transactionCalls = 0;
  lastCapture = null;
  try {
    await run();
  } finally {
    armed = false;
  }
  if (transactionCalls !== 1) throw new Error(`P16b capture: expected exactly one transaction, the writer ran ${transactionCalls}`);
  if (!lastCapture) throw new Error('P16b capture: the writer rejected the command before it reached its writes');
  return lastCapture;
}

/** The minimal slice of the modular SDK that replay needs; the spec passes the real functions. */
export interface BatchSdk {
  doc(db: Firestore, path: string): unknown;
  writeBatch(db: Firestore): {
    set(ref: unknown, data: DocumentData, options?: unknown): unknown;
    update(ref: unknown, data: DocumentData): unknown;
    delete(ref: unknown): unknown;
    commit(): Promise<void>;
  };
}

/** Sends a list of writes as one atomic batch from `db`. Resolves when the server accepts it, rejects when it refuses. */
export function replayBatch(sdk: BatchSdk, db: Firestore, writes: CapturedWrite[]): Promise<void> {
  const batch = sdk.writeBatch(db);
  for (const write of writes) {
    const ref = sdk.doc(db, write.path);
    if (write.kind === 'set') batch.set(ref, write.data!, write.options);
    else if (write.kind === 'update') batch.update(ref, write.data!);
    else batch.delete(ref);
  }
  return batch.commit();
}
