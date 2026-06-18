import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock global test setup mocks that override our per-test mocks
vi.unmock('../authService');
vi.unmock('../firebaseModules');

const mocks = vi.hoisted(() => {
  const mockSignOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const mockOnAuthStateChanged = vi.fn().mockReturnValue(vi.fn());
  const mockClearSensitiveData = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const mockEmitError = vi.fn();
  return { mockSignOut, mockOnAuthStateChanged, mockClearSensitiveData, mockEmitError };
});

vi.mock('../firebaseModules', () => ({
  getAuthMod: () => ({
    signOut: mocks.mockSignOut,
    onAuthStateChanged: mocks.mockOnAuthStateChanged,
    GoogleAuthProvider: vi.fn(),
    signInWithPopup: vi.fn(),
  }),
  getFirestoreMod: () => ({
    doc: vi.fn(),
    onSnapshot: vi.fn(),
  }),
}));

vi.mock('../../store/posPersistence', () => ({
  clearSensitiveData: mocks.mockClearSensitiveData,
}));

vi.mock('../../errors/errorBus', () => ({
  emitError: mocks.mockEmitError,
}));

import { signOutOperator, subscribeOperatorAccess, isValidOperatorDoc } from '../authService';

beforeEach(() => {
  mocks.mockSignOut.mockClear().mockResolvedValue(undefined);
  mocks.mockOnAuthStateChanged.mockClear().mockReturnValue(vi.fn());
  mocks.mockClearSensitiveData.mockClear().mockResolvedValue(undefined);
  mocks.mockEmitError.mockClear();
});

describe('signOutOperator', () => {
  it('clears sensitive data then signs out', async () => {
    const auth = {} as Parameters<typeof signOutOperator>[0];
    await signOutOperator(auth);

    expect(mocks.mockClearSensitiveData).toHaveBeenCalledOnce();
    expect(mocks.mockSignOut).toHaveBeenCalledWith(auth);
  });
});

describe('isValidOperatorDoc', () => {
  it('returns true for valid doc', () => {
    expect(isValidOperatorDoc({ active: true, role: 'counter' })).toBe(true);
    expect(isValidOperatorDoc({ active: false, role: 'admin' })).toBe(true);
    expect(isValidOperatorDoc({})).toBe(true);
  });

  it('returns false for invalid doc', () => {
    expect(isValidOperatorDoc(null)).toBe(false);
    expect(isValidOperatorDoc(undefined)).toBe(false);
    expect(isValidOperatorDoc('string')).toBe(false);
    expect(isValidOperatorDoc({ active: 'yes' })).toBe(false);
    expect(isValidOperatorDoc({ role: 'superadmin' })).toBe(false);
  });
});

describe('subscribeOperatorAccess — signOut race (#301)', () => {
  it('emits wrong_domain rejection after signOut', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);

    const callback = mocks.mockOnAuthStateChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'u1',
      email: 'user@wrong-domain.com',
      displayName: 'Wrong User',
      photoURL: null,
    });

    expect(mocks.mockSignOut).toHaveBeenCalledWith(auth);
    expect(onAccess).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: 'wrong_domain' }),
    );
  });

  it('emits signed_out when no user', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);

    const callback = mocks.mockOnAuthStateChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback(null);

    expect(onAccess).toHaveBeenCalledWith({ ok: false, reason: 'signed_out' });
  });

  it('still emits rejected if signOut throws', async () => {
    mocks.mockSignOut.mockRejectedValueOnce(new Error('network'));

    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);

    const callback = mocks.mockOnAuthStateChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'u2',
      email: 'user@wrong-domain.com',
      displayName: 'Bad User',
      photoURL: null,
    });

    expect(onAccess).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: 'wrong_domain' }),
    );
    expect(mocks.mockEmitError).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'auth' }),
    );
  });
});
