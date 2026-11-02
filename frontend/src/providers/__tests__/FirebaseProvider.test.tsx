import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import type { OperatorAccess } from '../../firebase/authService';
import type { ActiveLeaseState } from '../../firebase/activeAccountLease';

const leaseMocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  getLeaseStatus: vi.fn(),
  releaseLease: vi.fn(),
  renewLease: vi.fn(),
  subscribeLease: vi.fn((...args: [unknown, string | null, (state: ActiveLeaseState) => void]) => {
    void args;
    return vi.fn();
  }),
  startLeaseHeartbeat: vi.fn((...args: [unknown, string, () => number, (reason: string) => void]) => {
    void args;
    return vi.fn();
  }),
}));

// Mock Firebase modules before importing
vi.mock('../../firebase/firebaseApp', () => ({
  ensureFirebaseInitialized: vi.fn(),
  isFirebaseConfigured: vi.fn(),
}));
vi.mock('../../firebase/authService', () => ({
  subscribeOperatorAccess: vi.fn(),
}));
vi.mock('../../firebase/activeAccountLease', () => ({
  acquireLease: leaseMocks.acquireLease,
  getLeaseStatus: leaseMocks.getLeaseStatus,
  releaseLease: leaseMocks.releaseLease,
  renewLease: leaseMocks.renewLease,
  subscribeLease: leaseMocks.subscribeLease,
  startLeaseHeartbeat: leaseMocks.startLeaseHeartbeat,
  TAB_RETURN_RECHECK_AFTER_MS: 60_000,
  defaultLeaseState: {
    holderUid: null,
    epoch: 0,
    updatedAt: null,
    isKnown: false,
    isHolder: false,
    isExpired: false,
  },
}));
const headMocks = vi.hoisted(() => ({
  subscribeDataHead: vi.fn((...args: [unknown, (head: unknown) => void]) => {
    void args;
    return vi.fn();
  }),
}));
vi.mock('../../firebase/dataHeadWatch', () => ({ subscribeDataHead: headMocks.subscribeDataHead }));
vi.mock('../../store/clearSensitivePosData', () => ({ clearSensitivePosData: vi.fn().mockResolvedValue(undefined) }));

import { FirebaseProvider, useFirebase } from '../FirebaseProvider';
import { ensureFirebaseInitialized, isFirebaseConfigured } from '../../firebase/firebaseApp';
import { subscribeOperatorAccess } from '../../firebase/authService';
import { clearSensitivePosData } from '../../store/clearSensitivePosData';

const mockEnsure = vi.mocked(ensureFirebaseInitialized);
const mockIsConfigured = vi.mocked(isFirebaseConfigured);
const mockSubscribe = vi.mocked(subscribeOperatorAccess);
const mockClearSensitivePosData = vi.mocked(clearSensitivePosData);

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(FirebaseProvider, null, children);
}

