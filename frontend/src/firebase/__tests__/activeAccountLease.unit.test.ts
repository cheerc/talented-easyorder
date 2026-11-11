import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase/firestore';

const mocks = vi.hoisted(() => ({
  doc: vi.fn(() => { throw new Error('uninitialized Firestore client'); }),
  getDocFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {},
  doc: mocks.doc,
  getDocFromServer: mocks.getDocFromServer,
  onSnapshot: mocks.onSnapshot,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
}));

import {
  acquireLease,
  getLeaseStatus,
  releaseLease,
  renewLease,
  subscribeLease,
  startLeaseHeartbeat,
  LEASE_DURATION_MS,
  LEASE_HEARTBEAT_INTERVAL_MS,
} from '../activeAccountLease';

type LeaseSnapshotCallback = (snapshot: {
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
  exists: () => boolean;
  data: () => unknown;
}) => void;

type LeaseSnapshotError = (error: Error) => void;

class TestLockManager {
  private held = false;
  private readonly queue: Array<{
    callback: (lock: { name: string }) => Promise<void> | void;
    resolve: () => void;
    reject: (error: Error) => void;
    signal: AbortSignal;
    abort: () => void;
  }> = [];

  request(
    _name: string,
    options: { signal: AbortSignal },
    callback: (lock: { name: string }) => Promise<void> | void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry = {
        callback,
        resolve,
        reject,
        signal: options.signal,
        abort: () => {},
      };
      entry.abort = () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new DOMException('Request aborted', 'AbortError'));
      };
      if (entry.signal.aborted) {
        entry.abort();
        return;
      }
      entry.signal.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
      this.grantNext();
    });
  }

  private grantNext(): void {
    if (this.held) return;
    const entry = this.queue.shift();
    if (!entry) return;
    if (entry.signal.aborted) {
      entry.abort();
      this.grantNext();
      return;
    }

    this.held = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.signal.removeEventListener('abort', entry.abort);
      this.held = false;
      entry.resolve();
      this.grantNext();
    };
    Promise.resolve(entry.callback({ name: 'easyorder:system-access-lease-heartbeat' }))
      .then(release, error => {
        release();
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      });
  }

  get heldCount(): number {
    return this.held ? 1 : 0;
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

describe('activeAccountLease: heartbeat interval (P16f2 S7)', () => {
  it('renews every two minutes, so a single failed renewal still leaves the five-minute lease with time to spare', () => {
    expect(LEASE_HEARTBEAT_INTERVAL_MS).toBe(120_000);
    expect(LEASE_DURATION_MS - 2 * LEASE_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
  });
});

describe('activeAccountLease: unavailable Firestore fails closed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.doc.mockImplementation(() => { throw new Error('uninitialized Firestore client'); });
    mocks.getDocFromServer.mockReset();
    mocks.onSnapshot.mockReset();
    mocks.runTransaction.mockReset();
    mocks.serverTimestamp.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fabricate a successful acquire from a non-Firestore object', async () => {
    const result = await acquireLease({} as Firestore, 'operator-a', 0, 'operator-a@example.com');

    expect(result.status).toBe('lost');
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('does not treat a local UID or an unreadable lease as confirmed holder access', async () => {
    const state = await getLeaseStatus({} as Firestore, 'operator-a');

    expect(state.isKnown).toBe(false);
    expect(state.isHolder).toBe(false);
    expect(state.updatedAt).toBeNull();
  });

  it('does not fabricate successful release or a holder subscription update', async () => {
    const onUpdate = vi.fn();
    const released = await releaseLease({} as Firestore, 'operator-a', 0, 'operator-a@example.com');
    const unsubscribe = subscribeLease({} as Firestore, 'operator-a', onUpdate);

    expect(released).toBe(false);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ isKnown: false, isHolder: false }));
    expect(typeof unsubscribe).toBe('function');
  });

  it('ignores cache and pending-write snapshots, then publishes only the server acknowledgement', () => {
    mocks.doc.mockReturnValue({} as never);
    let onSnapshotNext: LeaseSnapshotCallback | undefined;
    let onSnapshotError: LeaseSnapshotError | undefined;
    mocks.onSnapshot.mockImplementation((...args: unknown[]) => {
      onSnapshotNext = args[2] as LeaseSnapshotCallback;
      onSnapshotError = args[3] as LeaseSnapshotError;
      return vi.fn();
    });

    const onUpdate = vi.fn();
    subscribeLease({} as Firestore, 'operator-a', onUpdate);
    expect(onSnapshotNext).toBeTypeOf('function');
    expect(onSnapshotError).toBeTypeOf('function');

    const nonAuthoritativeSnapshot = {
      exists: () => true,
      data: () => ({ holderUid: 'operator-a', epoch: 1, updatedAt: new Date() }),
    };
    onSnapshotNext!({
      ...nonAuthoritativeSnapshot,
      metadata: { fromCache: true, hasPendingWrites: false },
    });
    onSnapshotNext!({
      ...nonAuthoritativeSnapshot,
      metadata: { fromCache: false, hasPendingWrites: true },
    });
    expect(onUpdate).not.toHaveBeenCalled();

    const updatedAt = Object.assign(new Timestamp(1, 0), { toDate: () => new Date() });
    onSnapshotNext!({
      exists: () => true,
      data: () => ({ holderUid: 'operator-a', epoch: 1, updatedAt }),
      metadata: { fromCache: false, hasPendingWrites: false },
    });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      holderUid: 'operator-a', epoch: 1, isKnown: true, isHolder: false,
    }));
  });

  it('fails closed for authoritative missing/malformed snapshots and listener errors', () => {
    mocks.doc.mockReturnValue({} as never);
    let onSnapshotNext: LeaseSnapshotCallback | undefined;
    let onSnapshotError: LeaseSnapshotError | undefined;
    mocks.onSnapshot.mockImplementation((...args: unknown[]) => {
      onSnapshotNext = args[2] as LeaseSnapshotCallback;
      onSnapshotError = args[3] as LeaseSnapshotError;
      return vi.fn();
    });

    const onUpdate = vi.fn();
    subscribeLease({} as Firestore, 'operator-a', onUpdate);
    const serverMetadata = { fromCache: false, hasPendingWrites: false };

    onSnapshotNext!({ metadata: serverMetadata, exists: () => false, data: () => undefined });
    onSnapshotNext!({
      metadata: serverMetadata,
      exists: () => true,
      data: () => ({ holderUid: 'operator-a', epoch: 1, updatedAt: new Date() }),
    });
    onSnapshotError!(new Error('permission-denied'));

    expect(onUpdate).toHaveBeenCalledTimes(3);
    for (const [state] of onUpdate.mock.calls) {
      expect(state).toMatchObject({ isKnown: false, isHolder: false });
    }
  });

  it('elects one heartbeat leader, aborts queued starters and hands leadership over', async () => {
    vi.useFakeTimers();
    const locks = new TestLockManager();
    Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: locks });
    mocks.doc.mockReturnValue({} as never);
    const timestamp = Object.assign(new Timestamp(1, 0), { toDate: () => new Date() });
    mocks.getDocFromServer.mockResolvedValue({
      exists: () => true,
      data: () => ({ holderUid: 'operator-a', epoch: 1, updatedAt: timestamp }),
    });
    mocks.runTransaction.mockImplementation(async (_db: Firestore, callback: (tx: unknown) => unknown) =>
      callback({
        get: async () => ({
          exists: () => true,
          data: () => ({ holderUid: 'operator-a', epoch: 1, updatedAt: timestamp }),
        }),
        update: vi.fn(),
      }),
    );

    const db = {} as Firestore;
    const lostA = vi.fn();
    const lostB = vi.fn();
    const stopA = startLeaseHeartbeat(db, 'operator-a', () => 1, lostA);
    const stopB = startLeaseHeartbeat(db, 'operator-a', () => 1, lostB);
    await vi.waitFor(() => expect(locks.heldCount).toBe(1));
    expect(locks.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.runTransaction).toHaveBeenCalledOnce();
    expect(lostA).not.toHaveBeenCalled();
    expect(lostB).not.toHaveBeenCalled();

    stopA();
    await vi.waitFor(() => expect(locks.pendingCount).toBe(0));
    expect(locks.heldCount).toBe(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
    expect(lostA).not.toHaveBeenCalled();
    expect(lostB).not.toHaveBeenCalled();

    stopB();
    vi.useRealTimers();
  });

  it('aborts a queued heartbeat and ignores an in-flight completion after stop', async () => {
    vi.useFakeTimers();
    const locks = new TestLockManager();
    Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: locks });
    mocks.doc.mockReturnValue({} as never);
    const timestamp = Object.assign(new Timestamp(1, 0), { toDate: () => new Date() });

    let resolveTransaction!: (value: unknown) => void;
    mocks.runTransaction.mockImplementation(() => new Promise(resolve => { resolveTransaction = resolve; }));
    mocks.getDocFromServer.mockResolvedValue({
      exists: () => true,
      data: () => ({ holderUid: 'operator-a', epoch: 2, updatedAt: timestamp }),
    });

    const db = {} as Firestore;
    const lostA = vi.fn();
    const lostB = vi.fn();
    const stopA = startLeaseHeartbeat(db, 'operator-a', () => 1, lostA);
    const stopB = startLeaseHeartbeat(db, 'operator-a', () => 1, lostB);
    await vi.waitFor(() => expect(locks.pendingCount).toBe(1));

    await vi.advanceTimersByTimeAsync(120_000);
    await vi.waitFor(() => expect(mocks.runTransaction).toHaveBeenCalledOnce());
    stopB();
    expect(locks.pendingCount).toBe(0);

    stopA();
    resolveTransaction({ status: 'pending' });
    await vi.waitFor(() => expect(mocks.getDocFromServer).toHaveBeenCalled());
    expect(lostA).not.toHaveBeenCalled();
    expect(lostB).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('activeAccountLease: accessEvents are written inside the lease transition transaction', () => {
  const actorEmail = 'operator-a@example.com';
  const timestamp = Object.assign(new Timestamp(1, 0), { toDate: () => new Date(1_700_000_000_000) });

  function leaseAfter(holderUid: string | null, epoch: number) {
    return { holderUid, epoch, updatedAt: timestamp };
  }

  /** Runs the transaction callback against a fake transaction that records what it writes. */
  function runWith(lease: { holderUid: string | null; epoch: number; updatedAt: unknown }, committed: ReturnType<typeof leaseAfter>) {
    const tx = {
      get: vi.fn(async () => ({ exists: () => true, data: () => lease })),
      update: vi.fn(),
      set: vi.fn(),
    };
    mocks.doc.mockImplementation(((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })) as never);
    mocks.serverTimestamp.mockReturnValue('SERVER_TIME');
    mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    mocks.getDocFromServer.mockResolvedValue({ exists: () => true, data: () => committed });
    return tx;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocFromServer.mockReset();
    mocks.onSnapshot.mockReset();
    mocks.runTransaction.mockReset();
    mocks.serverTimestamp.mockReset();
  });

  it('acquiring an empty lease sets accessEvents/{new epoch} in the same transaction', async () => {
    const tx = runWith(leaseAfter(null, 0), leaseAfter('operator-a', 1));
    await acquireLease({} as Firestore, 'operator-a', 0, actorEmail);

    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledWith({ path: 'system/accessLease' }, { holderUid: 'operator-a', epoch: 1, updatedAt: 'SERVER_TIME' });
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledWith({ path: 'accessEvents/1' }, {
      kind: 'acquire', holderUid: 'operator-a', previousHolderUid: null,
      actorUid: 'operator-a', actorEmail, at: 'SERVER_TIME',
    });
  });

  it('acquiring a lease another holder still has in the document is a takeover naming that holder', async () => {
    const tx = runWith(leaseAfter('operator-b', 6), leaseAfter('operator-a', 7));
    await acquireLease({} as Firestore, 'operator-a', 6, actorEmail);

    expect(tx.set).toHaveBeenCalledWith({ path: 'accessEvents/7' }, {
      kind: 'takeover', holderUid: 'operator-a', previousHolderUid: 'operator-b',
      actorUid: 'operator-a', actorEmail, at: 'SERVER_TIME',
    });
  });

  it('releasing sets a release event with a null holder at the new epoch', async () => {
    const tx = runWith(leaseAfter('operator-a', 3), leaseAfter(null, 4));
    await releaseLease({} as Firestore, 'operator-a', 3, actorEmail);

    expect(tx.update).toHaveBeenCalledWith({ path: 'system/accessLease' }, { holderUid: null, epoch: 4, updatedAt: 'SERVER_TIME' });
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledWith({ path: 'accessEvents/4' }, {
      kind: 'release', holderUid: null, previousHolderUid: 'operator-a',
      actorUid: 'operator-a', actorEmail, at: 'SERVER_TIME',
    });
  });

  it('renewing never sets an event', async () => {
    const tx = runWith(leaseAfter('operator-a', 3), leaseAfter('operator-a', 3));
    await renewLease({} as Firestore, 'operator-a', 3);

    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(tx.set).not.toHaveBeenCalled();
  });

  it('writes no event when the transaction aborts before any lease change', async () => {
    const tx = runWith(leaseAfter('operator-a', 9), leaseAfter('operator-a', 9));
    await acquireLease({} as Firestore, 'operator-a', 8, actorEmail);
    await releaseLease({} as Firestore, 'operator-b', 9, actorEmail);

    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.set).not.toHaveBeenCalled();
  });
});

