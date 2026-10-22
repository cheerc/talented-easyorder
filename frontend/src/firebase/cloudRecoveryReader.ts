import type { FirebaseApp } from 'firebase/app';
import {
  Timestamp as FullTimestamp,
  type Firestore as FullFirestore,
} from 'firebase/firestore';
import type {
  DocumentSnapshot as LiteDocumentSnapshot,
  Firestore as LiteFirestore,
} from 'firebase/firestore/lite';
import type { CommandErrorCode } from '../domain/cloudCommands';

export const DEFAULT_FIRESTORE_DATABASE_ID = '(default)' as const;

export type FirestoreEndpoint =
  | { kind: 'emulator'; host: string; port: number; identity: string }
  | { kind: 'production'; host: string; identity: string };

type LiteSdk = Pick<typeof import('firebase/firestore/lite'), 'Timestamp' | 'doc' | 'getDoc'>;
type LiteTimestampConstructor = LiteSdk['Timestamp'];

export interface RecoveryDocumentSnapshot {
  exists(): boolean;
  data(): unknown;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}

/** The page's receipt recovery path deliberately exposes only these server document reads. */
export interface CloudRecoveryReader {
  assertCurrent(): void;
  readHead(): Promise<RecoveryDocumentSnapshot>;
  readLease(): Promise<RecoveryDocumentSnapshot>;
  readOperator(uid: string): Promise<RecoveryDocumentSnapshot>;
  readCommandReceipt(commandId: string): Promise<RecoveryDocumentSnapshot>;
}

export interface CloudRecoveryPairRegistration {
  app: FirebaseApp;
  projectId: string;
  fullDatabaseId: string;
  fullDb: FullFirestore;
  liteDatabaseId: string;
  liteDb: LiteFirestore;
  endpoint: FirestoreEndpoint;
  liteSdk: LiteSdk;
}

export class CloudRecoveryReaderError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.name = 'CloudRecoveryReaderError';
    this.code = code;
  }
}

interface PairEntry extends CloudRecoveryPairRegistration {
  generation: number;
  active: boolean;
  reader: CloudRecoveryReader;
}

const pairs = new WeakMap<FullFirestore, PairEntry>();
let nextGeneration = 1;

function sameEndpoint(left: FirestoreEndpoint, right: FirestoreEndpoint): boolean {
  return left.kind === right.kind
    && left.identity === right.identity
    && left.host === right.host
    && (left.kind !== 'emulator' || (right.kind === 'emulator' && left.port === right.port));
}

function samePair(entry: PairEntry, candidate: CloudRecoveryPairRegistration): boolean {
  return entry.app === candidate.app
    && entry.projectId === candidate.projectId
    && entry.fullDatabaseId === candidate.fullDatabaseId
    && entry.fullDb === candidate.fullDb
    && entry.liteDatabaseId === candidate.liteDatabaseId
    && entry.liteDb === candidate.liteDb
    && entry.liteSdk === candidate.liteSdk
    && sameEndpoint(entry.endpoint, candidate.endpoint);
}

function assertPairInput(pair: CloudRecoveryPairRegistration): void {
  if (!pair.app || !pair.projectId || pair.app.options.projectId !== pair.projectId
    || pair.fullDatabaseId !== DEFAULT_FIRESTORE_DATABASE_ID
    || pair.liteDatabaseId !== DEFAULT_FIRESTORE_DATABASE_ID
    || pair.fullDb.app !== pair.app || pair.liteDb.app !== pair.app
    || pair.fullDb.type !== 'firestore' || pair.liteDb.type !== 'firestore-lite'
    || typeof pair.liteSdk.Timestamp !== 'function'
    || typeof pair.liteSdk.doc !== 'function' || typeof pair.liteSdk.getDoc !== 'function') {
    throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Firestore Lite recovery pairing is not proven');
  }
  if (pair.endpoint.kind === 'emulator') {
    if (!pair.endpoint.host || !Number.isInteger(pair.endpoint.port) || pair.endpoint.port < 1 || pair.endpoint.port > 65535
      || pair.endpoint.identity !== `http://${pair.endpoint.host}:${pair.endpoint.port}`) {
      throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Firestore Emulator endpoint pairing is not proven');
    }
    return;
  }
  if (!pair.endpoint.host || pair.endpoint.identity !== `https://${pair.endpoint.host}`) {
    throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Production Firestore endpoint pairing is not proven');
  }
}

function unsupportedRecoveryValue(): CloudRecoveryReaderError {
  return new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Firestore Lite recovery data contains an unsupported value');
}

