import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import type { OperatorAccess } from '../../firebase/authService';

const leaseMocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  getLeaseStatus: vi.fn(),
  releaseLease: vi.fn(),
  renewLease: vi.fn(),
  subscribeLease: vi.fn(() => vi.fn()),
  startLeaseHeartbeat: vi.fn(() => vi.fn()),
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
  defaultLeaseState: {
    holderUid: null,
    epoch: 0,
    updatedAt: null,
    isKnown: false,
    isHolder: false,
    isExpired: false,
  },
}));
vi.mock('../../store/clearSensitivePosData', () => ({ clearSensitivePosData: vi.fn().mockResolvedValue(undefined) }));

import { FirebaseProvider, useFirebase } from '../FirebaseProvider';
import { ensureFirebaseInitialized, isFirebaseConfigured } from '../../firebase/firebaseApp';
import { subscribeOperatorAccess } from '../../firebase/authService';

const mockEnsure = vi.mocked(ensureFirebaseInitialized);
const mockIsConfigured = vi.mocked(isFirebaseConfigured);
const mockSubscribe = vi.mocked(subscribeOperatorAccess);

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
