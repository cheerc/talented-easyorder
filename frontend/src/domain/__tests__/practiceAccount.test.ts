import { describe, it, expect } from 'vitest';
import { validateNewAccount, createLocalAccount, parseAliases, type StudentAccount } from '../student';
import { shiftBusinessDate } from '../businessDate';
import { recalculateStudentBalances, type LedgerTransaction } from '../ledger';
import { isMenuReady } from '../menu';
import { INITIAL_STUDENTS } from '../../mocks/initialData';

// M0 S03／S04：手動建帳戶與期初。期待值為手算，不用被測函式產生。

function account(studentId: string, displayName: string): StudentAccount {
  return createLocalAccount({ studentId, displayName, openingBalance: 0, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
}

const input = (overrides: Partial<{ studentId: string; displayName: string; openingBalanceText: string; openingNote: string }>) => ({
  studentId: '001', displayName: '甲生', openingBalanceText: '0', openingNote: '', ...overrides,
});

describe('validateNewAccount', () => {
  it('keeps leading zeros in the account id', () => {
    const r = validateNewAccount(input({ studentId: ' 001 ' }), []);
    expect(r).toMatchObject({ ok: true, studentId: '001' });
  });

  it('accepts 0 and negative opening balances', () => {
    expect(validateNewAccount(input({ openingBalanceText: '0' }), [])).toMatchObject({ ok: true, openingBalance: 0 });
    expect(validateNewAccount(input({ openingBalanceText: '-150' }), [])).toMatchObject({ ok: true, openingBalance: -150 });
  });

  it('does not treat a blank opening balance as 0', () => {
    expect(validateNewAccount(input({ openingBalanceText: '  ' }), [])).toEqual({ ok: false, errors: ['missing_opening'] });
  });

  it('rejects non-integer opening balances', () => {
    for (const text of ['12.5', 'abc', '1e3', '--1']) {
      expect(validateNewAccount(input({ openingBalanceText: text }), [])).toEqual({ ok: false, errors: ['invalid_opening'] });
    }
  });

  it('blocks a duplicate id and requires a name', () => {
    const r = validateNewAccount(input({ displayName: ' ' }), [account('001', '乙生')]);
    expect(r).toEqual({ ok: false, errors: ['duplicate_id', 'missing_name'] });
  });

  it('allows the same name under a different id and reports it', () => {
    const r = validateNewAccount(input({ studentId: '002' }), [account('001', '甲生')]);
    expect(r).toMatchObject({ ok: true, sameNameIds: ['001'] });
  });
});

describe('createLocalAccount', () => {
  it('stores the opening balance separately and starts currentBalance from it', () => {
    const a = createLocalAccount({ studentId: '003', displayName: '丙生', openingBalance: 200, openingNote: ' 紙本結餘 ', asOfDate: '2026-10-12' }, '2026-10-12T01:00:00Z');
    expect(a.currentBalance).toBe(200);
    expect(a.openingBalance).toEqual({ amount: 200, asOfDate: '2026-10-12', note: '紙本結餘', createdAt: '2026-10-12T01:00:00Z' });
    expect(a.status).toBe('active');
  });
});

describe('recalculateStudentBalances with opening balance', () => {
  it('starts from the opening balance: 200 opening, order 90 → 110 (plan M0 validation)', () => {
    const student = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: 200, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
    const order = {
      transactionId: 't1', businessDate: '2026-10-12', createdAt: '2026-10-12T10:00:00Z',
      studentId: '001', studentNameSnapshot: '甲生', type: 'order', mealPrice: 90, paidAmount: 0, amount: -90,
      afterBalance: 0, menuNameSnapshot: '晚餐', vendorNameSnapshot: '練習店', sourceDevice: 'pc',
      syncStatus: 'local', revision: 1, note: '',
    } as LedgerTransaction;
    const r = recalculateStudentBalances([student], [order]);
    expect(r.students[0].currentBalance).toBe(110);
    expect(r.transactions[0].afterBalance).toBe(110);
  });

  it('keeps the opening balance when all transactions are removed', () => {
    const student = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: -50, openingNote: '', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
    expect(recalculateStudentBalances([student], []).students[0].currentBalance).toBe(-50);
  });
});

describe('sample dataset opening balances', () => {
  it('recalculating the sample with no transactions keeps every balance (S001 1000, S002 500)', () => {
    const r = recalculateStudentBalances(INITIAL_STUDENTS, []);
    expect(r.students.map(s => s.currentBalance)).toEqual(INITIAL_STUDENTS.map(s => s.currentBalance));
    expect(r.students.find(s => s.studentId === 'S001')?.currentBalance).toBe(1000);
    expect(r.students.find(s => s.studentId === 'S002')?.currentBalance).toBe(500);
  });
});

describe('isMenuReady', () => {
  const base = { businessDate: '', vendorId: '', vendorNameSnapshot: '', updatedAt: '', revision: 1 };
  it('is false for the blank menu and true once a name and positive price exist', () => {
    expect(isMenuReady({ ...base, itemName: '', price: 0 })).toBe(false);
    expect(isMenuReady({ ...base, itemName: '晚餐', price: 0 })).toBe(false);
    expect(isMenuReady({ ...base, itemName: '晚餐', price: 90 })).toBe(true);
  });
});

describe('parseAliases', () => {
  it('splits on half/full-width commas and 、, trims, dedupes and drops the display name', () => {
    expect(parseAliases(' 小明, Ming Wang，小明、甲生 ,, ', '甲生')).toEqual(['小明', 'Ming Wang']);
    expect(parseAliases('', '甲生')).toEqual([]);
  });
});

describe('shiftBusinessDate', () => {
  it('crosses month and year boundaries', () => {
    expect(shiftBusinessDate('2026-10-12', 1)).toBe('2026-10-13');
    expect(shiftBusinessDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftBusinessDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftBusinessDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
