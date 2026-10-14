import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildStudentDoc, addStudent, disableStudent } from '../studentRepository';
import type { Firestore } from 'firebase/firestore';

const mockFirestore = vi.hoisted(() => {
  const mockDocRef = { _mock: 'doc-ref' };
  const batch = { set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn() };
  const sdk = {
    doc: vi.fn(() => mockDocRef),
    serverTimestamp: vi.fn(() => new Date('2026-06-01T00:00:00.000Z')),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    deleteDoc: vi.fn(),
    runTransaction: vi.fn(),
    writeBatch: vi.fn(() => batch),
    increment: vi.fn(),
  };
  return { sdk, batch, mockDocRef };
});

vi.mock('../firebaseModules', () => ({
  getFirestoreMod: vi.fn(() => mockFirestore.sdk),
}));

import { getFirestoreMod } from '../firebaseModules';

const mockDb = {} as Firestore;

beforeEach(() => {
  vi.clearAllMocks();
});

function expectNoFirestoreActivity() {
  expect(getFirestoreMod).not.toHaveBeenCalled();
  for (const method of Object.values(mockFirestore.sdk)) {
    expect(method).not.toHaveBeenCalled();
  }
  expect(mockFirestore.batch.set).not.toHaveBeenCalled();
  expect(mockFirestore.batch.update).not.toHaveBeenCalled();
  expect(mockFirestore.batch.delete).not.toHaveBeenCalled();
  expect(mockFirestore.batch.commit).not.toHaveBeenCalled();
}

describe('studentRepository', () => {
  it('builds a Firestore student doc from import row data', () => {
    const docData = buildStudentDoc({
      studentId: '015',
      displayName: '王小明',
      openingBalance: 500,
      operatorId: 'uid-1',
    });

    expect(docData).toMatchObject({
      id: '015',
      displayName: '王小明',
      openingBalance: 500,
      currentBalance: 500,
      status: 'active',
      revision: 1,
      lastTransactionId: null,
      updatedBy: 'uid-1',
    });
  });

  it('rejects addStudent without calling Firestore', async () => {
    const input = {
      studentId: '020',
      displayName: '李小華',
      openingBalance: 300,
      operatorId: 'uid-admin',
    };

    await expect(addStudent(mockDb, input)).rejects.toMatchObject({
      name: 'Error',
      message: '業務功能暫未開放',
    });

    expectNoFirestoreActivity();
  });

  it('rejects disableStudent without calling Firestore', async () => {
    await expect(disableStudent(mockDb, { studentId: '015', operatorId: 'uid-admin' }))
      .rejects.toMatchObject({ name: 'Error', message: '業務功能暫未開放' });

    expectNoFirestoreActivity();
  });
});
