import { describe, expect, it } from 'vitest';
import { buildTransactionDoc, validateStudentDoc } from '../firestoreSchema';

describe('firestoreSchema', () => {
  it('keeps Firestore field names camelCase to match domain types', () => {
    const tx = buildTransactionDoc({
      id: 'tx-1',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 0,
      balanceAfter: 100,
      clientBalanceAfterPreview: 100,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-1',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
    });

    expect(tx).toHaveProperty('studentId', '015');
    expect(tx).not.toHaveProperty('student_id');
    expect(tx.id).toBe('tx-1');
  });

  it('requires positive revision and a known student status', () => {
    expect(validateStudentDoc({ id: '015', displayName: '王小明', status: 'active', revision: 1 })).toEqual({ ok: true });
    expect(validateStudentDoc({ id: '015', displayName: '王小明', status: 'deleted', revision: 1 })).toEqual({ ok: false, reason: 'invalid status' });
  });
});