describe('#331 — FirebaseProvider lifecycle tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: Firebase is configured
    mockIsConfigured.mockReturnValue(true);
    leaseMocks.acquireLease.mockReset();
    leaseMocks.getLeaseStatus.mockReset().mockResolvedValue({
      holderUid: null, epoch: 0, updatedAt: null, isKnown: false, isHolder: false, isExpired: false,
    });
    leaseMocks.releaseLease.mockReset().mockResolvedValue(false);
    leaseMocks.renewLease.mockReset();
    leaseMocks.subscribeLease.mockReset().mockReturnValue(vi.fn());
    leaseMocks.startLeaseHeartbeat.mockReset().mockReturnValue(vi.fn());
  });

  it('provides initial state: fb=null, fbError=null, access=signed_out', () => {
    // Never resolve ensureFirebaseInitialized
    mockEnsure.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useFirebase(), { wrapper });

    expect(result.current.fb).toBeNull();
    expect(result.current.fbError).toBeNull();
    expect(result.current.access).toEqual({ ok: false, reason: 'signed_out' });
  });

  it('sets fb when ensureFirebaseInitialized resolves', async () => {
    const mockServices = {
      app: {} as Record<string, unknown>,
      auth: { currentUser: null } as Record<string, unknown>,
      db: {} as Record<string, unknown>,
    };
    mockEnsure.mockResolvedValue(mockServices as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);
    mockSubscribe.mockReturnValue(() => {});

    const { result } = renderHook(() => useFirebase(), { wrapper });

    await waitFor(() => {
      expect(result.current.fb).not.toBeNull();
    });

    expect(result.current.fb).toBe(mockServices);
    expect(result.current.fbError).toBeNull();
  });

  it('sets fbError when ensureFirebaseInitialized rejects', async () => {
    mockEnsure.mockRejectedValue(new Error('Missing Firebase env var: VITE_FIREBASE_API_KEY'));

    const { result } = renderHook(() => useFirebase(), { wrapper });

    await waitFor(() => {
      expect(result.current.fbError).not.toBeNull();
    });

    expect(result.current.fbError).toBe('Missing Firebase env var: VITE_FIREBASE_API_KEY');
    expect(result.current.fb).toBeNull();
  });

  it('subscribes to operator access after init', async () => {
    const mockServices = {
      app: {} as Record<string, unknown>,
      auth: { currentUser: null } as Record<string, unknown>,
      db: {} as Record<string, unknown>,
    };
    mockEnsure.mockResolvedValue(mockServices as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);

    let capturedCallback: ((access: OperatorAccess) => void) | null = null;
    const mockUnsub = vi.fn();
    mockSubscribe.mockImplementation((_auth, _db, cb) => {
      capturedCallback = cb;
      return mockUnsub;
    });

    const { result } = renderHook(() => useFirebase(), { wrapper });

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    // Simulate access granted
    const access: OperatorAccess = {
      ok: true,
      profile: { uid: 'op-1', email: 'op-1@example.com', displayName: 'Operator 1' },
    };
    await act(async () => {
      capturedCallback!(access);
    });

    expect(result.current.access).toEqual(access);
  });

  it('does not publish an acquire result after the authenticated UID changes', async () => {
    const mockServices = {
      app: {} as Record<string, unknown>,
      auth: { currentUser: null } as Record<string, unknown>,
      db: {} as Record<string, unknown>,
    };
    mockEnsure.mockResolvedValue(mockServices as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);

    let capturedCallback: ((access: OperatorAccess) => void) | null = null;
    mockSubscribe.mockImplementation((_auth, _db, cb) => {
      capturedCallback = cb;
      return () => {};
    });

    let resolveServerRead!: (value: {
      holderUid: string | null;
      epoch: number;
      updatedAt: Date | null;
      isKnown: boolean;
      isHolder: boolean;
      isExpired: boolean;
    }) => void;
    leaseMocks.getLeaseStatus.mockReturnValueOnce(new Promise(resolve => { resolveServerRead = resolve; }));

    const { result } = renderHook(() => useFirebase(), { wrapper });
    await waitFor(() => expect(capturedCallback).not.toBeNull());

    const firstAccess: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-first', email: 'first@example.com', displayName: 'First' },
    };
    const nextAccess: OperatorAccess = {
      ok: true,
      profile: { uid: 'uid-next', email: 'next@example.com', displayName: 'Next' },
    };
    await act(async () => { capturedCallback!(firstAccess); });

    const pendingAcquire = result.current.acquireLease();
    await act(async () => { capturedCallback!(nextAccess); });
    resolveServerRead({
      holderUid: null, epoch: 0, updatedAt: null, isKnown: true, isHolder: false, isExpired: true,
    });

    await expect(pendingAcquire).resolves.toEqual({
      status: 'lost', message: '帳號或租約狀態已變更，請重新確認',
    });
    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(result.current.access).toEqual(nextAccess);
    expect(result.current.lease.isHolder).toBe(false);
  });

  it('retains confirmed holder state across ignored pending snapshots and clears only on server-confirmed loss', async () => {
    const mockServices = {
      app: {} as Record<string, unknown>,
      auth: { currentUser: null } as Record<string, unknown>,
      db: {} as Record<string, unknown>,
    };
    mockEnsure.mockResolvedValue(mockServices as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);

    let accessCallback: ((access: OperatorAccess) => void) | null = null;
    mockSubscribe.mockImplementation((_auth, _db, callback) => {
      accessCallback = callback;
      return vi.fn();
    });

    let leaseCallback: ((state: ActiveLeaseState) => void) | null = null;
    leaseMocks.subscribeLease.mockImplementation((_db, _uid, callback) => {
      leaseCallback = callback;
      return vi.fn();
    });
    const stopHeartbeat = vi.fn();
    leaseMocks.startLeaseHeartbeat.mockReturnValueOnce(stopHeartbeat);
    leaseMocks.renewLease.mockResolvedValue({
      status: 'acquired', holderUid: 'op-1', epoch: 1, updatedAt: new Date(),
    });

    const { result } = renderHook(() => useFirebase(), { wrapper });
    await waitFor(() => expect(accessCallback).not.toBeNull());
    await act(async () => {
      accessCallback!({
        ok: true,
        profile: { uid: 'op-1', email: 'op-1@example.com', displayName: 'Operator 1' },
      });
    });
    await waitFor(() => expect(leaseCallback).not.toBeNull());

    await act(async () => {
      leaseCallback!({
        holderUid: 'op-1', epoch: 1, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
      });
    });
    await waitFor(() => expect(result.current.lease.isHolder).toBe(true));
    expect(leaseMocks.startLeaseHeartbeat).toHaveBeenCalledOnce();
    expect(mockClearSensitivePosData).not.toHaveBeenCalled();

    // activeAccountLease suppresses cache/pending metadata callbacks. With no
    // authoritative observation, the confirmed holder and cloud memory remain live.
    await act(async () => {});
    expect(result.current.lease).toMatchObject({ holderUid: 'op-1', epoch: 1, isKnown: true, isHolder: true });
    expect(mockClearSensitivePosData).not.toHaveBeenCalled();
    expect(stopHeartbeat).not.toHaveBeenCalled();

    await act(async () => {
      leaseCallback!({
        holderUid: 'op-2', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
      });
    });
    await waitFor(() => expect(result.current.lease).toMatchObject({ holderUid: 'op-2', epoch: 2, isHolder: false }));
    expect(stopHeartbeat).toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledOnce();
  });

  it('throws when useFirebase is used outside FirebaseProvider', () => {
    // Suppress console.error from React
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      renderHook(() => useFirebase());
    }).toThrow('useFirebase must be used within FirebaseProvider');
    spy.mockRestore();
  });
});

