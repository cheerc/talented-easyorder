import type { DocumentData, Transaction } from 'firebase/firestore';

/**
 * P16d read / write meter (plan R8). It wraps the real Firestore modules (`firebase/firestore` and `firebase/firestore/lite`)
 * at the SDK boundary, so the production repositories run unchanged and every document they ask Firestore for is counted.
 *
 * Metering rules (the same text is in `docs/ops/free-production-evidence.md`):
 * - `getDoc*` is 1 read, also when the document does not exist; a query (`getDocs*`) is max(1, documents returned).
 * - every `tx.get` is 1 read; a transaction that is retried counts the `tx.get` calls of every attempt.
 * - `onSnapshot` on a document is 1 read when it attaches (the server sends the document even when the SDK already had it
 *   cached, so a first snapshot that is flagged `fromCache` still counts) and 1 per later server snapshot with new data; a
 *   repeated snapshot with the same data, such as a metadata-only change, is not counted again.
 * - only writes of a transaction that committed count (the writes of the last attempt); an aborted or refused transaction
 *   still counts the reads it did, and no write.
 * - Rules access calls are not measured here (the Emulator has no counter): `capacityModel` adds them from the p05 ledger.
 *
 * Besides counts, every read records its shape: normalized collection path, where / orderBy fields with the operator, the limit
 * and whether a cursor was used, so a test can show that a query is bounded and which index it needs.
 */

export interface QueryShape {
  /** Collection path with ids replaced by `*` (`days/*\/settlements`). */
  collection: string;
  where: string[];
  orderBy: string[];
  limit: number | null;
  cursor: boolean;
}

export type ReadForm = 'doc' | 'tx-doc' | 'query' | 'listener-doc';

export interface ReadEvent {
  form: ReadForm;
  /** Normalized key: `students/*`, `system/dataHead`, or the collection of a query. */
  key: string;
  /** Documents returned (a query) or 1. */
  documents: number;
  /** What Firestore bills for this read. */
  billed: number;
  shape?: QueryShape;
}

export interface WriteEvent { kind: 'set' | 'update' | 'delete'; key: string; path: string; data?: DocumentData }

export interface MeterReport {
  reads: ReadEvent[];
  writes: WriteEvent[];
  billedReads: number;
  billedWrites: number;
  billedDeletes: number;
}

const SINGLETONS = new Set(['system/dataHead', 'system/accessLease']);

/** `students/abc` → `students/*`, `days/2026-10-24/settlements/1` → `days/*\/settlements/*`; the two `system` documents keep their names. */
export function normalizePath(path: string): string {
  if (SINGLETONS.has(path)) return path;
  return path.split('/').map((segment, index) => (index % 2 === 1 ? '*' : segment)).join('/');
}

let recording: { reads: ReadEvent[]; writes: WriteEvent[]; only: object | undefined } | null = null;

export const meter = {
  /**
   * Starts recording; anything read or written before this call is not counted. With `only`, just the calls on that Firestore
   * instance are counted, so that a test's own reads through another instance (an administrator's, say) do not count.
   */
  start(only?: object): void {
    recording = { reads: [], writes: [], only };
  },
  /** Stops recording and returns what happened since `start`. */
  stop(): MeterReport {
    if (!recording) throw new Error('meter.stop() without meter.start()');
    const done = recording;
    recording = null;
    return {
      reads: done.reads,
      writes: done.writes,
      billedReads: done.reads.reduce((sum, event) => sum + event.billed, 0),
      billedWrites: done.writes.filter(write => write.kind !== 'delete').length,
      billedDeletes: done.writes.filter(write => write.kind === 'delete').length,
    };
  },
  /** Runs `run` under a fresh recording and returns its result with the report; the recording ends even when `run` throws. */
  async measure<T>(run: () => Promise<T>, only?: object): Promise<{ result: T; report: MeterReport }> {
    meter.start(only);
    let result: T;
    try {
      result = await run();
    } catch (error) {
      meter.stop();
      throw error;
    }
    return { result, report: meter.stop() };
  },
};

/** The compat Firestore of rules-unit-testing wraps the modular instance that the references point at (`_delegate`). */
function canonical(owner: unknown): unknown {
  return (owner as { _delegate?: unknown } | null)?._delegate ?? owner;
}

/** True while recording and the call belongs to the Firestore instance that is being counted. */
function counting(owner: unknown): boolean {
  if (!recording) return false;
  return recording.only === undefined || canonical(recording.only) === canonical(owner);
}

