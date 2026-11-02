import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, path: string) => ({ collection: path })),
  orderBy: vi.fn((field: string, direction: string) => ({ orderBy: [field, direction] })),
  limit: vi.fn((count: number) => ({ limit: count })),
  query: vi.fn((source: unknown, ...constraints: unknown[]) => ({ source, constraints })),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  orderBy: mocks.orderBy,
  limit: mocks.limit,
  query: mocks.query,
  onSnapshot: mocks.onSnapshot,
}));

import { subscribeDataHead, type DataHeadSignal } from '../dataHeadWatch';

type Snapshot = {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  docs: Array<{ data: () => unknown }>;
};

function receipt(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    commandId: `cmd-${seq}`,
    kind: 'CreateOrder',
    seq,
    targets: { transactionId: `tx-${seq}`, studentId: 's1', dayId: '2026-11-02' },
    after: { head: { datasetId: 'ds-1', seq, lastCommandId: `cmd-${seq}` } },
    ...overrides,
  };
}

function serverSnapshot(data: unknown[], overrides: Partial<Snapshot['metadata']> = {}): Snapshot {
  return {
    metadata: { fromCache: false, hasPendingWrites: false, ...overrides },
    docs: data.map(item => ({ data: () => item })),
  };
}

describe('#587 subscribeDataHead', () => {
  let emit: (snapshot: Snapshot) => void;
  let fail: (error: Error) => void;
  const unsubscribe = vi.fn();
  const onUpdate = vi.fn<(head: DataHeadSignal | null) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onSnapshot.mockImplementation((_ref: unknown, _options: unknown, next: typeof emit, error: typeof fail) => {
      emit = next;
      fail = error;
      return unsubscribe;
    });
  });

  it('watches the single newest command receipt, never system/dataHead (the repositories read the head as a fence from the server)', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    expect(mocks.collection).toHaveBeenCalledWith({}, 'commands');
    expect(mocks.query).toHaveBeenCalledWith({ collection: 'commands' }, { orderBy: ['seq', 'desc'] }, { limit: 1 });
    expect(mocks.onSnapshot).toHaveBeenCalledWith(
      { source: { collection: 'commands' }, constraints: [{ orderBy: ['seq', 'desc'] }, { limit: 1 }] },
      { includeMetadataChanges: true },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('does not report cache-only or pending-write observations', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot([receipt(4)], { fromCache: true }));
    emit(serverSnapshot([receipt(4)], { hasPendingWrites: true }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reports the sequence, command id, dataset and targets of the newest server-confirmed receipt', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot([receipt(7)]));
    expect(onUpdate).toHaveBeenCalledWith({
      seq: 7,
      lastCommandId: 'cmd-7',
      datasetId: 'ds-1',
      targets: { transactionId: 'tx-7', studentId: 's1', dayId: '2026-11-02' },
    });
  });

  it('reports null while no command exists yet', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot([]));
    expect(onUpdate).toHaveBeenCalledWith(null);
  });

  it.each([
    ['a seq of zero', receipt(0)],
    ['a fractional seq', receipt(1.5)],
    ['a non-numeric seq', receipt(3, { seq: '3' })],
    ['an unsafe integer seq', receipt(Number.MAX_SAFE_INTEGER + 1)],
    ['a missing command id', receipt(3, { commandId: undefined })],
    ['an empty command id', receipt(3, { commandId: '' })],
    ['targets that are not an object', receipt(3, { targets: 'x' })],
    ['targets that are an array', receipt(3, { targets: [] })],
    ['a missing after head', receipt(3, { after: {} })],
    ['an empty datasetId', receipt(3, { after: { head: { datasetId: '', seq: 3 } } })],
    ['an after head seq that differs from the receipt seq', receipt(3, { after: { head: { datasetId: 'ds-1', seq: 4 } } })],
    ['a non-object body', 'receipt'],
  ])('reports null for %s', (_label, data) => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot([data]));
    expect(onUpdate).toHaveBeenCalledWith(null);
  });

  it('reports null when the listener errors (Rules refuse or the network drops); the lease flow owns masking', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    fail(new Error('permission-denied'));
    expect(onUpdate).toHaveBeenCalledWith(null);
  });

  it('returns the unsubscribe function, and an unusable client reports null instead of throwing', () => {
    const stop = subscribeDataHead({} as Firestore, onUpdate);
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    mocks.onSnapshot.mockImplementation(() => { throw new Error('uninitialized'); });
    const noop = subscribeDataHead({} as Firestore, onUpdate);
    expect(onUpdate).toHaveBeenLastCalledWith(null);
    expect(() => noop()).not.toThrow();
  });
});