describe('activeAccountLease: copy of what a lost lease says (#691 P9 extras)', () => {
  const timestamp = Object.assign(new Timestamp(1, 0), { toDate: () => new Date(1_700_000_000_000) });
  const leaseDoc = (holderUid: string | null, epoch: number) => ({ holderUid, epoch, updatedAt: timestamp });

  function runWith(lease: { holderUid: string | null; epoch: number; updatedAt: unknown }, committed: unknown = lease) {
    const tx = { get: vi.fn(async () => ({ exists: () => true, data: () => lease })), update: vi.fn(), set: vi.fn() };
    mocks.doc.mockImplementation(((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })) as never);
    mocks.serverTimestamp.mockReturnValue('SERVER_TIME');
    mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    mocks.getDocFromServer.mockResolvedValue({ exists: () => true, data: () => committed });
    return tx;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocFromServer.mockReset();
    mocks.runTransaction.mockReset();
    mocks.serverTimestamp.mockReset();
  });

  it('renew by a holder that is no longer the holder says someone may have logged in or the login lapsed, never that someone certainly did', async () => {
    // The same account releasing from another tab, or re-acquiring its own expired lease, reaches this branch too.
    runWith(leaseDoc('operator-b', 5));
    const result = await renewLease({} as Firestore, 'operator-a', 5);

    expect(result).toMatchObject({ status: 'lost' });
    expect(result.status === 'lost' ? result.message : '').toMatch(/其他人已登入或登入已失效/);
    expect(result.status === 'lost' ? result.message : '').toMatch(/請重新登入/);
  });
});

