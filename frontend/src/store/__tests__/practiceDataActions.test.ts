import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';
import { createLocalAccount } from '../../domain/student';
import { validateTodayMenu, validatePersistedState, validateStudentAccount } from '../../storage/posStateValidator';
import { buildSnapshot, pickDataset, parseSnapshot } from '../../domain/practiceSnapshot';

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
      expect(auditNew.eventType).toBe('student_code_changed');
      expect(auditNew.entityType).toBe('student');
      expect(auditNew.entityId).toBe('008');
      expect(auditNew.studentId).toBe('008');
      expect(auditNew.reason).toBe('學員指定幸運號碼');
      expect(auditNew.before).toMatchObject({ studentId: '001', displayName: '甲生' });
      expect(auditNew.after).toMatchObject({ studentId: '008', displayName: '甲生' });

      // U3 Review Finding 3: 舊號 001 後續若再分配給新生，改號稽核紀錄仍正確歸屬於 008，不混淆給新生
      const newStudent001 = createLocalAccount({ studentId: '001', displayName: '新生小王', openingBalance: 0, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T12:00:00Z');
      usePosStore.getState().addLocalStudent(newStudent001);
      const afterState = usePosStore.getState();
      const codeChangeEvent = afterState.auditEvents.find(e => e.auditEventId.startsWith('audit-change-code-'))!;
      expect(codeChangeEvent.studentId).toBe('008');
      expect(codeChangeEvent.studentId).not.toBe('001');
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

    it('U3 Review Finding 1: 改號後快照匯出與還原可成功通過驗證，不被重置回範例資料', () => {
      usePosStore.getState().startBlankData();
      const a = createLocalAccount({ studentId: '005', displayName: '五號', openingBalance: 100, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
      usePosStore.getState().addLocalStudent(a);
      usePosStore.getState().updateLocalStudent(
        '005',
        { displayName: '五號改七號', aliases: [], newStudentId: '007', reason: '改號驗證' },
        '2026-10-12T01:00:00Z'
      );

      const state = usePosStore.getState();
      expect(validatePersistedState(state).ok).toBe(true);

      const snapshot = buildSnapshot(pickDataset(state), '2026-10-12T02:00:00Z');
      const text = JSON.stringify(snapshot);
      const parsed = parseSnapshot(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        usePosStore.getState().restoreDataset(parsed.snapshot.data);
      }
      const restored = usePosStore.getState();
      expect(restored.students).toHaveLength(1);
      expect(restored.students[0].studentId).toBe('007');
      expect(restored.auditEvents.some(e => e.eventType === 'student_code_changed')).toBe(true);
    });

    it('U3 Review Finding 2: 同一人多次改號與他人重用舊號時，歷史改號快照不被覆寫污染', () => {
      usePosStore.getState().startBlankData();
      const a = createLocalAccount({ studentId: '005', displayName: '甲生', openingBalance: 100, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
      usePosStore.getState().addLocalStudent(a);

      // 甲 005 -> 007
      usePosStore.getState().updateLocalStudent(
        '005',
        { displayName: '甲生', aliases: [], newStudentId: '007', reason: '甲第一次改號' },
        '2026-10-12T01:00:00Z'
      );

      // 甲 007 -> 009
      usePosStore.getState().updateLocalStudent(
        '007',
        { displayName: '甲生', aliases: [], newStudentId: '009', reason: '甲第二次改號' },
        '2026-10-12T02:00:00Z'
      );

      // 乙 使用空出的 005，隨後 005 -> 008
      const b = createLocalAccount({ studentId: '005', displayName: '乙生', openingBalance: 200, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T03:00:00Z');
      usePosStore.getState().addLocalStudent(b);
      usePosStore.getState().updateLocalStudent(
        '005',
        { displayName: '乙生', aliases: [], newStudentId: '008', reason: '乙改號' },
        '2026-10-12T04:00:00Z'
      );

      const s = usePosStore.getState();
      const codeEvents = s.auditEvents.filter(e => e.eventType === 'student_code_changed');
      expect(codeEvents).toHaveLength(3);

      // 甲的第一次改號：快照必須是 005 -> 007，不可被改為 008 -> 007 或 005 -> 009，目前歸屬應為 009
      const event1 = codeEvents.find(e => e.reason === '甲第一次改號')!;
      expect(event1.before).toMatchObject({ studentId: '005' });
      expect(event1.after).toMatchObject({ studentId: '007' });
      expect(event1.entityId).toBe('009');
      expect(event1.studentId).toBe('009');

      // 甲的第二次改號：快照必須是 007 -> 009
      const event2 = codeEvents.find(e => e.reason === '甲第二次改號')!;
      expect(event2.before).toMatchObject({ studentId: '007' });
      expect(event2.after).toMatchObject({ studentId: '009' });
      expect(event2.entityId).toBe('009');
      expect(event2.studentId).toBe('009');

      // 乙的改號：快照為 005 -> 008，歸屬 008
      const event3 = codeEvents.find(e => e.reason === '乙改號')!;
      expect(event3.before).toMatchObject({ studentId: '005' });
      expect(event3.after).toMatchObject({ studentId: '008' });
      expect(event3.entityId).toBe('008');
      expect(event3.studentId).toBe('008');
    });
  });
});
