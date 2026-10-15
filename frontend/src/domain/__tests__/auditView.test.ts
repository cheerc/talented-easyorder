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
});
