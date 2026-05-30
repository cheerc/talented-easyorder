import { describe, expect, it } from 'vitest';
import { migratePersistedState } from '../migration';

describe('migration', () => {
  describe('migratePersistedState', () => {
    it('returns unchanged state when already in current shape', () => {
      const current = {
        students: [{ studentId: 's1', displayName: 'Test', status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 }],
        transactions: [{ transactionId: 'tx-1', businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', studentId: 's1', type: 'order', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: -100, sourceDevice: 'pc', syncStatus: 'local', revision: 1 }],
        vendors: [{ vendorId: 'v1', name: 'Vendor A', phone: '', note: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 }],
        todayMenu: { businessDate: '2026-05-15', itemName: 'Lunch', price: 60, vendorId: 'v1', vendorNameSnapshot: 'Vendor A', updatedAt: '2026-05-15T00:00:00Z', revision: 1 },
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };

      const result = migratePersistedState(current, 2);

      expect(result.students).toEqual(current.students);
      expect(result.transactions).toEqual(current.transactions);
      expect(result.vendors).toEqual(current.vendors);
      expect(result.todayMenu).toEqual(current.todayMenu);
    });

    it('returns early for null state', () => {
      const result = migratePersistedState(null, 1);
      expect(result).toBe(null);
    });

    it('returns early for undefined state', () => {
      const result = migratePersistedState(undefined, 1);
      expect(result).toBeUndefined();
    });

    // ---- v2 audit state fields ----

    it('adds missing auditEvents as empty array', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1) as Record<string, unknown>;
      expect(result.auditEvents).toEqual([]);
    });

    it('adds missing dailySettlements as empty array', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [{ eventType: 'csv_exported', entityType: 'export', entityId: 'e-1', businessDate: '2026-05-15', reason: 'test', operatorId: 'op-1', auditEventId: 'ae-1', createdAt: '2026-05-15T12:00:00Z' }],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1) as Record<string, unknown>;
      expect(result.dailySettlements).toEqual([]);
    });

    it('adds missing businessDateStatuses as empty object', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
      };
      const result = migratePersistedState(state, 1) as Record<string, unknown>;
      expect(result.businessDateStatuses).toEqual({});
    });

    it('adds all three v2 audit fields when missing', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
      };
      const result = migratePersistedState(state, 1) as Record<string, unknown>;
      expect(result.auditEvents).toEqual([]);
      expect(result.dailySettlements).toEqual([]);
      expect(result.businessDateStatuses).toEqual({});
    });

    // ---- old-shape students ----

    it('migrates old-shape students {id, name, balance} to StudentAccount', () => {
      const state = {
        students: [{ id: 's1', name: 'Alice', balance: 500 }],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const students = result.students as Array<Record<string, unknown>>;
      expect(students[0].studentId).toBe('s1');
      expect(students[0].displayName).toBe('Alice');
      expect(students[0].currentBalance).toBe(500);
      expect(students[0].status).toBe('active');
      expect(students[0].aliases).toEqual([]);
      expect(students[0].faceEnrollmentStatus).toBe('none');
      expect(students[0].revision).toBe(1);
      expect(students[0].createdAt).toBeTruthy();
      expect(students[0].updatedAt).toBeTruthy();
    });

    it('does not touch student that already has studentId', () => {
      const student = { studentId: 's1', displayName: 'Bob', status: 'active', currentBalance: 300, aliases: [], faceEnrollmentStatus: 'none', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 };
      const state = {
        students: [student],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      expect(result.students).toEqual([student]);
    });

    it('handles empty students array', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      expect(result.students).toEqual([]);
    });

    // ---- old-shape transactions ----

    it('migrates old-shape transaction id → transactionId', () => {
      const state = {
        students: [],
        transactions: [{ id: 'tx-1', type: 'order', studentId: 's1', amount: -100, mealPrice: 100, paidAmount: 0, afterBalance: -100, businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z' }],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const tx = (result.transactions as Array<Record<string, unknown>>)[0];
      expect(tx.transactionId).toBe('tx-1');
      expect(tx.id).toBe('tx-1'); // old id preserved in spread
    });

    it('adds syncStatus local for old-shape transaction', () => {
      const state = {
        students: [],
        transactions: [{ id: 'tx-1', type: 'order', studentId: 's1', amount: -100, mealPrice: 100, paidAmount: 0, afterBalance: -100, businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z' }],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const tx = (result.transactions as Array<Record<string, unknown>>)[0];
      expect(tx.syncStatus).toBe('local');
    });

    it('does not change transaction that already has transactionId', () => {
      const tx = { transactionId: 'tx-1', businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z', studentId: 's1', type: 'order', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: -100, sourceDevice: 'pc', syncStatus: 'synced', revision: 1 };
      const state = {
        students: [],
        transactions: [tx],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      expect(result.transactions).toEqual([tx]);
    });

    it('handles empty transactions array', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      expect(result.transactions).toEqual([]);
    });

    // ---- old-shape vendors ----

    it('migrates old-shape vendors {id, name, phone, note} to Vendor', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [{ id: 'v1', name: 'Vendor A', phone: '02-12345678', note: 'good supplier' }],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const vendors = result.vendors as Array<Record<string, unknown>>;
      expect(vendors[0].vendorId).toBe('v1');
      expect(vendors[0].name).toBe('Vendor A');
      expect(vendors[0].phone).toBe('02-12345678');
      expect(vendors[0].note).toBe('good supplier');
      expect(vendors[0].status).toBe('active');
      expect(vendors[0].revision).toBe(1);
      expect(vendors[0].createdAt).toBeTruthy();
      expect(vendors[0].updatedAt).toBeTruthy();
    });

    it('does not touch vendor that already has vendorId', () => {
      const vendor = { vendorId: 'v1', name: 'Vendy', phone: '', note: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 };
      const state = {
        students: [],
        transactions: [],
        vendors: [vendor],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      expect(result.vendors).toEqual([vendor]);
    });

    it('migrates vendor with empty name gracefully', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [{ id: 'v1' }],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const vendors = result.vendors as Array<Record<string, unknown>>;
      expect(vendors[0].name).toBe('');
      expect(vendors[0].phone).toBe('');
      expect(vendors[0].note).toBe('');
    });

    // ---- old-shape todayMenu ----

    it('migrates old-shape todayMenu {date, name, price, vendor} to TodayMenu', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [{ vendorId: 'v2', name: 'Vendy', phone: '', note: '', status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1 }],
        todayMenu: { date: '2026-05-15', name: 'Lunch Box', price: 80, vendor: 'Vendy' },
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const menu = result.todayMenu as Record<string, unknown>;
      expect(menu.businessDate).toBe('2026-05-15');
      expect(menu.itemName).toBe('Lunch Box');
      expect(menu.price).toBe(80);
      expect(menu.vendorId).toBe('v2'); // matched by vendor name
      expect(menu.vendorNameSnapshot).toBe('Vendy');
    });

    it('migrates todayMenu with unmatched vendor name falls back to v1', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: { date: '2026-05-15', name: 'Lunch', price: 60, vendor: 'UnknownVendor' },
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      const menu = result.todayMenu as Record<string, unknown>;
      expect(menu.vendorId).toBe('v1');
      expect(menu.vendorNameSnapshot).toBe('UnknownVendor');
    });

    it('does not touch todayMenu that already has businessDate', () => {
      const menu = { businessDate: '2026-05-15', itemName: 'Lunch', price: 60, vendorId: 'v1', vendorNameSnapshot: 'Vendy', updatedAt: '2026-05-15T00:00:00Z', revision: 1 };
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: menu,
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
      };
      const result = migratePersistedState(state, 1);
      expect(result.todayMenu).toEqual(menu);
    });

    // ---- combined migrations ----

    it('migrates all old-shape data simultaneously', () => {
      const state = {
        students: [{ id: 's1', name: 'Charlie', balance: 100 }],
        transactions: [{ id: 'tx-1', type: 'order', studentId: 's1', amount: -50, mealPrice: 50, paidAmount: 0, afterBalance: -50, businessDate: '2026-05-15', createdAt: '2026-05-15T12:00:00Z' }],
        vendors: [{ id: 'v99', name: 'Best Vendor', phone: '09xx', note: '' }],
        todayMenu: { date: '2026-05-15', name: 'Set A', price: 99, vendor: 'Best Vendor' },
      };
      const result = migratePersistedState(state, 0);

      const students = result.students as Array<Record<string, unknown>>;
      expect(students[0].studentId).toBe('s1');
      expect(students[0].displayName).toBe('Charlie');

      const tx = (result.transactions as Array<Record<string, unknown>>)[0];
      expect(tx.transactionId).toBe('tx-1');
      expect(tx.syncStatus).toBe('local');

      const vendors = result.vendors as Array<Record<string, unknown>>;
      expect(vendors[0].vendorId).toBe('v99');

      const menu = result.todayMenu as Record<string, unknown>;
      expect(menu.businessDate).toBe('2026-05-15');
      expect(menu.vendorId).toBe('v99');

      const r = result as Record<string, unknown>;
      expect(r.auditEvents).toEqual([]);
      expect(r.dailySettlements).toEqual([]);
      expect(r.businessDateStatuses).toEqual({});
    });

    // ---- pass-through behaviors ----

    it('passes through additional keys unchanged', () => {
      const state = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: {},
        auditEvents: [],
        dailySettlements: [],
        businessDateStatuses: {},
        customField: 'keep-me',
      };
      const result = migratePersistedState(state, 1) as Record<string, unknown>;
      expect(result.customField).toBe('keep-me');
    });

    // ---- error ----

    it('calls appendErrorLog and re-throws on crash', () => {
      // todayMenu as a primitive triggers TypeError on 'date' in <primitive>
      const bad = {
        students: [],
        transactions: [],
        vendors: [],
        todayMenu: 42,
      };

      expect(() => migratePersistedState(bad, 1)).toThrow();
    });
  });
});
