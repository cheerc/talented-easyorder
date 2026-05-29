import { describe, expect, it } from 'vitest';
import { validatePersistedState } from '../posStateValidator';

const validState = {
  students: [{ studentId: 's1', displayName: 'Test', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 }],
  transactions: [],
  vendors: [],
  todayMenu: { businessDate: '2026-05-15', itemName: '午餐', price: 60, vendorId: 'v1', vendorNameSnapshot: '測試', updatedAt: '2026-05-15T00:00:00Z', revision: 1 },
  auditEvents: [],
  dailySettlements: [],
  businessDateStatuses: {},
};

describe('posStateValidator', () => {
  it('accepts valid persisted state', () => {
    const result = validatePersistedState(validState);
    expect(result.ok).toBe(true);
  });

  it('rejects null', () => {
    const result = validatePersistedState(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('null');
  });

  it('rejects undefined', () => {
    const result = validatePersistedState(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('null');
  });

  it('rejects primitive types', () => {
    const result = validatePersistedState('not-an-object');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('string');
  });

  it('rejects missing required key', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { students: _students, ...missing } = validState;
    const result = validatePersistedState(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('students');
  });

  it('rejects when array key is not an array', () => {
    const bad = { ...validState, transactions: 'not-array' };
    const result = validatePersistedState(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('transactions');
  });

  it('rejects when object key is an array', () => {
    const bad = { ...validState, todayMenu: ['not-object'] };
    const result = validatePersistedState(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('todayMenu');
  });

  it('rejects when object key is null', () => {
    const bad = { ...validState, businessDateStatuses: null };
    const result = validatePersistedState(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('businessDateStatuses');
  });

  describe('deep validation gaps (shallow-only validator)', () => {
    // These tests document the current shallow validation behaviour.
    // validatePersistedState only checks top-level keys and types;
    // it does NOT inspect nested object structure.
    // Tests marked with .skip expose gaps for future fix (#61+#68).

    it('passes when student currentBalance is a string instead of number', () => {
      const bad = {
        ...validState,
        students: [{ ...validState.students[0], currentBalance: 'not-a-number' }],
      };
      const result = validatePersistedState(bad);
      // GAP: shallow validation only checks students is an array, not element shape
      expect(result.ok).toBe(true);
    });

    it.skip('SHOULD reject transaction missing required id field', () => {
      const bad = {
        ...validState,
        transactions: [{ type: 'order', studentId: 's1', amount: -100, mealPrice: 100, paidAmount: 0, afterBalance: -100, businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', menuNameSnapshot: 'lunch', vendorNameSnapshot: 'v', studentNameSnapshot: 'test', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '' }],
      };
      const result = validatePersistedState(bad);
      // GAP: shallow validation only checks transactions is an array — element integrity not verified
      expect(result.ok).toBe(false);
    });

    it('passes when todayMenu has wrong-typed price field', () => {
      const bad = {
        ...validState,
        todayMenu: { ...validState.todayMenu, price: 'not-a-number' },
      };
      const result = validatePersistedState(bad);
      // GAP: shallow validation only checks todayMenu is a non-null object
      expect(result.ok).toBe(true);
    });

    it('passes when businessDateStatuses has corrupt nested values', () => {
      const bad = {
        ...validState,
        businessDateStatuses: { '2026-05-15': 42 },
      };
      const result = validatePersistedState(bad);
      // GAP: shallow validation only checks businessDateStatuses is a non-null object
      expect(result.ok).toBe(true);
    });
  });
});