function noteRead(owner: unknown, event: ReadEvent): void {
  if (counting(owner)) recording!.reads.push(event);
}

const ownerOf = (reference: unknown): unknown => (reference as { firestore?: unknown } | null)?.firestore;

// ---- query shapes ------------------------------------------------------------------------------------------------------

type Described = { kind: 'where'; text: string } | { kind: 'orderBy'; text: string } | { kind: 'limit'; value: number }
  | { kind: 'cursor' };
const described = new WeakMap<object, Described>();
const shapes = new WeakMap<object, QueryShape>();

function fieldName(field: unknown): string {
  if (typeof field === 'string') return field;
  const internal = (field as { _internalPath?: { canonicalString?: () => string } } | null)?._internalPath;
  const text = internal?.canonicalString?.();
  return text ?? '__name__';
}

type AnyFn = (...args: unknown[]) => unknown;

function tag<T extends object>(value: T, description: Described): T {
  described.set(value, description);
  return value;
}

/** Wraps the constraint factories and `query` / `collection` / `collectionGroup` of a Firestore module so that shapes can be read back. */
function wrapQueryBuilders<T extends Record<string, unknown>>(actual: T): Record<string, unknown> {
  const fn = (name: string): AnyFn | undefined => actual[name] as AnyFn | undefined;
  const wrapped: Record<string, unknown> = {};
  const wrap = (name: string, make: (original: AnyFn) => AnyFn) => {
    const original = fn(name);
    if (original) wrapped[name] = make(original);
  };
  wrap('where', original => (field, op, value) => {
    const constraint = original(field, op, value) as object;
    const suffix = op === 'in' || op === 'array-contains-any' || op === 'not-in' ? `[${(value as unknown[]).length}]` : '';
    return tag(constraint, { kind: 'where', text: `${fieldName(field)} ${String(op)}${suffix}` });
  });
  wrap('orderBy', original => (field, direction) => tag(original(field, direction) as object,
    { kind: 'orderBy', text: `${fieldName(field)} ${direction === 'desc' ? 'desc' : 'asc'}` }));
  wrap('limit', original => count => tag(original(count) as object, { kind: 'limit', value: count as number }));
  wrap('limitToLast', original => count => tag(original(count) as object, { kind: 'limit', value: count as number }));
  for (const name of ['startAfter', 'startAt', 'endAt', 'endBefore']) {
    wrap(name, original => (...args) => tag(original(...args) as object, { kind: 'cursor' }));
  }
  wrap('collection', original => (...args) => {
    const reference = original(...args) as { path: string };
    shapes.set(reference, { collection: normalizePath(`${reference.path}/x`).slice(0, -2), where: [], orderBy: [], limit: null, cursor: false });
    return reference;
  });
  wrap('collectionGroup', original => (...args) => {
    const query = original(...args) as object;
    shapes.set(query, { collection: `collection-group:${String(args[1])}`, where: [], orderBy: [], limit: null, cursor: false });
    return query;
  });
  wrap('query', original => (base, ...constraints) => {
    const built = original(base, ...constraints) as object;
    const start = shapes.get(base as object);
    if (start) {
      const shape: QueryShape = { ...start, where: [...start.where], orderBy: [...start.orderBy] };
      for (const constraint of constraints as object[]) {
        const item = described.get(constraint);
        if (!item) continue;
        if (item.kind === 'where') shape.where.push(item.text);
        else if (item.kind === 'orderBy') shape.orderBy.push(item.text);
        else if (item.kind === 'limit') shape.limit = item.value;
        else shape.cursor = true;
      }
      shapes.set(built, shape);
    }
    return built;
  });
  return wrapped;
}

function shapeOf(target: unknown): QueryShape | undefined {
  return typeof target === 'object' && target !== null ? shapes.get(target) : undefined;
}

// ---- reads and transactions ----------------------------------------------------------------------------------------------

