import { describe, it, expect } from 'vitest';
import { buildLookupRows, balanceAtEndOf, findLookupAccountIds } from '../transactionLookup';
import { CASHIER_SENTINEL, type LedgerTransaction } from '../ledger';
import type { LedgerAuditEvent } from '../ledgerAudit';
import type { StudentAccount } from '../student';

const acct = (id: string, name: string, extra: Partial<StudentAccount> = {}): StudentAccount => ({
  studentId: id, displayName: name, status: 'active', currentBalance: 0, aliases: [], faceEnrollmentStatus: 'none',
  createdAt: '', updatedAt: '', revision: 1, ...extra,
});
const tx = (id: string, sid: string, date: string, time: string, type: LedgerTransaction['type'], meal: number, paid: number, after: number): LedgerTransaction => ({
  transactionId: id, businessDate: date, createdAt: `${date}T${time}:00.000Z`, studentId: sid, studentNameSnapshot: sid === '002' ? '測試乙' : '測試甲',
  type, mealPrice: meal, paidAmount: paid, amount: paid - meal, afterBalance: after, menuNameSnapshot: '', vendorNameSnapshot: '',
  sourceDevice: 'pc', operatorId: 'x', syncStatus: 'local', revision: 1, note: '',
} as LedgerTransaction);

// 手算：乙期初 0；10/12 訂 90 收 0 → −90；10/13 繳 100 → 10（後來從 100 更正為 120 → 30）；10/13 另一筆繳 50 已刪除。
const transactions = [
  tx('t3', '002', '2026-10-13', '10:00', 'payment', 0, 120, 30),
  tx('t1', '002', '2026-10-12', '10:00', 'order', 90, 0, -90),
  tx('t0', '001', '2026-10-12', '09:00', 'order', 90, 0, 110),
  tx('tc', CASHIER_SENTINEL, '2026-10-13', '11:00', 'expense', 270, 0, 0),
];
const audit: LedgerAuditEvent[] = [
  { auditEventId: 'a1', eventType: 'transaction_edited', entityType: 'transaction', entityId: 't3', businessDate: '2026-10-13',
    before: { paidAmount: 100 }, after: { paidAmount: 120 }, reason: '誤記', operatorId: 'x', createdAt: '2026-10-13T10:05:00.000Z' },
  { auditEventId: 'a2', eventType: 'transaction_deleted', entityType: 'transaction', entityId: 't4', businessDate: '2026-10-13',
    before: { transactionId: 't4', businessDate: '2026-10-13', createdAt: '2026-10-13T10:30:00.000Z', studentId: '002', studentNameSnapshot: '測試乙', type: 'payment', mealPrice: 0, paidAmount: 50, note: '' },
    after: null, reason: '送出後立即撤回', operatorId: 'x', createdAt: '2026-10-13T10:30:05.000Z' },
];
const students = [acct('001', '測試甲', { aliases: ['阿甲'] }), acct('002', '測試乙', { currentBalance: 30, status: 'inactive' })];

describe('M3 F5 交易查詢（D05）', () => {
  it('帳戶查詢：編號完全相同優先；姓名、別名都找得到；停用帳戶也找得到；「櫃台」找櫃台收支；空白是全部', () => {
    expect(findLookupAccountIds(students, '002')).toEqual(['002']);
    expect(findLookupAccountIds(students, '阿甲')).toEqual(['001']);
    expect(findLookupAccountIds(students, '測試')).toEqual(['001', '002']);
    expect(findLookupAccountIds(students, '櫃台')).toEqual([CASHIER_SENTINEL]);
    expect(findLookupAccountIds(students, ' ')).toBeNull();
    expect(findLookupAccountIds(students, '無此人')).toEqual([]);
  });

  it('依帳戶與區間列出，舊的在前；已刪除的原單從稽核找回並標示；更正次數', () => {
    const rows = buildLookupRows({ transactions, auditEvents: audit, accountIds: ['002'], start: '2026-10-12', end: '2026-10-13' });
    expect(rows.map(r => [r.transactionId, r.afterBalance, r.deleted, r.auditCount])).toEqual([
      ['t1', -90, false, 0],
      ['t3', 30, false, 1],
      ['t4', null, true, 1],
    ]);
    expect(rows[2]).toMatchObject({ paidAmount: 50, type: 'payment', studentName: '測試乙' });
  });

  it('區間只取那幾天；全部帳戶時櫃台收支也在，櫃台沒有結餘', () => {
    const rows = buildLookupRows({ transactions, auditEvents: audit, accountIds: null, start: '2026-10-13', end: '2026-10-13' });
    expect(rows.map(r => r.transactionId)).toEqual(['t3', 't4', 'tc']);
    expect(rows.find(r => r.transactionId === 'tc')!.afterBalance).toBeNull();
  });

  it('區間結束時餘額：那天以前最後一筆的結餘；沒有交易時是期初', () => {
    expect(balanceAtEndOf(transactions, students[1], '2026-10-12')).toBe(-90);
    expect(balanceAtEndOf(transactions, students[1], '2026-10-13')).toBe(30);
    const withOpening = acct('003', '測試丙', { openingBalance: { amount: -50 } as StudentAccount['openingBalance'] });
    expect(balanceAtEndOf(transactions, withOpening, '2026-10-13')).toBe(-50);
  });
});
