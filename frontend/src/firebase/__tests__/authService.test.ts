import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock global test setup mocks that override our per-test mocks
vi.unmock('../authService');
vi.unmock('../firebaseModules');

const mocks = vi.hoisted(() => {
  const mockSignOut = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const mockOnIdTokenChanged = vi.fn().mockReturnValue(vi.fn());
  const mockDoc = vi.fn(() => ({ path: 'operators/test-user' }));
  const mockOnSnapshot = vi.fn();
  const mockClearSensitiveData = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const mockEmitError = vi.fn();
  return { mockSignOut, mockOnIdTokenChanged, mockDoc, mockOnSnapshot, mockClearSensitiveData, mockEmitError };
});

vi.mock('../firebaseModules', () => ({
  getAuthMod: () => ({
    signOut: mocks.mockSignOut,
    onIdTokenChanged: mocks.mockOnIdTokenChanged,
    GoogleAuthProvider: vi.fn(),
    signInWithPopup: vi.fn(),
  }),
  getFirestoreMod: () => ({
    doc: mocks.mockDoc,
    onSnapshot: mocks.mockOnSnapshot,
  }),
}));

vi.mock('../../store/clearSensitivePosData', () => ({
  clearSensitivePosData: mocks.mockClearSensitiveData,
}));

vi.mock('../../errors/errorBus', () => ({
  emitError: mocks.mockEmitError,
}));

import { signOutOperator, subscribeOperatorAccess, isValidOperatorDoc } from '../authService';

beforeEach(() => {
  mocks.mockSignOut.mockClear().mockResolvedValue(undefined);
  mocks.mockOnIdTokenChanged.mockClear().mockReturnValue(vi.fn());
  mocks.mockDoc.mockClear();
  mocks.mockOnSnapshot.mockClear();
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
  it('requires emailVerified to be exactly true before subscribing to the operator document', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);
    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'test-user',
      email: 'operator@example.com',
      emailVerified: undefined,
      providerData: [{ providerId: 'google.com' }],
    });

    expect(onAccess).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, reason: 'unverified_email' }));
    expect(mocks.mockDoc).not.toHaveBeenCalled();
    expect(mocks.mockOnSnapshot).not.toHaveBeenCalled();
  });

  it('allows an explicitly approved Gmail Google identity', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);

    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'u1',
      email: 'operator@gmail.com',
      displayName: 'Approved Gmail Operator',
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    });

    expect(mocks.mockSignOut).not.toHaveBeenCalled();
    expect(mocks.mockOnSnapshot).toHaveBeenCalledOnce();
    const operatorSnapshot = mocks.mockOnSnapshot.mock.calls[0][1] as (snapshot: { data: () => unknown }) => void;
    operatorSnapshot({ data: () => ({ uid: 'u1', email: 'operator@gmail.com', active: true }) });

    expect(onAccess).toHaveBeenLastCalledWith({
      ok: true,
      profile: { uid: 'u1', email: 'operator@gmail.com', displayName: 'Approved Gmail Operator' },
      role: 'counter',
    });
  });

  it('denies an unlisted company-domain Google identity', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);
    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'unlisted', email: 'staff@talented.com.tw', emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    });
    const operatorSnapshot = mocks.mockOnSnapshot.mock.calls[0][1] as (snapshot: { data: () => unknown }) => void;
    operatorSnapshot({ data: () => undefined });

    expect(onAccess).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, reason: 'not_whitelisted' }));
  });

  it('emits signed_out when no user', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);

    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback(null);

    expect(onAccess).toHaveBeenCalledWith({ ok: false, reason: 'signed_out' });
  });

  it('rejects an exact UID whose operator email differs by case from the verified Auth email', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);

    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'u3',
      email: 'operator@gmail.com',
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    });
    const operatorSnapshot = mocks.mockOnSnapshot.mock.calls[0][1] as (snapshot: { data: () => unknown }) => void;
    operatorSnapshot({ data: () => ({ email: 'OPERATOR@gmail.com', active: true }) });

    expect(onAccess).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, reason: 'email_mismatch' }));
  });

  it('rejects an inactive allowlisted Google identity', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);
    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    await callback({
      uid: 'u4', email: 'inactive@gmail.com', emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    });
    const operatorSnapshot = mocks.mockOnSnapshot.mock.calls[0][1] as (snapshot: { data: () => unknown }) => void;
    operatorSnapshot({ data: () => ({ email: 'inactive@gmail.com', active: false }) });

    expect(onAccess).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, reason: 'inactive' }));
  });

  it('masks a prior active operator snapshot after an Auth token update invalidates email verification', async () => {
    const auth = {} as Parameters<typeof subscribeOperatorAccess>[0];
    const db = {} as Parameters<typeof subscribeOperatorAccess>[1];
    const onAccess = vi.fn();

    subscribeOperatorAccess(auth, db, onAccess);
    const callback = mocks.mockOnIdTokenChanged.mock.calls[0][1] as (user: unknown) => Promise<void>;
    const verifiedUser = {
      uid: 'u5', email: 'operator@gmail.com', emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    };
    await callback(verifiedUser);
    const staleSnapshot = mocks.mockOnSnapshot.mock.calls[0][1] as (snapshot: { data: () => unknown }) => void;

    await callback({ ...verifiedUser, emailVerified: false });
    staleSnapshot({ data: () => ({ email: 'operator@gmail.com', active: true }) });

    expect(onAccess).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, reason: 'unverified_email' }));
  });
});
