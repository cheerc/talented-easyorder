import { Timestamp as FullTimestamp, type Firestore as FullFirestore } from 'firebase/firestore';
import { Timestamp as LiteTimestamp, type Firestore as LiteFirestore } from 'firebase/firestore/lite';
import type { FirebaseApp } from 'firebase/app';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudRecoveryReaderError,
  getCloudRecoveryReader,
  normalizeLiteRecoveryValue,
  registerCloudRecoveryPair,
  type CloudRecoveryPairRegistration,
} from '../cloudRecoveryReader';

function pair(overrides: Partial<CloudRecoveryPairRegistration> = {}) {
  const app = { name: 'recovery-test', options: { projectId: 'recovery-project' } } as unknown as FirebaseApp;
  const fullDb = { app, type: 'firestore' } as unknown as FullFirestore;
  const liteDb = { app, type: 'firestore-lite' } as unknown as LiteFirestore;
  const liteSdk = {
    Timestamp: LiteTimestamp,
    doc: vi.fn((database: LiteFirestore, path: string) => ({ database, path })),
    getDoc: vi.fn(async () => ({
      exists: () => true,
      data: () => ({}),
    })),
  } as unknown as CloudRecoveryPairRegistration['liteSdk'];
  return {
    app,
    projectId: 'recovery-project',
    fullDatabaseId: '(default)',
    fullDb,
    liteDatabaseId: '(default)',
    liteDb,
    endpoint: { kind: 'emulator' as const, host: '127.0.0.1', port: 8080, identity: 'http://127.0.0.1:8080' },
    liteSdk,
    ...overrides,
  } satisfies CloudRecoveryPairRegistration;
}

function snapshot(data: unknown, options: { exists?: boolean; fromCache?: boolean; hasPendingWrites?: boolean } = {}) {
  const exists = options.exists ?? true;
  return {
    exists: () => exists,
    data: () => data,
    ...(options.fromCache !== undefined || options.hasPendingWrites !== undefined ? {
      metadata: { fromCache: options.fromCache ?? false, hasPendingWrites: options.hasPendingWrites ?? false },
    } : {}),
  };
}

