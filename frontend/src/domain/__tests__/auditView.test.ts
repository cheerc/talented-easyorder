import { describe, it, expect } from 'vitest';
import { describeAuditEvents, matchesAuditQuery, type AuditAccountInfo } from '../auditView';
import type { LedgerAuditEvent } from '../ledgerAudit';

describe('describeAuditEvents and matchesAuditQuery (U3 Review Finding 3)', () => {
  const currentAccounts: AuditAccountInfo[] = [
    { studentId: '007', displayName: '王小明', aliases: ['Ming'] },
    { studentId: '005', displayName: '新生李四' }, // 舊號 005 後續給了別人
  ];

  const codeChangeEvent: LedgerAuditEvent = {
    auditEventId: 'audit-code-1',
    eventType: 'student_code_changed',
    entityType: 'student',
    entityId: '007',
    businessDate: '2026-10-15',
    studentId: '007',
    before: { studentId: '005', displayName: '王小明' },
    after: { studentId: '007', displayName: '王小明' },
    reason: '學員指定號碼',
    operatorId: 'op-1',
    createdAt: '2026-10-15T10:00:00.000Z',
  };

  it('改號事件正確歸屬於新帳戶（007），顯示「改編號」與變更內容，且不產生虛構交易 ID', () => {
    const rows = describeAuditEvents([codeChangeEvent], [], currentAccounts);
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.typeLabel).toBe('改編號');
    expect(row.studentId).toBe('007');
    expect(row.subject).toContain('007 王小明');
    expect(row.changes).toBe('編號 005 → 007');
    expect(row.reason).toBe('學員指定號碼');
    expect(row.transactionId).toBeUndefined(); // 不虛構交易 ID
  });

  it('改號事件可用新號（007）、舊號（005）或目前姓名/別名搜尋到', () => {
    const rows = describeAuditEvents([codeChangeEvent], [], currentAccounts);
    const row = rows[0];

    // 以新號 007 查詢
    expect(matchesAuditQuery(row, '007')).toBe(true);
    // 以舊號 005 查詢
    expect(matchesAuditQuery(row, '005')).toBe(true);
    // 以姓名查詢
    expect(matchesAuditQuery(row, '王小明')).toBe(true);
    // 以別名查詢
    expect(matchesAuditQuery(row, 'Ming')).toBe(true);
    // U3 Review Finding 3: 以年份（如 2026）做純數字查詢時，不撞到營業日，不會誤匹配為帳戶
    expect(matchesAuditQuery(row, '2026')).toBe(false);
    // 無關查詢查不到
    expect(matchesAuditQuery(row, '999')).toBe(false);
  });

  // ac 複審（55b8421）：改號事件必須以頂層目前 studentId／entityId 歸戶，
  // before/after 只供變更文字與歷史號碼查詢，不可拿來決定目前歸屬。
  describe('多次改號 + 舊號被他人重用', () => {
    const accountsAfterChain: AuditAccountInfo[] = [
      { studentId: '009', displayName: '甲生改名', aliases: ['A1'] },
      { studentId: '007', displayName: '乙生' },
    ];

    // 甲 005 -> 007 -> 009（後續改名並加別名），乙接手甲空出的 007。
    const firstChange: LedgerAuditEvent = {
      auditEventId: 'audit-code-1',
      eventType: 'student_code_changed',
      entityType: 'student',
      entityId: '009',
      businessDate: '2026-10-15',
      studentId: '009',
      before: { studentId: '005', displayName: '甲生' },
      after: { studentId: '007', displayName: '甲生' },
      reason: '甲第一次改號',
      operatorId: 'op-1',
      createdAt: '2026-10-15T10:00:00.000Z',
    };

    const rows = describeAuditEvents([firstChange], [], accountsAfterChain);
    const row = rows[0];

    it('改號事件歸屬於目前帳戶（頂層 studentId 009），不是事件當下的新號 007', () => {
      expect(row.studentId).toBe('009');
      expect(row.subject).toBe('009 甲生改名');
      expect(row.subject).not.toContain('007');
    });

    it('仍以目前姓名與別名搜尋得到', () => {
      expect(matchesAuditQuery(row, '009')).toBe(true);
      expect(matchesAuditQuery(row, '甲生改名')).toBe(true);
      expect(matchesAuditQuery(row, 'a1')).toBe(true);
    });

    it('歷史號碼 005／007 仍可用純數字查詢命中', () => {
      expect(matchesAuditQuery(row, '005')).toBe(true);
      expect(matchesAuditQuery(row, '007')).toBe(true);
    });

    it('變更文字仍呈現當時的編號變化，且不撞其他帳戶的目前姓名', () => {
      expect(row.changes).toBe('編號 005 → 007');
      expect(matchesAuditQuery(row, '乙生')).toBe(false);
    });
  });
});
