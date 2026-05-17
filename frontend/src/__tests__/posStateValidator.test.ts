import { describe, it, expect } from 'vitest';
import { validatePersistedState, migrateState } from '../storage/posStateValidator';

describe('posStateValidator — state migration', () => {
  it('migrates topup type to payment', () => {
    const oldState = {
      students: [
        { studentId: 's1', displayName: 'Alice', status: 'active', currentBalance: 50, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
      ],
      transactions: [
        { transactionId: 'tx1', businessDate: '2026-05-17', createdAt: '2026-05-17T08:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'topup', mealPrice: 0, paidAmount: 50, amount: 50, afterBalance: 50, menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '儲值' },
      ],
      vendors: [],
      todayMenu: { businessDate: '2026-05-17', itemName: '便當', price: 90, vendorId: 'v1', vendorNameSnapshot: 'Vendor A', updatedAt: '2026-05-17T00:00:00Z', revision: 1 },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    };

    const result = migrateState(oldState);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const tx = result.state.transactions.find((t) => t.transactionId === 'tx1');
      expect(tx).toBeDefined();
      expect(tx.type).toBe('payment');
    }
  });

  it('drops cancel/correction/void records', () => {
    const oldState = {
      students: [
        { studentId: 's1', displayName: 'Alice', status: 'active', currentBalance: 90, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
      ],
      transactions: [
        { transactionId: 'tx1', businessDate: '2026-05-17', createdAt: '2026-05-17T08:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, menuNameSnapshot: '便當', vendorNameSnapshot: 'Vendor A', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '便當' },
        { transactionId: 'tx2', businessDate: '2026-05-17', createdAt: '2026-05-17T09:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'cancel', mealPrice: 90, paidAmount: 0, amount: 90, afterBalance: 0, menuNameSnapshot: '便當', vendorNameSnapshot: 'Vendor A', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '' },
        { transactionId: 'tx3', businessDate: '2026-05-17', createdAt: '2026-05-17T10:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'correction', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: -100, menuNameSnapshot: '便當', vendorNameSnapshot: 'Vendor A', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '' },
      ],
      vendors: [],
      todayMenu: { businessDate: '2026-05-17', itemName: '便當', price: 90, vendorId: 'v1', vendorNameSnapshot: 'Vendor A', updatedAt: '2026-05-17T00:00:00Z', revision: 1 },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    };

    const result = migrateState(oldState);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.transactions.length).toBe(1);
      expect(result.state.transactions[0].type).toBe('order');
    }
  });

  it('recalculates student balances from 0 after migration', () => {
    const oldState = {
      students: [
        { studentId: 's1', displayName: 'Alice', status: 'active', currentBalance: -90, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
      ],
      transactions: [
        { transactionId: 'tx1', businessDate: '2026-05-17', createdAt: '2026-05-17T08:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'order', mealPrice: 90, paidAmount: 50, amount: -40, afterBalance: -40, menuNameSnapshot: '便當', vendorNameSnapshot: 'Vendor A', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '便當' },
        { transactionId: 'tx2', businessDate: '2026-05-17', createdAt: '2026-05-17T09:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'topup', mealPrice: 0, paidAmount: 100, amount: 100, afterBalance: 60, menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '儲值' },
      ],
      vendors: [],
      todayMenu: { businessDate: '2026-05-17', itemName: '便当', price: 90, vendorId: 'v1', vendorNameSnapshot: 'Vendor A', updatedAt: '2026-05-17T00:00:00Z', revision: 1 },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    };

    const result = migrateState(oldState);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const s1 = result.state.students.find((s) => s.studentId === 's1');
      expect(s1).toBeDefined();
      // order: -40 (mealPrice=90, paidAmount=50), payment: +100 (paidAmount=100)
      // total: -40 + 100 = 60
      expect(s1.currentBalance).toBe(60);
    }
  });

  it('idempotent — migrating already migrated state is safe', () => {
    const oldState = {
      students: [
        { studentId: 's1', displayName: 'Alice', status: 'active', currentBalance: 50, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
      ],
      transactions: [
        { transactionId: 'tx1', businessDate: '2026-05-17', createdAt: '2026-05-17T08:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'order', mealPrice: 90, paidAmount: 50, amount: -40, afterBalance: -40, menuNameSnapshot: '便当', vendorNameSnapshot: 'Vendor A', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '' },
      ],
      vendors: [],
      todayMenu: { businessDate: '2026-05-17', itemName: '便当', price: 90, vendorId: 'v1', vendorNameSnapshot: 'Vendor A', updatedAt: '2026-05-17T00:00:00Z', revision: 1 },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    };

    const once = migrateState(oldState);
    expect(once.ok).toBe(true);
    if (once.ok) {
      const twice = migrateState(once.state);
      expect(twice.ok).toBe(true);
      if (twice.ok) {
        expect(twice.state.transactions.length).toBe(once.state.transactions.length);
        expect(twice.state.students[0].currentBalance).toBe(once.state.students[0].currentBalance);
      }
    }
  });

  it('migration does nothing when schemaVersion is already current', () => {
    const state = {
      schemaVersion: 2,
      students: [],
      transactions: [],
      vendors: [],
      todayMenu: { businessDate: '2026-05-17', itemName: '便当', price: 90, vendorId: 'v1', vendorNameSnapshot: 'V', updatedAt: '2026-05-17T00:00:00Z', revision: 1 },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    };

    const result = migrateState(state);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.schemaVersion).toBe(2);
    }
  });

  it('validation still works after migration', () => {
    const oldState = {
      students: [
        { studentId: 's1', displayName: 'Alice', status: 'active', currentBalance: -90, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 },
      ],
      transactions: [
        { transactionId: 'tx1', businessDate: '2026-05-17', createdAt: '2026-05-17T08:00:00Z', studentId: 's1', studentNameSnapshot: 'Alice', type: 'cancel', mealPrice: 90, paidAmount: 0, amount: 90, afterBalance: 0, menuNameSnapshot: '便当', vendorNameSnapshot: 'Vendor A', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '' },
      ],
      vendors: [],
      todayMenu: { businessDate: '2026-05-17', itemName: '便当', price: 90, vendorId: 'v1', vendorNameSnapshot: 'Vendor A', updatedAt: '2026-05-17T00:00:00Z', revision: 1 },
      auditEvents: [],
      dailySettlements: [],
      businessDateStatuses: {},
      cashSessions: {},
    };

    const migrationResult = migrateState(oldState);
    expect(migrationResult.ok).toBe(true);
    if (migrationResult.ok) {
      const validationResult = validatePersistedState(migrationResult.state);
      expect(validationResult.ok).toBe(true);
    }
  });
});