/** Convert only real Lite SDK Timestamp instances, preserving seconds and nanoseconds exactly. */
export function normalizeLiteRecoveryValue(
  value: unknown,
  liteTimestamp: LiteTimestampConstructor,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value instanceof FullTimestamp) return value;
  if (value instanceof liteTimestamp) {
    const seconds = value.seconds;
    const nanoseconds = value.nanoseconds;
    if (!Number.isSafeInteger(seconds) || !Number.isInteger(nanoseconds)
      || nanoseconds < 0 || nanoseconds >= 1_000_000_000) throw unsupportedRecoveryValue();
    try {
      return new FullTimestamp(seconds, nanoseconds);
    } catch {
      throw unsupportedRecoveryValue();
    }
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw unsupportedRecoveryValue();
    return value;
  }
  if (typeof value !== 'object') throw unsupportedRecoveryValue();
  if (ancestors.has(value)) throw unsupportedRecoveryValue();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || ownKeys.some((key, index) => (
        key !== 'length' && (typeof key !== 'string' || key !== String(index))
      ))) throw unsupportedRecoveryValue();
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) throw unsupportedRecoveryValue();
        output.push(normalizeLiteRecoveryValue(value[index], liteTimestamp, ancestors));
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw unsupportedRecoveryValue();
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string')) throw unsupportedRecoveryValue();
    const output = Object.create(prototype) as Record<string, unknown>;
    for (const key of ownKeys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw unsupportedRecoveryValue();
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: normalizeLiteRecoveryValue(descriptor.value, liteTimestamp, ancestors),
      });
    }
    return output;
  } catch (error) {
    if (error instanceof CloudRecoveryReaderError) throw error;
    throw unsupportedRecoveryValue();
  } finally {
    ancestors.delete(value);
  }
}

function validDocumentId(value: string): boolean {
  return value.length > 0 && !value.includes('/');
}

export function registerCloudRecoveryPair(pair: CloudRecoveryPairRegistration): CloudRecoveryReader {
  assertPairInput(pair);
  const existing = pairs.get(pair.fullDb);
  if (existing) {
    if (existing.active && samePair(existing, pair)) return existing.reader;
    // An inconsistent second registration invalidates all readers holding the old generation.
    existing.active = false;
    throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Firestore Lite recovery pairing changed after initialization');
  }

  const entry = {
    ...pair,
    endpoint: Object.freeze({ ...pair.endpoint }) as FirestoreEndpoint,
    generation: nextGeneration++,
    active: true,
    reader: undefined as unknown as CloudRecoveryReader,
  } satisfies PairEntry;
  const assertCurrent = () => {
    if (!entry.active || pairs.get(pair.fullDb) !== entry
      || pair.fullDb.app !== entry.app || pair.liteDb.app !== entry.app
      || pair.app.options.projectId !== entry.projectId) {
      throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Firestore Lite recovery pairing is no longer current');
    }
  };
  const read = async (path: string): Promise<RecoveryDocumentSnapshot> => {
    assertCurrent();
    let snapshot: LiteDocumentSnapshot;
    try {
      snapshot = await entry.liteSdk.getDoc(entry.liteSdk.doc(entry.liteDb, path));
    } catch (error) {
      assertCurrent();
      throw error;
    }
    assertCurrent();
    // Firestore Lite getDoc always reads from the server and its DocumentSnapshot has no metadata field.
    // If an injected compatibility snapshot supplies cache metadata, still fail closed on it.
    const metadata = (snapshot as LiteDocumentSnapshot & {
      metadata?: { fromCache?: boolean; hasPendingWrites?: boolean };
    }).metadata;
    if (metadata?.fromCache === true || metadata?.hasPendingWrites === true) {
      throw new CloudRecoveryReaderError('UNKNOWN_RESULT', 'Firestore Lite did not confirm a server-only recovery read');
    }
    const exists = snapshot.exists();
    const data = exists
      ? normalizeLiteRecoveryValue(snapshot.data(), entry.liteSdk.Timestamp) as Record<string, unknown>
      : undefined;
    assertCurrent();
    return {
      exists: () => exists,
      data: () => data,
      metadata: { fromCache: false, hasPendingWrites: false },
    };
  };
  entry.reader = Object.freeze({
    assertCurrent,
    readHead: () => read('system/dataHead'),
    readLease: () => read('system/accessLease'),
    readOperator: (uid: string) => {
      if (!validDocumentId(uid)) throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Invalid recovery operator ID');
      return read(`operators/${uid}`);
    },
    readCommandReceipt: (commandId: string) => {
      if (!validDocumentId(commandId)) throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'Invalid recovery command ID');
      return read(`commands/${commandId}`);
    },
  });
  pairs.set(pair.fullDb, entry);
  return entry.reader;
}

export function getCloudRecoveryReader(fullDb: FullFirestore): CloudRecoveryReader {
  const entry = pairs.get(fullDb);
  if (!entry || !entry.active) {
    throw new CloudRecoveryReaderError('UNSUPPORTED_SCHEMA', 'This Firestore instance has no verified Lite recovery pairing');
  }
  entry.reader.assertCurrent();
  return entry.reader;
}