describe('#362 — FirebaseProvider skips init when not configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps fb=null and fbError=null without calling ensureFirebaseInitialized', async () => {
    mockIsConfigured.mockReturnValue(false);

    const { result } = renderHook(() => useFirebase(), { wrapper });

    // Wait a tick to ensure useEffect has run
    await act(async () => {});

    expect(result.current.fb).toBeNull();
    expect(result.current.fbError).toBeNull();
    expect(result.current.access).toEqual({ ok: false, reason: 'signed_out' });
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});

describe('#586 — tab return keeps a confirmed holder mounted', () => {
  const services = {
    app: {} as Record<string, unknown>,
    auth: { currentUser: null } as Record<string, unknown>,
    db: {} as Record<string, unknown>,
  };
  let nowMs = 0;

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  }

  /** Signs in as op-1, observes a same-UID lease at epoch 1 and lets the first renew confirm it. */
  async function confirmedHolder() {
    mockEnsure.mockResolvedValue(services as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);
    let accessCallback: ((access: OperatorAccess) => void) | null = null;
    mockSubscribe.mockImplementation((_auth, _db, callback) => { accessCallback = callback; return vi.fn(); });
    let leaseCallback: ((state: ActiveLeaseState) => void) | null = null;
    leaseMocks.subscribeLease.mockImplementation((_db, _uid, callback) => { leaseCallback = callback; return vi.fn(); });
    const stopHeartbeat = vi.fn();
    const heartbeatLostCallbacks: Array<(reason: string) => void> = [];
    leaseMocks.startLeaseHeartbeat.mockImplementation((_db, _uid, _getEpoch, onLost) => {
      heartbeatLostCallbacks.push(onLost);
      return stopHeartbeat;
    });
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'acquired', holderUid: 'op-1', epoch: 1, updatedAt: new Date() });

    const history: ActiveLeaseState[] = [];
    const hook = renderHook(() => {
      const value = useFirebase();
      history.push(value.lease);
      return value;
    }, { wrapper });
    await waitFor(() => expect(accessCallback).not.toBeNull());
    await act(async () => {
      accessCallback!({ ok: true, profile: { uid: 'op-1', email: 'op-1@example.com', displayName: 'Operator 1' } });
    });
    await waitFor(() => expect(leaseCallback).not.toBeNull());
    await act(async () => {
      leaseCallback!({ holderUid: 'op-1', epoch: 1, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(true));
    history.length = 0;
    mockClearSensitivePosData.mockClear();
    return {
      hook,
      history,
      stopHeartbeat,
      leaseCallback: () => leaseCallback!,
      heartbeatLost: (reason: string) => heartbeatLostCallbacks[heartbeatLostCallbacks.length - 1]!(reason),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    leaseMocks.acquireLease.mockReset();
    leaseMocks.getLeaseStatus.mockReset().mockResolvedValue({
      holderUid: null, epoch: 0, updatedAt: null, isKnown: false, isHolder: false, isExpired: false,
    });
    leaseMocks.releaseLease.mockReset().mockResolvedValue(false);
    leaseMocks.renewLease.mockReset();
    leaseMocks.subscribeLease.mockReset().mockReturnValue(vi.fn());
    leaseMocks.startLeaseHeartbeat.mockReset().mockReturnValue(vi.fn());
    leaseMocks.acquireLease.mockReset();
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('V1: returning after under a minute does nothing: no renew, no status read, no clear, no unmount', async () => {
    const { hook, history, stopHeartbeat } = await confirmedHolder();
    setVisibility('hidden');
    nowMs = 5_000;
    setVisibility('visible');
    await act(async () => {});

    expect(leaseMocks.renewLease).toHaveBeenCalledTimes(1);
    expect(leaseMocks.getLeaseStatus).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).not.toHaveBeenCalled();
    expect(stopHeartbeat).not.toHaveBeenCalled();
    expect(history.some(state => !state.isHolder || !state.isKnown)).toBe(false);
    expect(hook.result.current.lease).toMatchObject({ holderUid: 'op-1', epoch: 1, isKnown: true, isHolder: true });
  });

  it('V2: returning after a minute renews once in the background without masking or clearing', async () => {
    const { hook, history, stopHeartbeat } = await confirmedHolder();
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'acquired', holderUid: 'op-1', epoch: 1, updatedAt: new Date() });
    setVisibility('hidden');
    nowMs = 61_000;
    setVisibility('visible');
    await act(async () => {});

    expect(leaseMocks.renewLease).toHaveBeenCalledTimes(2);
    expect(leaseMocks.renewLease).toHaveBeenLastCalledWith(services.db, 'op-1', 1);
    expect(leaseMocks.getLeaseStatus).not.toHaveBeenCalled();
    expect(history.some(state => !state.isHolder || !state.isKnown)).toBe(false);
    expect(mockClearSensitivePosData).not.toHaveBeenCalled();
    expect(stopHeartbeat).not.toHaveBeenCalled();
    expect(leaseMocks.startLeaseHeartbeat).toHaveBeenCalledTimes(1);
    expect(hook.result.current.lease).toMatchObject({ holderUid: 'op-1', epoch: 1, isKnown: true, isHolder: true });
  });

  it('V3: a background renew the server does not confirm masks and clears (fail closed)', async () => {
    const { hook, stopHeartbeat } = await confirmedHolder();
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'lost', message: '伺服器未確認續約；請重新檢查使用權' });
    setVisibility('hidden');
    nowMs = 61_000;
    setVisibility('visible');
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
    expect(stopHeartbeat).toHaveBeenCalled();
  });

  it('V4: a background renew that finds another holder shows that holder and clears', async () => {
    const { hook } = await confirmedHolder();
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'stale_epoch', message: 'epoch changed' });
    leaseMocks.getLeaseStatus.mockResolvedValueOnce({
      holderUid: 'op-2', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    });
    setVisibility('hidden');
    nowMs = 61_000;
    setVisibility('visible');
    await waitFor(() => expect(hook.result.current.lease).toMatchObject({ holderUid: 'op-2', epoch: 2, isHolder: false }));

    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
  });

  it('V5: a tab that is not a confirmed holder still re-reads the lease when it returns', async () => {
    const { hook, leaseCallback } = await confirmedHolder();
    // Server-confirmed loss leaves the tab masked and unconfirmed.
    await act(async () => {
      leaseCallback()({ holderUid: 'op-2', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));
    leaseMocks.getLeaseStatus.mockClear();

    setVisibility('hidden');
    nowMs = 5_000;
    setVisibility('visible');
    await waitFor(() => expect(leaseMocks.getLeaseStatus).toHaveBeenCalled());
  });
});

