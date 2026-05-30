import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';
import type { TodayMenu, Vendor } from '../../mocks/initialData';

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('menuActions', () => {
  it('M1: setTodayMenu updates the todayMenu in store', () => {
    const store = usePosStore.getState();
    const originalItemName = store.todayMenu.itemName;

    const newMenu: TodayMenu = {
      businessDate: '2026-06-01',
      itemName: '紅燒牛肉麵',
      price: 120,
      vendorId: 'v2',
      vendorNameSnapshot: '池上飯包',
      updatedAt: '2026-06-01T07:30:00Z',
      revision: 1,
    };

    store.setTodayMenu(newMenu);

    const next = usePosStore.getState();
    expect(next.todayMenu.itemName).toBe('紅燒牛肉麵');
    expect(next.todayMenu.itemName).not.toBe(originalItemName);
    expect(next.todayMenu.price).toBe(120);
    expect(next.todayMenu.vendorId).toBe('v2');
  });

  it('M2: setVendors replaces the vendors list', () => {
    const store = usePosStore.getState();
    const originalCount = store.vendors.length;

    const newVendors: Vendor[] = [
      { vendorId: 'v9', name: '測試便當店', phone: '0911-111-111', note: '', status: 'active', createdAt: '', updatedAt: '', revision: 1 },
    ];

    store.setVendors(newVendors);

    const next = usePosStore.getState();
    expect(next.vendors).toHaveLength(1);
    expect(next.vendors).not.toHaveLength(originalCount);
    expect(next.vendors[0].name).toBe('測試便當店');
  });

  it('M3: resetData restores all state to initial values', () => {
    const store = usePosStore.getState();
    const originalMenuName = store.todayMenu.itemName;
    const originalStudentCount = store.students.length;

    // Mutate state
    store.setTodayMenu({
      businessDate: '2026-06-01',
      itemName: '紅燒牛肉麵',
      price: 120,
      vendorId: 'v2',
      vendorNameSnapshot: '池上飯包',
      updatedAt: '2026-06-01T07:30:00Z',
      revision: 1,
    });
    store.openCashSession({
      businessDate: '2026-06-01',
      openingCash: 5000,
      operatorId: 'counter',
      openedAt: '2026-06-01T08:00:00.000Z',
    });
    store.processTransaction('001', 'order', 90, 0);

    // Verify mutation happened
    expect(usePosStore.getState().todayMenu.itemName).toBe('紅燒牛肉麵');
    expect(usePosStore.getState().transactions.length).toBeGreaterThan(0);

    // Reset
    store.resetData();

    const next = usePosStore.getState();
    expect(next.todayMenu.itemName).toBe(originalMenuName);
    expect(next.students).toHaveLength(originalStudentCount);
    expect(next.transactions).toHaveLength(0);
    expect(next.cashSessions).toEqual({});
    expect(next.auditEvents).toHaveLength(0);
    expect(next.dailySettlements).toHaveLength(0);
  });
});
