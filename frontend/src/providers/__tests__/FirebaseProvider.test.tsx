import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';

// Mock Firebase modules before importing
vi.mock('../../firebase/firebaseApp', () => ({
  ensureFirebaseInitialized: vi.fn(),
}));
vi.mock('../../firebase/authService', () => ({
  subscribeOperatorAccess: vi.fn(),
}));

import { FirebaseProvider, useFirebase } from '../FirebaseProvider';
import { ensureFirebaseInitialized } from '../../firebase/firebaseApp';
import { subscribeOperatorAccess } from '../../firebase/authService';

const mockEnsure = vi.mocked(ensureFirebaseInitialized);
const mockSubscribe = vi.mocked(subscribeOperatorAccess);

function wrapper({ children }: { children: ReactNode }) {
  return React.createElement(FirebaseProvider, null, children);
}

describe('#331 — FirebaseProvider lifecycle tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockEnsure.mockResolvedValue(mockServices as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);
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
    mockEnsure.mockResolvedValue(mockServices as ReturnType<typeof ensureFirebaseInitialized> extends Promise<infer T> ? T : never);

    let capturedCallback: ((a: Record<string, unknown>) => void) | null = null;
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
    await act(async () => {
      capturedCallback!({ ok: true, operatorId: 'op-1', storeId: 'store-1' });
    });

    expect(result.current.access).toEqual({ ok: true, operatorId: 'op-1', storeId: 'store-1' });
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
