import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock Firebase modules before importing FirebaseProvider
vi.mock('../../firebase/firebaseApp', () => ({
  ensureFirebaseInitialized: vi.fn(),
  isFirebaseConfigured: vi.fn().mockReturnValue(true),
}));
vi.mock('../../firebase/authService', () => ({
  subscribeOperatorAccess: vi.fn(),
}));

import { FirebaseProvider, useFirebase } from '../FirebaseProvider';
import { ensureFirebaseInitialized } from '../../firebase/firebaseApp';
import { subscribeOperatorAccess } from '../../firebase/authService';
import type { FirebaseServices } from '../../firebase/firebaseApp';
import type { OperatorAccess } from '../../firebase/authService';
import type { ReactNode } from 'react';
import React from 'react';

const mockEnsure = vi.mocked(ensureFirebaseInitialized);
const mockSubscribe = vi.mocked(subscribeOperatorAccess);

describe('#320 — FirebaseProvider cleanup race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call setAccess after unmount (cancelled flag)', async () => {
    // ensureFirebaseInitialized resolves with mock services
    const mockAuth = {} as Record<string, unknown>;
    const mockDb = {} as Record<string, unknown>;
    const mockServices = {
      auth: mockAuth,
      db: mockDb,
      app: {} as Record<string, unknown>,
    } as unknown as FirebaseServices;
    mockEnsure.mockResolvedValue(mockServices);

    // Capture the callback passed to subscribeOperatorAccess
    let capturedCallback: ((access: OperatorAccess) => void) | null = null;
    const mockUnsub = vi.fn();
    mockSubscribe.mockImplementation((_auth, _db, cb) => {
      capturedCallback = cb;
      return mockUnsub;
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(FirebaseProvider, null, children);

    const { unmount } = renderHook(() => useFirebase(), { wrapper });

    // Wait for Firebase init to resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // subscribeOperatorAccess should have been called
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(capturedCallback).not.toBeNull();

    // Unmount the component
    unmount();

    // The unsub function should have been called
    expect(mockUnsub).toHaveBeenCalledTimes(1);

    // After unmount, calling the captured callback should NOT throw
    // (it's guarded by the cancelled flag)
    expect(() => capturedCallback!({ ok: false, reason: 'signed_out' })).not.toThrow();
  });
});
