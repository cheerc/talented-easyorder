import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addCashAdjustment, createCloseAttemptId, promoteCloseAttemptOnline, summarizeCloseAttemptConflict, writeOfflineCloseAttempt } from '../settlementRepository';
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

beforeEach(() => vi.clearAllMocks());

function expectNoFirestoreActivity() {
  expect(getFirestoreMod).not.toHaveBeenCalled();
  for (const method of Object.values(mockFirestore.sdk)) expect(method).not.toHaveBeenCalled();
  expect(mockFirestore.batch.set).not.toHaveBeenCalled();
  expect(mockFirestore.batch.update).not.toHaveBeenCalled();
  expect(mockFirestore.batch.delete).not.toHaveBeenCalled();
  expect(mockFirestore.batch.commit).not.toHaveBeenCalled();
}

describe('settlementRepository', () => {
  it('creates stable close attempt ids', () => {
    expect(createCloseAttemptId('pc-1', '2026-05-16', 7)).toBe('pc-1:close:2026-05-16:7');
  });

  it('marks multiple different attempts as conflict', () => {
    expect(summarizeCloseAttemptConflict([
      { id: 'a', actualDrawer: 5260, difference: 0 },
      { id: 'b', actualDrawer: 5250, difference: -10 },
    ])).toEqual({ conflict: true, attemptIds: ['a', 'b'] });
  });

  it('rejects offline close attempts without calling Firestore', async () => {
    await expect(writeOfflineCloseAttempt(mockDb, {
      id: 'pc:close:2026-05-16:1',
      businessDate: '2026-05-16',
      openingCash: 500,
      netCash: 20,
      expectedDrawer: 520,
      actualDrawer: 520,
      difference: 0,
      transactionIds: [],
      cashAdjustmentIds: [],
      operatorId: 'uid-1',
      operatorEmail: 'operator@example.test',
      deviceId: 'pc',
      note: '',
    })).rejects.toMatchObject({ name: 'Error', message: '業務功能暫未開放' });
    expectNoFirestoreActivity();
  });

  it('rejects close attempt promotion without reading or writing Firestore', async () => {
    await expect(promoteCloseAttemptOnline(mockDb, {
      businessDate: '2026-05-16',
      closeAttemptId: 'pc:close:2026-05-16:1',
      summary: {},
    })).rejects.toMatchObject({ name: 'Error', message: '業務功能暫未開放' });
    expectNoFirestoreActivity();
  });

  it('rejects cash adjustments without calling Firestore', async () => {
    await expect(addCashAdjustment(mockDb, {
      id: 'pc:cash:1',
      businessDate: '2026-05-16',
      type: 'deposit',
      amount: 10,
      reason: 'test fixture',
      operatorId: 'uid-1',
      operatorEmail: 'operator@example.test',
      deviceId: 'pc',
    })).rejects.toMatchObject({ name: 'Error', message: '業務功能暫未開放' });
    expectNoFirestoreActivity();
  });
});
