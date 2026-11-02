import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const mocks = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, path: string) => ({ path })),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  onSnapshot: mocks.onSnapshot,
}));

import { subscribeDataHead, type DataHeadSignal } from '../dataHeadWatch';

type Snapshot = {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  exists: () => boolean;
  data: () => unknown;
};

function serverSnapshot(data: unknown, overrides: Partial<Snapshot['metadata']> = {}, exists = true): Snapshot {
  return {
    metadata: { fromCache: false, hasPendingWrites: false, ...overrides },
    exists: () => exists,
    data: () => data,
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

  it('watches only system/dataHead and includes metadata changes so cache and pending writes can be skipped', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    expect(mocks.doc).toHaveBeenCalledWith({}, 'system/dataHead');
    expect(mocks.onSnapshot).toHaveBeenCalledWith({ path: 'system/dataHead' }, { includeMetadataChanges: true }, expect.any(Function), expect.any(Function));
  });

  it('does not report cache-only or pending-write observations', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot({ seq: 4, lastCommandId: null, datasetId: 'ds-1' }, { fromCache: true }));
    emit(serverSnapshot({ seq: 4, lastCommandId: null, datasetId: 'ds-1' }, { hasPendingWrites: true }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reports the sequence, last command id and dataset of a server-confirmed head', () => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot({ seq: 7, lastCommandId: 'cmd-7', datasetId: 'ds-1', maintenance: false, goLiveDate: '2026-10-01' }));
    emit(serverSnapshot({ seq: 0, lastCommandId: null, datasetId: 'ds-1' }));
    expect(onUpdate).toHaveBeenNthCalledWith(1, { seq: 7, lastCommandId: 'cmd-7', datasetId: 'ds-1' });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { seq: 0, lastCommandId: null, datasetId: 'ds-1' });
  });

  it.each([
    ['a missing document', undefined, false],
    ['a negative seq', { seq: -1, lastCommandId: null, datasetId: 'ds-1' }, true],
    ['a fractional seq', { seq: 1.5, lastCommandId: null, datasetId: 'ds-1' }, true],
    ['a non-numeric seq', { seq: '3', lastCommandId: null, datasetId: 'ds-1' }, true],
    ['an unsafe integer seq', { seq: Number.MAX_SAFE_INTEGER + 1, lastCommandId: null, datasetId: 'ds-1' }, true],
    ['a numeric lastCommandId', { seq: 3, lastCommandId: 5, datasetId: 'ds-1' }, true],
    ['an empty datasetId', { seq: 3, lastCommandId: null, datasetId: '' }, true],
    ['a missing datasetId', { seq: 3, lastCommandId: null }, true],
    ['a non-object body', 'head', true],
  ])('reports null for %s', (_label, data, exists) => {
    subscribeDataHead({} as Firestore, onUpdate);
    emit(serverSnapshot(data, {}, exists));
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
