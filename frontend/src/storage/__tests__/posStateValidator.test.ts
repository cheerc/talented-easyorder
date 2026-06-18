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
  cashSessions: {},
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

  describe('skipDeepValidation', () => {
    it('accepts valid state with skipDeepValidation', () => {
      const result = validatePersistedState(validState, { skipDeepValidation: true });
      expect(result.ok).toBe(true);
    });

    it('still rejects missing required key with skipDeepValidation', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { students: _s, ...missing } = validState;
      const result = validatePersistedState(missing, { skipDeepValidation: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('students');
    });

    it('still rejects wrong type with skipDeepValidation', () => {
      const bad = { ...validState, transactions: 'not-array' };
      const result = validatePersistedState(bad, { skipDeepValidation: true });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('transactions');
    });

    it('skips deep field validation with skipDeepValidation', () => {
      const bad = {
        ...validState,
        students: [{ ...validState.students[0], currentBalance: 'not-a-number' }],
      };
      const result = validatePersistedState(bad, { skipDeepValidation: true });
      expect(result.ok).toBe(true);
    });

    it('still catches deep field validation without skipDeepValidation (default)', () => {
      const bad = {
        ...validState,
        students: [{ ...validState.students[0], currentBalance: 'not-a-number' }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('currentBalance');
    });
  });

  describe('deep validation', () => {
    it('rejects student with currentBalance as string', () => {
      const bad = {
        ...validState,
        students: [{ ...validState.students[0], currentBalance: 'not-a-number' }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('currentBalance');
    });

    it('rejects student missing studentId', () => {
      const s = { ...validState.students[0] };
      delete (s as Record<string, unknown>).studentId;
      const bad = { ...validState, students: [s] };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('studentId');
    });

    it('rejects transaction with mealPrice as string', () => {
      const bad = {
        ...validState,
        transactions: [{ transactionId: 'tx-1', businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', studentId: 's1', type: 'order', mealPrice: 'not-a-number', paidAmount: 0, amount: -100, afterBalance: -100, sourceDevice: 'pc', syncStatus: 'local', revision: 1 }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('mealPrice');
    });

    it('rejects transaction missing transactionId', () => {
      const bad = {
        ...validState,
        transactions: [{ type: 'order', studentId: 's1', amount: -100, mealPrice: 100, paidAmount: 0, afterBalance: -100, businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', menuNameSnapshot: 'lunch', vendorNameSnapshot: 'v', studentNameSnapshot: 'test', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '' }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('transactionId');
    });

    it('rejects transaction with invalid type', () => {
      const bad = {
        ...validState,
        transactions: [{ transactionId: 'tx-1', businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', studentId: 's1', type: 'invalid', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: -100, sourceDevice: 'pc', syncStatus: 'local', revision: 1 }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('type');
    });

    it('rejects todayMenu with price as string', () => {
      const bad = {
        ...validState,
        todayMenu: { ...validState.todayMenu, price: 'not-a-number' },
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('todayMenu');
    });

    it('rejects todayMenu missing businessDate', () => {
      const m = { ...validState.todayMenu };
      delete (m as Record<string, unknown>).businessDate;
      const bad = { ...validState, todayMenu: m };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('businessDate');
    });

    it('rejects auditEvent missing auditEventId', () => {
      const bad = {
        ...validState,
        auditEvents: [{ eventType: 'transaction_edited', entityType: 'transaction', entityId: 'e-1', businessDate: '2026-05-15', reason: 'test', operatorId: 'op-1', createdAt: '2026-05-15T12:00:00Z' }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('auditEventId');
    });

    it('rejects vendor with missing name', () => {
      const bad = {
        ...validState,
        vendors: [{ vendorId: 'v1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1, status: 'active' }],
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('name');
    });

    it('accepts all elements valid', () => {
      const result = validatePersistedState(validState);
      expect(result.ok).toBe(true);
    });

    it('accepts large transaction array (full-scan validation)', () => {
      const tx = { transactionId: 'tx-1', businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', studentId: 's1', type: 'order', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: -100, sourceDevice: 'pc', syncStatus: 'local', revision: 1 };
      const txs = Array.from({ length: 200 }, (_, i) => ({ ...tx, transactionId: `tx-${i}` }));
      const bad = { ...validState, transactions: txs };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(true);
    });

    it('rejects when businessDateStatuses has invalid nested values', () => {
      const bad = {
        ...validState,
        businessDateStatuses: { '2026-05-15': 42 },
      };
      const result = validatePersistedState(bad);
      expect(result.ok).toBe(false);
    });

    it('accepts when businessDateStatuses has valid nested values', () => {
      const good = {
        ...validState,
        businessDateStatuses: { '2026-05-15': 'closed', '2026-05-16': 'open' },
      };
      const result = validatePersistedState(good);
      expect(result.ok).toBe(true);
    });

    it('rejects student missing studentId even when Object.prototype has it (prototype pollution)', () => {
      (Object.prototype as Record<string, unknown>).studentId = 'polluted';
      try {
        const s = { ...validState.students[0] };
        delete (s as Record<string, unknown>).studentId;
        const bad = { ...validState, students: [s] };
        const result = validatePersistedState(bad);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('studentId');
      } finally {
        delete (Object.prototype as Record<string, unknown>).studentId;
      }
    });
  });
});