function wrapReads<T extends Record<string, unknown>>(actual: T): Record<string, unknown> {
  const wrapped: Record<string, unknown> = {};
  const wrap = (name: string, make: (original: AnyFn) => AnyFn) => {
    const original = actual[name] as AnyFn | undefined;
    if (original) wrapped[name] = make(original);
  };
  for (const name of ['getDoc', 'getDocFromServer']) {
    wrap(name, original => async (reference, ...rest) => {
      const snapshot = await original(reference, ...rest);
      noteRead(ownerOf(reference), { form: 'doc', key: normalizePath((reference as { path: string }).path), documents: 1, billed: 1 });
      return snapshot;
    });
  }
  for (const name of ['getDocs', 'getDocsFromServer']) {
    wrap(name, original => async (target, ...rest) => {
      const snapshot = await original(target, ...rest) as { size: number };
      const shape = shapeOf(target);
      noteRead(ownerOf(target), {
        form: 'query', key: shape?.collection ?? 'unknown-query', documents: snapshot.size, billed: Math.max(1, snapshot.size),
        ...(shape ? { shape } : {}),
      });
      return snapshot;
    });
  }
  wrap('onSnapshot', original => (target, ...rest) => {
    // A document listener: count a server snapshot when its data differs from the one counted before.
    const reference = target as { path?: string; type?: string };
    if (reference.type !== 'document') return original(target, ...rest);
    const key = normalizePath(reference.path ?? '');
    let last: string | null | undefined;
    const countable = (snapshot: { metadata?: { fromCache?: boolean }; exists?: () => boolean; data?: () => unknown }) => {
      if (last !== undefined && snapshot.metadata?.fromCache) return;
      const fingerprint = snapshot.exists?.() ? JSON.stringify(snapshot.data?.(), (_key, value) => (
        value && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function' ? (value as { toMillis(): number }).toMillis() : value
      )) : null;
      if (last !== undefined && fingerprint === last) return;
      last = fingerprint;
      noteRead(ownerOf(target), { form: 'listener-doc', key, documents: 1, billed: 1 });
    };
    const args = [...rest];
    const callbackIndex = args.findIndex(item => typeof item === 'function' || (typeof item === 'object' && item !== null && 'next' in item));
    const callback = args[callbackIndex];
    if (typeof callback === 'function') {
      args[callbackIndex] = (snapshot: never, ...tail: unknown[]) => { countable(snapshot); return (callback as AnyFn)(snapshot, ...tail); };
    } else if (callback && typeof callback === 'object') {
      const observer = callback as { next?: AnyFn };
      args[callbackIndex] = { ...observer, next: (snapshot: never, ...tail: unknown[]) => { countable(snapshot); return observer.next?.(snapshot, ...tail); } };
    }
    return original(target, ...args);
  });
  wrap('runTransaction', original => (db, update, options) => {
    let attempt: WriteEvent[] = [];
    const run = original(db, async (tx: Transaction) => {
      attempt = [];
      const metered = {
        get: async (reference: { path: string }) => {
          const snapshot = await tx.get(reference as never);
          noteRead(db, { form: 'tx-doc', key: normalizePath(reference.path), documents: 1, billed: 1 });
          return snapshot;
        },
        set: (reference: { path: string }, data: DocumentData, setOptions?: unknown) => {
          attempt.push({ kind: 'set', key: normalizePath(reference.path), path: reference.path, data });
          (tx as unknown as { set: AnyFn }).set(reference, data, setOptions);
          return metered;
        },
        update: (reference: { path: string }, ...args: unknown[]) => {
          attempt.push({ kind: 'update', key: normalizePath(reference.path), path: reference.path, data: args[0] as DocumentData });
          (tx as unknown as { update: AnyFn }).update(reference, ...args);
          return metered;
        },
        delete: (reference: { path: string }) => {
          attempt.push({ kind: 'delete', key: normalizePath(reference.path), path: reference.path });
          tx.delete(reference as never);
          return metered;
        },
      };
      return (update as AnyFn)(metered);
    }, options) as Promise<unknown>;
    return run.then(result => {
      if (counting(db)) recording!.writes.push(...attempt);
      return result;
    });
  });
  return wrapped;
}

/** Wraps `firebase/firestore`: reads, transactions and the query builders. Use inside `vi.mock('firebase/firestore', …)`. */
export function wrapFirestoreMeterModule<T extends Record<string, unknown>>(actual: T): T {
  return { ...actual, ...wrapQueryBuilders(actual), ...wrapReads(actual) } as T;
}

/** The same for `firebase/firestore/lite`, which has no transactions' retries or listeners but the same reads. */
export function wrapFirestoreLiteMeterModule<T extends Record<string, unknown>>(actual: T): T {
  return { ...actual, ...wrapQueryBuilders(actual), ...wrapReads(actual) } as T;
}
