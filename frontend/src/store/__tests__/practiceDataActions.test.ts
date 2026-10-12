import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';
import { createLocalAccount } from '../../domain/student';
import { validateTodayMenu, validatePersistedState, validateStudentAccount } from '../../storage/posStateValidator';

// M0 S02：空白與範例是分開的起點。

beforeEach(() => {
  usePosStore.getState().loadSampleData();
});

describe('practiceDataActions', () => {
  it('startBlankData clears accounts, vendors, transactions, settlements and menu', () => {
    usePosStore.getState().openCashSession({ businessDate: '2026-10-12', openingCash: 1000, operatorId: 'op', openedAt: '2026-10-12T08:00:00Z' });
    usePosStore.getState().startBlankData();
    const s = usePosStore.getState();
    expect(s.students).toEqual([]);
    expect(s.vendors).toEqual([]);
    expect(s.transactions).toEqual([]);
    expect(s.auditEvents).toEqual([]);
    expect(s.dailySettlements).toEqual([]);
    expect(s.cashSessions).toEqual({});
    expect(s.todayMenu.itemName).toBe('');
    expect(s.todayMenu.price).toBe(0);
  });

  it('loadSampleData restores the fixed sample including vendors', () => {
    usePosStore.getState().startBlankData();
    usePosStore.getState().loadSampleData();
    const s = usePosStore.getState();
    expect(s.students.length).toBe(22);
    expect(s.vendors.length).toBe(4);
    expect(s.todayMenu.price).toBe(90);
  });

  it('addLocalStudent appends a new account and never overwrites an existing id', () => {
    usePosStore.getState().startBlankData();
    const a = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: 200, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
    usePosStore.getState().addLocalStudent(a);
    usePosStore.getState().addLocalStudent({ ...a, displayName: '冒用', currentBalance: 9999 });
    const s = usePosStore.getState();
    expect(s.students).toHaveLength(1);
    expect(s.students[0].displayName).toBe('甲生');
    expect(s.students[0].currentBalance).toBe(200);
  });

  it('blank dataset passes persisted-state validation so reload does not refill the sample', () => {
    usePosStore.getState().startBlankData();
    const s = usePosStore.getState();
    expect(validateTodayMenu(s.todayMenu)).toEqual({ ok: true });
    const persisted = {
      students: s.students, transactions: s.transactions, vendors: s.vendors, todayMenu: s.todayMenu,
      auditEvents: s.auditEvents, dailySettlements: s.dailySettlements,
      businessDateStatuses: s.businessDateStatuses, cashSessions: s.cashSessions,
    };
    expect(validatePersistedState(persisted).ok).toBe(true);
  });

  it('a menu with a name but price 0 is still invalid', () => {
    expect(validateTodayMenu({ businessDate: '', itemName: '晚餐', price: 0, vendorId: '', updatedAt: '', revision: 1 }).ok).toBe(false);
  });

  it('accepts a persisted account with an opening balance and rejects a non-integer one', () => {
    const a = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: -30, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
    expect(validateStudentAccount(a)).toEqual({ ok: true });
    expect(validateStudentAccount({ ...a, openingBalance: { ...a.openingBalance, amount: 1.5 } }).ok).toBe(false);
  });
});