describe('#586 P2 — an own, untouched, expired lease is re-acquired without masking', () => {
  const services = {
    app: {} as Record<string, unknown>,
    auth: { currentUser: null } as Record<string, unknown>,
    db: {} as Record<string, unknown>,
  };
  let nowMs = 0;
  const expiredOwn = (epoch: number) => ({
    holderUid: 'op-1', epoch, updatedAt: new Date(0), isKnown: true, isHolder: false, isExpired: true,
  });
  const unknownState = {
    holderUid: null, epoch: 0, updatedAt: null, isKnown: false, isHolder: false, isExpired: false, error: '無法從伺服器讀取租約',
  };

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  }

  async function confirmedHolder() {
    mockEnsure.mockResolvedValue(services as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);
    let accessCallback: ((access: OperatorAccess) => void) | null = null;
    mockSubscribe.mockImplementation((_auth, _db, callback) => { accessCallback = callback; return vi.fn(); });
    let leaseCallback: ((state: ActiveLeaseState) => void) | null = null;
    leaseMocks.subscribeLease.mockImplementation((_db, _uid, callback) => { leaseCallback = callback; return vi.fn(); });
    const stopHeartbeat = vi.fn();
    const heartbeatLostCallbacks: Array<(reason: string) => void> = [];
    leaseMocks.startLeaseHeartbeat.mockImplementation((_db, _uid, _getEpoch, onLost) => {
      heartbeatLostCallbacks.push(onLost);
      return stopHeartbeat;
    });
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'acquired', holderUid: 'op-1', epoch: 1, updatedAt: new Date() });

    const history: ActiveLeaseState[] = [];
    const hook = renderHook(() => {
      const value = useFirebase();
      history.push(value.lease);
      return value;
    }, { wrapper });
    await waitFor(() => expect(accessCallback).not.toBeNull());
    await act(async () => {
      accessCallback!({ ok: true, profile: { uid: 'op-1', email: 'op-1@example.com', displayName: 'Operator 1' } });
    });
    await waitFor(() => expect(leaseCallback).not.toBeNull());
    await act(async () => {
      leaseCallback!({ holderUid: 'op-1', epoch: 1, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(true));
    history.length = 0;
    mockClearSensitivePosData.mockClear();
    return {
      hook,
      history,
      stopHeartbeat,
      leaseCallback: () => leaseCallback!,
      heartbeatLost: (reason: string) => heartbeatLostCallbacks[heartbeatLostCallbacks.length - 1]!(reason),
    };
  }

  /** Background return after a minute whose renew Rules refuse (the lease expired while the tab slept). */
  function returnAfterLongAbsence() {
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'lost', message: '伺服器未確認續約；請重新檢查使用權' });
    setVisibility('hidden');
    nowMs = 61_000;
    setVisibility('visible');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    leaseMocks.acquireLease.mockReset();
    leaseMocks.getLeaseStatus.mockReset().mockResolvedValue(unknownState);
    leaseMocks.releaseLease.mockReset().mockResolvedValue(false);
    leaseMocks.renewLease.mockReset();
    leaseMocks.subscribeLease.mockReset().mockReturnValue(vi.fn());
    leaseMocks.startLeaseHeartbeat.mockReset().mockReturnValue(vi.fn());
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('W1: background renew refused, server shows our own untouched lease → one acquire, never masked, data kept', async () => {
    const { hook, history, leaseCallback } = await confirmedHolder();
    leaseMocks.getLeaseStatus.mockResolvedValueOnce(expiredOwn(1));
    leaseMocks.acquireLease.mockImplementationOnce(async () => {
      // The listener reports the committed lease before the acquire promise resolves.
      leaseCallback()({ holderUid: 'op-1', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
      return { status: 'acquired', holderUid: 'op-1', epoch: 2, updatedAt: new Date() };
    });
    returnAfterLongAbsence();
    await waitFor(() => expect(hook.result.current.lease).toMatchObject({ holderUid: 'op-1', epoch: 2, isHolder: true }));

    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1);
    expect(leaseMocks.acquireLease).toHaveBeenCalledWith(services.db, 'op-1', 1, 'op-1@example.com');
    expect(history.some(state => !state.isHolder || !state.isKnown)).toBe(false);
    expect(mockClearSensitivePosData).not.toHaveBeenCalled();
    expect(leaseMocks.startLeaseHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('W2: server shows another holder → no acquire; shows that holder, masks and clears', async () => {
    const { hook } = await confirmedHolder();
    leaseMocks.getLeaseStatus.mockResolvedValueOnce({
      holderUid: 'op-2', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    });
    returnAfterLongAbsence();
    await waitFor(() => expect(hook.result.current.lease).toMatchObject({ holderUid: 'op-2', epoch: 2, isHolder: false }));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
  });

  it('W3: lease released (no holder) → no acquire; masks and clears', async () => {
    const { hook } = await confirmedHolder();
    leaseMocks.getLeaseStatus.mockResolvedValueOnce({
      holderUid: null, epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false,
    });
    returnAfterLongAbsence();
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
  });

  it('W4: lease epoch moved on (touched since) → no acquire; masks and clears', async () => {
    const { hook } = await confirmedHolder();
    leaseMocks.getLeaseStatus.mockResolvedValueOnce(expiredOwn(2));
    // The follow-up proof for the new epoch is refused too, so the tab stays masked.
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'lost', message: '伺服器未確認續約；請重新檢查使用權' });
    returnAfterLongAbsence();
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
  });

  it('W5: acquire refused (busy) → exactly one attempt, then masks and clears', async () => {
    const { hook } = await confirmedHolder();
    leaseMocks.getLeaseStatus.mockResolvedValueOnce(expiredOwn(1));
    leaseMocks.acquireLease.mockResolvedValueOnce({
      status: 'busy', currentHolderUid: 'op-1', epoch: 1, updatedAt: new Date(), message: '使用權仍有效',
    });
    returnAfterLongAbsence();
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1);
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
    expect(leaseMocks.startLeaseHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('W6: server cannot be read (offline) → no acquire; masks and clears', async () => {
    const { hook } = await confirmedHolder();
    returnAfterLongAbsence();
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
  });

  it('W7: heartbeat loses an own untouched expired lease → one acquire, stays mounted', async () => {
    const { hook, history, heartbeatLost } = await confirmedHolder();
    leaseMocks.getLeaseStatus.mockResolvedValueOnce(expiredOwn(1));
    leaseMocks.acquireLease.mockResolvedValueOnce({ status: 'acquired', holderUid: 'op-1', epoch: 2, updatedAt: new Date() });
    await act(async () => { heartbeatLost('租約續約失敗：伺服器未確認續約；請重新檢查使用權'); });
    await waitFor(() => expect(hook.result.current.lease).toMatchObject({ holderUid: 'op-1', epoch: 2, isHolder: true }));

    expect(leaseMocks.acquireLease).toHaveBeenCalledTimes(1);
    expect(history.some(state => !state.isHolder || !state.isKnown)).toBe(false);
    expect(mockClearSensitivePosData).not.toHaveBeenCalled();
    expect(leaseMocks.startLeaseHeartbeat).toHaveBeenCalledTimes(2);
  });

  it('W7b: heartbeat loss with another holder or an unreadable server masks and clears', async () => {
    const { hook, heartbeatLost } = await confirmedHolder();
    await act(async () => { heartbeatLost('租約續約失敗：伺服器未確認續約；請重新檢查使用權'); });
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(hook.result.current.lease.isKnown).toBe(false);
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
  });

  it('V6a: a confirmed holder whose background probe goes offline masks and clears', async () => {
    const { hook, stopHeartbeat } = await confirmedHolder();
    leaseMocks.renewLease.mockResolvedValueOnce({ status: 'lost', message: '無法連線到伺服器，請稍後再試' });
    setVisibility('hidden');
    nowMs = 61_000;
    setVisibility('visible');
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
    expect(stopHeartbeat).toHaveBeenCalled();
  });

  it('V6b: a confirmed holder whose background probe throws masks and clears', async () => {
    const { hook, stopHeartbeat } = await confirmedHolder();
    leaseMocks.renewLease.mockRejectedValueOnce(new Error('network down'));
    setVisibility('hidden');
    nowMs = 61_000;
    setVisibility('visible');
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));

    expect(leaseMocks.acquireLease).not.toHaveBeenCalled();
    expect(mockClearSensitivePosData).toHaveBeenCalledTimes(1);
    expect(stopHeartbeat).toHaveBeenCalled();
  });
});

describe('#587 — dataHead is watched only while this tab is a confirmed holder', () => {
  const services = {
    app: {} as Record<string, unknown>,
    auth: { currentUser: null } as Record<string, unknown>,
    db: {} as Record<string, unknown>,
  };

  async function signedInTab() {
    mockEnsure.mockResolvedValue(services as unknown as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);
    let accessCallback: ((access: OperatorAccess) => void) | null = null;
    mockSubscribe.mockImplementation((_auth, _db, callback) => { accessCallback = callback; return vi.fn(); });
    let leaseCallback: ((state: ActiveLeaseState) => void) | null = null;
    leaseMocks.subscribeLease.mockImplementation((_db, _uid, callback) => { leaseCallback = callback; return vi.fn(); });
    leaseMocks.renewLease.mockResolvedValue({ status: 'acquired', holderUid: 'op-1', epoch: 1, updatedAt: new Date() });
    const hook = renderHook(() => useFirebase(), { wrapper });
    await waitFor(() => expect(accessCallback).not.toBeNull());
    await act(async () => {
      accessCallback!({ ok: true, profile: { uid: 'op-1', email: 'op-1@example.com', displayName: 'Operator 1' } });
    });
    await waitFor(() => expect(leaseCallback).not.toBeNull());
    return { hook, leaseCallback: () => leaseCallback!, accessCallback: () => accessCallback! };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    leaseMocks.acquireLease.mockReset();
    leaseMocks.getLeaseStatus.mockReset().mockResolvedValue({
      holderUid: null, epoch: 0, updatedAt: null, isKnown: false, isHolder: false, isExpired: false,
    });
    leaseMocks.releaseLease.mockReset().mockResolvedValue(false);
    leaseMocks.renewLease.mockReset();
    leaseMocks.subscribeLease.mockReset().mockReturnValue(vi.fn());
    leaseMocks.startLeaseHeartbeat.mockReset().mockReturnValue(vi.fn());
    headMocks.subscribeDataHead.mockReset().mockReturnValue(vi.fn());
  });

  it('H1: no watch before the lease is confirmed; dataHead is null', async () => {
    const { hook, leaseCallback } = await signedInTab();
    leaseMocks.renewLease.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      leaseCallback()({ holderUid: 'op-1', epoch: 1, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    expect(hook.result.current.lease.isHolder).toBe(false);
    expect(headMocks.subscribeDataHead).not.toHaveBeenCalled();
    expect(hook.result.current.dataHead).toBeNull();
  });

  it('H2: once confirmed it watches system/dataHead exactly once and exposes the latest server-confirmed value', async () => {
    const { hook, leaseCallback } = await signedInTab();
    await act(async () => {
      leaseCallback()({ holderUid: 'op-1', epoch: 1, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(true));
    await waitFor(() => expect(headMocks.subscribeDataHead).toHaveBeenCalledTimes(1));
    expect(headMocks.subscribeDataHead.mock.calls[0]![0]).toBe(services.db);

    const onUpdate = headMocks.subscribeDataHead.mock.calls[0]![1];
    await act(async () => { onUpdate({ seq: 12, lastCommandId: 'cmd-12', datasetId: 'ds-1' }); });
    expect(hook.result.current.dataHead).toEqual({ seq: 12, lastCommandId: 'cmd-12', datasetId: 'ds-1' });
    await act(async () => { onUpdate(null); });
    expect(hook.result.current.dataHead).toBeNull();
  });

  it('H3: losing the confirmed lease stops the watch at once and clears the value', async () => {
    const unsubscribeHead = vi.fn();
    headMocks.subscribeDataHead.mockReturnValue(unsubscribeHead);
    const { hook, leaseCallback } = await signedInTab();
    await act(async () => {
      leaseCallback()({ holderUid: 'op-1', epoch: 1, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    await waitFor(() => expect(headMocks.subscribeDataHead).toHaveBeenCalledTimes(1));
    await act(async () => { headMocks.subscribeDataHead.mock.calls[0]![1]({ seq: 3, lastCommandId: 'c', datasetId: 'ds-1' }); });
    expect(hook.result.current.dataHead).not.toBeNull();

    await act(async () => {
      leaseCallback()({ holderUid: 'op-2', epoch: 2, updatedAt: new Date(), isKnown: true, isHolder: false, isExpired: false });
    });
    await waitFor(() => expect(hook.result.current.lease.isHolder).toBe(false));
    expect(unsubscribeHead).toHaveBeenCalled();
    expect(hook.result.current.dataHead).toBeNull();
  });
});
