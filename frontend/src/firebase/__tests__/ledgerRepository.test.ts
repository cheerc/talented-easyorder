import { describe, expect, it } from 'vitest';
import { beforeEach, vi } from 'vitest';
import { commitLedgerOfflineBatch, commitLedgerOnline, createTransactionId, shouldUseOfflineCommitPath, type CommitLedgerInput } from '../ledgerRepository';
import type { Firestore } from 'firebase/firestore';

const mockFirestore = vi.hoisted(() => {
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn() };
  const sdk = {
    doc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    runTransaction: vi.fn(),
    writeBatch: vi.fn(() => batch),
    increment: vi.fn(),
    serverTimestamp: vi.fn(),
  };
  return { sdk, batch };
});

vi.mock('../firebaseModules', () => ({
  getFirestoreMod: vi.fn(() => mockFirestore.sdk),
}));

import { getFirestoreMod } from '../firebaseModules';

const mockDb = {} as Firestore;
const input = {} as CommitLedgerInput;

beforeEach(() => vi.clearAllMocks());

function expectNoFirestoreActivity() {
  expect(getFirestoreMod).not.toHaveBeenCalled();
  for (const method of Object.values(mockFirestore.sdk)) expect(method).not.toHaveBeenCalled();
  expect(mockFirestore.batch.set).not.toHaveBeenCalled();
  expect(mockFirestore.batch.update).not.toHaveBeenCalled();
  expect(mockFirestore.batch.delete).not.toHaveBeenCalled();
  expect(mockFirestore.batch.commit).not.toHaveBeenCalled();
}

describe('ledgerRepository', () => {
  it('creates stable idempotency keys from device id and local sequence', () => {
    expect(createTransactionId('pc-1', 42)).toBe('pc-1:tx:42');
  });

  it('selects the legacy offline route when browser is offline', () => {
    expect(shouldUseOfflineCommitPath({ online: false, forceOffline: false })).toBe(true);
  });

  it('selects the legacy online route when online', () => {
    expect(shouldUseOfflineCommitPath({ online: true, forceOffline: false })).toBe(false);
  });

  it('rejects the online legacy writer without calling Firestore', async () => {
    await expect(commitLedgerOnline(mockDb, input)).rejects.toMatchObject({
      name: 'Error',
      message: '業務功能暫未開放',
    });
    expectNoFirestoreActivity();
  });

  it('rejects the offline legacy writer without reading or creating a queue', async () => {
    await expect(commitLedgerOfflineBatch(mockDb, input)).rejects.toMatchObject({
      name: 'Error',
      message: '業務功能暫未開放',
    });
    expectNoFirestoreActivity();
  });
});