describe('CloudRecoveryReader pairing and data boundary', () => {
  it('converts only real Lite Timestamps recursively and preserves nanosecond precision and map keys', () => {
    const lite = new LiteTimestamp(1_800_000_000, 123_456_789);
    const full = new FullTimestamp(1_700_000_000, 987_654_321);
    const lookalike = { seconds: 1_800_000_001, nanoseconds: 7 };
    const source = Object.assign(Object.create(null) as Record<string, unknown>, {
      before: { updatedAt: lite },
      after: [{ createdAt: lite, alreadyFull: full }],
      lookalike,
    });
    Object.defineProperty(source, '__proto__', {
      configurable: true, enumerable: true, writable: true, value: { kept: true },
    });

    const value = normalizeLiteRecoveryValue(source, LiteTimestamp) as Record<string, unknown>;
    const before = value.before as { updatedAt: FullTimestamp };
    const after = (value.after as Array<{ createdAt: FullTimestamp; alreadyFull: FullTimestamp }>)[0];

    expect(before.updatedAt).toBeInstanceOf(FullTimestamp);
    expect(before.updatedAt.seconds).toBe(1_800_000_000);
    expect(before.updatedAt.nanoseconds).toBe(123_456_789);
    expect(after.createdAt).toBeInstanceOf(FullTimestamp);
    expect(after.createdAt.nanoseconds).toBe(123_456_789);
    expect(after.alreadyFull).toBe(full);
    expect(value.lookalike).toEqual(lookalike);
    expect(value.lookalike).not.toBeInstanceOf(FullTimestamp);
    expect(value['__proto__']).toEqual({ kept: true });
    expect(Object.getPrototypeOf(value)).toBeNull();
  });

  it.each([
    ['Date class instance', new Date()],
    ['custom class instance', new (class OtherValue { value = 1; })()],
    ['undefined', undefined],
    ['symbol', Symbol('unsupported')],
    ['infinite number', Number.POSITIVE_INFINITY],
  ])('rejects unsupported recovery value: %s', (_label, value) => {
    expect(() => normalizeLiteRecoveryValue(value, LiteTimestamp)).toThrow(CloudRecoveryReaderError);
    expect(() => normalizeLiteRecoveryValue(value, LiteTimestamp)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
  });

  it('keeps plain timestamp lookalikes and rejects cyclic or lossy array shapes', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => normalizeLiteRecoveryValue(cycle, LiteTimestamp)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));

    const array = [new LiteTimestamp(1_700_000_000, 4)];
    Object.defineProperty(array, 'extra', { value: 'must not be dropped', enumerable: true });
    expect(() => normalizeLiteRecoveryValue(array, LiteTimestamp)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
  });

  it('registers the exact full/Lite pair and exposes only the four recovery document reads', async () => {
    const registration = pair();
    const reader = registerCloudRecoveryPair(registration);

    expect(getCloudRecoveryReader(registration.fullDb)).toBe(reader);
    expect(registerCloudRecoveryPair(registration)).toBe(reader);
    expect(await reader.readHead()).toMatchObject({ exists: expect.any(Function), metadata: { fromCache: false } });
    await reader.readLease();
    await reader.readOperator('operator-1');
    await reader.readCommandReceipt('00000000-0000-4000-8000-000000000001');
    expect(registration.liteSdk.doc).toHaveBeenNthCalledWith(1, registration.liteDb, 'system/dataHead');
    expect(registration.liteSdk.doc).toHaveBeenNthCalledWith(2, registration.liteDb, 'system/accessLease');
    expect(registration.liteSdk.doc).toHaveBeenNthCalledWith(3, registration.liteDb, 'operators/operator-1');
    expect(registration.liteSdk.doc).toHaveBeenNthCalledWith(4, registration.liteDb, 'commands/00000000-0000-4000-8000-000000000001');
    expect('readPath' in reader).toBe(false);
  });

  it('fails closed for an unknown database or incorrect app, project, database, and endpoint pairing', () => {
    const unknown = { app: { options: { projectId: 'recovery-project' } }, type: 'firestore' } as unknown as FullFirestore;
    expect(() => getCloudRecoveryReader(unknown)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    expect(() => registerCloudRecoveryPair(pair({ projectId: 'different-project' }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    expect(() => registerCloudRecoveryPair(pair({ fullDatabaseId: 'named-db' }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    expect(() => registerCloudRecoveryPair(pair({ endpoint: { kind: 'emulator', host: '127.0.0.1', port: 8081, identity: 'http://127.0.0.1:8080' } }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
    expect(() => registerCloudRecoveryPair(pair({ liteDb: { app: {}, type: 'firestore-lite' } as unknown as LiteFirestore }))).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_SCHEMA' }));
  });

  it('invalidates a registered generation when a repeated registration is inconsistent during an await', async () => {
    let resolveRead!: (value: ReturnType<typeof snapshot>) => void;
    const registration = pair();
    const getDoc = registration.liteSdk.getDoc as unknown as ReturnType<typeof vi.fn>;
    getDoc.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
    const reader = registerCloudRecoveryPair(registration);
    const pendingRead = reader.readHead();

    await vi.waitFor(() => expect(registration.liteSdk.getDoc).toHaveBeenCalledOnce());
    const changedLiteDb = { app: registration.app, type: 'firestore-lite' } as unknown as LiteFirestore;
    expect(() => registerCloudRecoveryPair(pair({ ...registration, liteDb: changedLiteDb }))).toThrow(/pairing changed/);
    resolveRead(snapshot({ schemaVersion: 1 }));

    await expect(pendingRead).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    expect(() => reader.assertCurrent()).toThrow(/no longer current/);
  });

  it('preserves permission and service failures and treats only an explicit server absence as not found', async () => {
    const registration = pair();
    const getDoc = registration.liteSdk.getDoc as unknown as ReturnType<typeof vi.fn>;
    const permissionDenied = Object.assign(new Error('denied'), { code: 'permission-denied' });
    getDoc.mockRejectedValueOnce(permissionDenied);
    getDoc.mockResolvedValueOnce(snapshot(undefined, { exists: false }));
    const reader = registerCloudRecoveryPair(registration);

    await expect(reader.readCommandReceipt('00000000-0000-4000-8000-000000000001')).rejects.toBe(permissionDenied);
    const absent = await reader.readCommandReceipt('00000000-0000-4000-8000-000000000001');
    expect(absent.exists()).toBe(false);
    expect(absent.data()).toBeUndefined();
  });

  it('accepts real Lite server snapshots without metadata and rejects supplied cache metadata', async () => {
    const registration = pair();
    const reader = registerCloudRecoveryPair(registration);

    await expect(reader.readHead()).resolves.toMatchObject({ metadata: { fromCache: false, hasPendingWrites: false } });
    (registration.liteSdk.getDoc as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(snapshot({}, { fromCache: true }));
    await expect(reader.readHead()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
    (registration.liteSdk.getDoc as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(snapshot({}, { hasPendingWrites: true }));
    await expect(reader.readHead()).rejects.toMatchObject({ code: 'UNKNOWN_RESULT' });
  });
});
