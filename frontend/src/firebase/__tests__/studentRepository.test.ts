import { describe, expect, it } from 'vitest';
import { buildStudentDoc } from '../studentRepository';

describe('studentRepository', () => {
  it('builds a Firestore student doc from import row data', () => {
    const doc = buildStudentDoc({
      studentId: '015',
      displayName: '王小明',
      openingBalance: 500,
      operatorId: 'uid-1',
    });

    expect(doc).toMatchObject({
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
});
