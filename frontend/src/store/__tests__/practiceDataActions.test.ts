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

  describe('updateLocalStudent (U3 #3)', () => {
    it('改名與別名時更新學生資料，不改編號', () => {
      usePosStore.getState().startBlankData();
      const a = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: 0, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
      usePosStore.getState().addLocalStudent(a);
      usePosStore.getState().updateLocalStudent('001', { displayName: '甲生改名', aliases: ['A1'] }, '2026-10-12T01:00:00Z');

      const s = usePosStore.getState();
      expect(s.students[0].displayName).toBe('甲生改名');
      expect(s.students[0].aliases).toEqual(['A1']);
      expect(s.students[0].studentId).toBe('001');
    });

    it('改編號時同步改寫交易歷史、稽核紀錄，並新增一筆改號稽核紀錄', () => {
      usePosStore.getState().startBlankData();
      const a = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: 100, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
      usePosStore.getState().addLocalStudent(a);

      // 加入一筆 001 的交易
      usePosStore.setState({
        transactions: [
          {
            transactionId: 'tx-1',
            businessDate: '2026-10-12',
            createdAt: '2026-10-12T10:00:00Z',
            studentId: '001',
            studentNameSnapshot: '甲生',
            menuNameSnapshot: '排骨',
            vendorNameSnapshot: '',
            type: 'order',
            mealPrice: 90,
            paidAmount: 90,
            amount: 0,
            afterBalance: 100,
            sourceDevice: 'pc',
            syncStatus: 'synced',
            revision: 1,
            note: '',
          },
        ],
        auditEvents: [
          {
            auditEventId: 'audit-1',
            eventType: 'transaction_edited',
            entityType: 'transaction',
            entityId: 'tx-1',
            businessDate: '2026-10-12',
            before: { studentId: '001', mealPrice: 80 },
            after: { studentId: '001', mealPrice: 90 },
            reason: '原單更正',
            operatorId: 'op',
            createdAt: '2026-10-12T10:05:00Z',
          },
        ],
      });

      // 執行改號：由 001 改為 008
      usePosStore.getState().updateLocalStudent(
        '001',
        { displayName: '甲生', aliases: [], newStudentId: '008', reason: '學員指定幸運號碼' },
        '2026-10-12T11:00:00Z'
      );

      const s = usePosStore.getState();
      // 1. 學生編號已變更
      expect(s.students.find(x => x.studentId === '008')).toBeDefined();
      expect(s.students.find(x => x.studentId === '001')).toBeUndefined();

      // 2. 交易記錄中的 studentId 已更新
      expect(s.transactions[0].studentId).toBe('008');

      // 3. 原有稽核記錄更新且新增一筆改號稽核紀錄
      const auditOriginal = s.auditEvents.find(e => e.auditEventId === 'audit-1')!;
      expect(auditOriginal.before).toMatchObject({ studentId: '008' });
      expect(auditOriginal.after).toMatchObject({ studentId: '008' });

      const auditNew = s.auditEvents.find(e => e.auditEventId.startsWith('audit-change-code-'))!;
      expect(auditNew).toBeDefined();
      expect(auditNew.reason).toBe('學員指定幸運號碼');
      expect(auditNew.before).toMatchObject({ studentId: '001', displayName: '甲生' });
      expect(auditNew.after).toMatchObject({ studentId: '008', displayName: '甲生' });
    });

    it('新編號已被其他帳戶占用時阻擋不變更', () => {
      usePosStore.getState().startBlankData();
      const a1 = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: 0, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
      const a2 = createLocalAccount({ studentId: '002', displayName: '乙生', openingBalance: 0, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
      usePosStore.getState().addLocalStudent(a1);
      usePosStore.getState().addLocalStudent(a2);

      // 嘗試將 001 改成已存在的 002
      usePosStore.getState().updateLocalStudent(
        '001',
        { displayName: '甲生', aliases: [], newStudentId: '002', reason: '搶號' },
        '2026-10-12T11:00:00Z'
      );

      const s = usePosStore.getState();
      expect(s.students.find(x => x.studentId === '001')?.displayName).toBe('甲生');
      expect(s.students.find(x => x.studentId === '002')?.displayName).toBe('乙生');
    });
  });
});
