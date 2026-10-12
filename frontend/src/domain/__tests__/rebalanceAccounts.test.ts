import { describe, it, expect } from 'vitest';
import { rebalanceAccounts, recalculateStudentBalances } from '../ledger';
import { groupLedgerRowsByStudent } from '../ledgerReport';
import type { LedgerTransaction } from '../ledger';
import type { StudentAccount } from '../student';

// M2 F03／R04：期望值都是手算，不用被測函式產生。

function student(id: string, currentBalance: number, opening?: number): StudentAccount {
  return {
    studentId: id, displayName: id, status: 'active', currentBalance, aliases: [],
    faceEnrollmentStatus: 'none', createdAt: '', updatedAt: '', revision: 1,
    ...(opening === undefined ? {} : { openingBalance: { amount: opening, asOfDate: '2026-05-31', note: '', createdAt: '' } }),
  } as StudentAccount;
}

function tx(id: string, studentId: string, businessDate: string, createdAt: string, mealPrice: number, paidAmount: number, afterBalance = 0): LedgerTransaction {
  return {
    transactionId: id, businessDate, createdAt, studentId, studentNameSnapshot: studentId,
    type: mealPrice > 0 ? 'order' : 'payment', mealPrice, paidAmount, amount: paidAmount - mealPrice,
    afterBalance, menuNameSnapshot: '', vendorNameSnapshot: '', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '',
  } as LedgerTransaction;
}

describe('rebalanceAccounts', () => {
  it('本人 demo：0 → 訂 90 → 繳 100 → 把 100 改成 120，所有結餘與目前餘額都是 30', () => {
    const students = [student('001', 10, 0)];
    const before = [
      tx('p', '001', '2026-06-01', '2026-06-01T10:01:00Z', 0, 100, 10),
      tx('o', '001', '2026-06-01', '2026-06-01T10:00:00Z', 90, 0, -90),
    ];
    const after = [{ ...before[0], paidAmount: 120, amount: 120 }, before[1]];
    const r = rebalanceAccounts(students, before, after, ['001']);
    expect(r.transactions.map(t => [t.transactionId, t.afterBalance])).toEqual([['p', 30], ['o', -90]]);
    expect(r.students[0].currentBalance).toBe(30);
  });

  it('補登前一天的交易，之後每一筆的結餘一起往後推', () => {
    const students = [student('001', 110, 200)];
    const later = tx('later', '001', '2026-06-02', '2026-06-02T09:00:00Z', 90, 0, 110);
    const backdated = tx('back', '001', '2026-06-01', '2026-06-02T12:00:00Z', 0, 50);
    const r = rebalanceAccounts(students, [later], [backdated, later], ['001']);
    // 200 + 50 = 250（6/1），250 − 90 = 160（6/2）
    expect(r.transactions.find(t => t.transactionId === 'back')!.afterBalance).toBe(250);
    expect(r.transactions.find(t => t.transactionId === 'later')!.afterBalance).toBe(160);
    expect(r.students[0].currentBalance).toBe(160);
  });

  it('補登前一天後，F2 分組列的餘額＝目前餘額，明細依發生先後排（審查 #450）', () => {
    const students = [student('001', 110, 200)];
    const later = tx('later', '001', '2026-06-02', '2026-06-02T09:00:00Z', 90, 0, 110);
    const backdated = tx('back', '001', '2026-06-01', '2026-06-02T12:00:00Z', 0, 50);
    const r = rebalanceAccounts(students, [later], [backdated, later], ['001']);
    // store 陣列（新的在前）與畫面清單（舊的在前）兩種傳法結果相同
    for (const [list, order] of [[r.transactions, 'newest-first'], [[...r.transactions].reverse(), 'oldest-first']] as const) {
      const [g] = groupLedgerRowsByStudent([...list], order);
      expect(g.afterBalance).toBe(160);
      expect(g.transactions.map(t => [t.transactionId, t.afterBalance])).toEqual([['back', 250], ['later', 160]]);
      // 列的時間仍是最近一次登錄
      expect(g.latestCreatedAt).toBe('2026-06-02T12:00:00Z');
    }
  });

  it('同一毫秒的兩筆：重算與快照還原的重算給出相同的逐筆結餘', () => {
    const students = [student('001', -180, 0)];
    const newer = tx('a-newer', '001', '2026-06-01', '2026-06-01T10:00:00Z', 0, 100);
    const older = tx('z-older', '001', '2026-06-01', '2026-06-01T10:00:00Z', 90, 0);
    const list = [newer, older];
    const viaRebalance = rebalanceAccounts(students, list, list, ['001']).transactions;
    const viaRecalc = recalculateStudentBalances(students, list).transactions;
    const balances = (ts: LedgerTransaction[]) => Object.fromEntries(ts.map(t => [t.transactionId, t.afterBalance]));
    // 舊的先算：0 − 90 = −90，再 +100 = 10
    expect(balances(viaRebalance)).toEqual({ 'z-older': -90, 'a-newer': 10 });
    expect(balances(viaRecalc)).toEqual({ 'z-older': -90, 'a-newer': 10 });
  });

  it('同一毫秒的兩筆依陣列先後（新的在前）計算', () => {
    const students = [student('001', -180, 0)];
    const t2 = tx('b', '001', '2026-06-01', '2026-06-01T10:00:00Z', 90, 0, -180);
    const t1 = tx('a', '001', '2026-06-01', '2026-06-01T10:00:00Z', 90, 0, -90);
    const changed = [t2, { ...t1, mealPrice: 0, paidAmount: 100, amount: 100 }];
    const r = rebalanceAccounts(students, [t2, t1], changed, ['001']);
    expect(r.transactions.map(t => t.afterBalance)).toEqual([10, 100]);
  });

  it('舊資料沒有期初：從改動前的餘額反推起點，不會歸零；其他帳戶完全不動', () => {
    const legacy = student('001', 500);
    const untouched = student('002', 300);
    const order = tx('o', '001', '2026-06-01', '2026-06-01T10:00:00Z', 90, 0, 500);
    // 改動前 500 含這筆 −90，起點反推為 590；刪掉這筆後回到 590
    const r = rebalanceAccounts([legacy, untouched], [order], [], ['001']);
    expect(r.students.find(s => s.studentId === '001')!.currentBalance).toBe(590);
    expect(r.students.find(s => s.studentId === '002')).toBe(untouched);
  });

  it('櫃台收支不屬於任何帳戶，不重算', () => {
    const students = [student('001', 0, 0)];
    const cashier = { ...tx('c', '__cashier__', '2026-06-01', '2026-06-01T10:00:00Z', 50, 0, 0), type: 'expense' } as LedgerTransaction;
    const r = rebalanceAccounts(students, [cashier], [cashier], ['__cashier__']);
    expect(r.transactions[0]).toBe(cashier);
    expect(r.students).toBe(students);
  });
});