describe('activeAccountLease: a lost result says whether the server could not be reached (#691 P9 extras)', () => {
  const timestamp = Object.assign(new Timestamp(1, 0), { toDate: () => new Date(1_700_000_000_000) });
  const leaseDoc = (holderUid: string | null, epoch: number) => ({ holderUid, epoch, updatedAt: timestamp });
  const fake = (lease: ReturnType<typeof leaseDoc>) => ({ get: vi.fn(async () => ({ exists: () => true, data: () => lease })), update: vi.fn(), set: vi.fn() });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocFromServer.mockReset();
    mocks.runTransaction.mockReset();
    mocks.serverTimestamp.mockReset();
    mocks.doc.mockImplementation(((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })) as never);
    mocks.serverTimestamp.mockReturnValue('SERVER_TIME');
  });

  /** The provider decides offline-versus-denied from this flag, so rewording a message can never flip the decision. */
  const offlineOf = (result: { status: string; offline?: boolean }) => (result.status === 'lost' ? result.offline === true : null);

  it('renew: the server cannot be read after Rules refused it → offline; the server can be read and shows it was refused → not offline', async () => {
    mocks.runTransaction.mockRejectedValue(new Error('unavailable'));
    mocks.getDocFromServer.mockRejectedValue(new Error('unavailable'));
    expect(offlineOf(await renewLease({} as Firestore, 'operator-a', 3))).toBe(true);

    mocks.getDocFromServer.mockReset();
    mocks.getDocFromServer.mockResolvedValue({ exists: () => true, data: () => leaseDoc('operator-a', 3) });
    expect(offlineOf(await renewLease({} as Firestore, 'operator-a', 3))).toBe(false);
  });

  it('renew: the commit went through but the read-back failed or found nothing → offline; the read-back shows another holder → not offline', async () => {
    mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (value: ReturnType<typeof fake>) => Promise<unknown>) => callback(fake(leaseDoc('operator-a', 3))));
    mocks.getDocFromServer.mockRejectedValue(new Error('unavailable'));
    expect(offlineOf(await renewLease({} as Firestore, 'operator-a', 3))).toBe(true);

    mocks.getDocFromServer.mockReset();
    mocks.getDocFromServer.mockResolvedValue({ exists: () => false, data: () => undefined });
    expect(offlineOf(await renewLease({} as Firestore, 'operator-a', 3))).toBe(true);

    mocks.getDocFromServer.mockReset();
    mocks.getDocFromServer.mockResolvedValue({ exists: () => true, data: () => leaseDoc('operator-b', 3) });
    expect(offlineOf(await renewLease({} as Firestore, 'operator-a', 3))).toBe(false);
  });

  it('renew: a holder that changed or an unreadable lease document is a denial, not a connection problem', async () => {
    mocks.runTransaction.mockImplementation(async (_db: unknown, callback: (value: ReturnType<typeof fake>) => Promise<unknown>) => callback(fake(leaseDoc('operator-b', 3))));
    expect(offlineOf(await renewLease({} as Firestore, 'operator-a', 3))).toBe(false);
  });

  it('acquire: a failed attempt followed by an unreadable server → offline; a refused attempt that leaves another holder → not offline', async () => {
    mocks.runTransaction.mockRejectedValue(new Error('unavailable'));
    mocks.getDocFromServer.mockRejectedValue(new Error('unavailable'));
    expect(offlineOf(await acquireLease({} as Firestore, 'operator-a', 3, 'a@example.test'))).toBe(true);

    mocks.getDocFromServer.mockReset();
    mocks.getDocFromServer.mockResolvedValue({ exists: () => true, data: () => leaseDoc(null, 3) });
    expect(offlineOf(await acquireLease({} as Firestore, 'operator-a', 3, 'a@example.test'))).toBe(false);
  });
});
