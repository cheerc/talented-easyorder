import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildStudentDoc, addStudent, disableStudent } from '../studentRepository';
import type { Firestore } from 'firebase/firestore';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  serverTimestamp: vi.fn(() => new Date('2026-06-01T00:00:00.000Z')),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

import { doc, setDoc, updateDoc } from 'firebase/firestore';

const mockDb = {} as Firestore;
const mockDocRef = { _mock: 'doc-ref' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(doc).mockReturnValue(mockDocRef as unknown as ReturnType<typeof doc>);
});

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

  it('addStudent calls setDoc with correct path and built document', async () => {
    const input = {
      studentId: '020',
      displayName: '李小華',
      openingBalance: 300,
      operatorId: 'uid-admin',
    };

    await addStudent(mockDb, input);

    expect(doc).toHaveBeenCalledWith(mockDb, 'students/020');
    expect(setDoc).toHaveBeenCalledWith(mockDocRef, expect.objectContaining({
      id: '020',
      displayName: '李小華',
      openingBalance: 300,
      currentBalance: 300,
      status: 'active',
      revision: 1,
    }));
  });

  it('disableStudent calls updateDoc with inactive status', async () => {
    await disableStudent(mockDb, { studentId: '015', operatorId: 'uid-admin' });

    expect(doc).toHaveBeenCalledWith(mockDb, 'students/015');
    expect(updateDoc).toHaveBeenCalledWith(mockDocRef, {
      status: 'inactive',
      updatedAt: expect.any(Date),
      updatedBy: 'uid-admin',
    });
  });
});
