import { describe, it, expect } from 'vitest';
import {
  buildSnapshot, parseSnapshot, clearTransactionsKeepRoster, pickDataset, snapshotFileName,
  type PracticeDataset,
} from '../practiceSnapshot';
import { createLocalAccount } from '../student';
import { CASHIER_SENTINEL, type LedgerTransaction } from '../ledger';
import { EMPTY_TODAY_MENU } from '../../mocks/initialData';

// M0 S05／S06：快照匯出還原與只清交易。期待值手算。

function tx(id: string, studentId: string, amount: number, afterBalance: number): LedgerTransaction {
  return {
    transactionId: id, businessDate: '2026-10-12', createdAt: `2026-10-12T10:00:0${id.slice(-1)}Z`,
    studentId, studentNameSnapshot: '甲生', type: 'order', mealPrice: -amount, paidAmount: 0, amount, afterBalance,
    menuNameSnapshot: '晚餐', vendorNameSnapshot: '練習店', sourceDevice: 'pc', syncStatus: 'local', revision: 1, note: '',
  };
}

function dataset(): PracticeDataset {
  const a = createLocalAccount({ studentId: '001', displayName: '甲生', openingBalance: 200, openingNote: '紙本', asOfDate: '2026-10-12' }, '2026-10-12T00:00:00Z');
  return {
    students: [{ ...a, currentBalance: 110 }],
    transactions: [tx('t1', '001', -90, 110)],
    vendors: [{ vendorId: 'v1', name: '練習店', phone: '', note: '', status: 'active', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', revision: 1 }],
    todayMenu: { businessDate: '2026-10-12', itemName: '晚餐', price: 90, vendorId: 'v1', vendorNameSnapshot: '練習店', updatedAt: '2026-10-12T00:00:00Z', revision: 1 },
    auditEvents: [],
    dailySettlements: [],
    businessDateStatuses: { '2026-10-12': 'open' },
    cashSessions: { '2026-10-12': { cashSessionId: 'c1', businessDate: '2026-10-12', openingCash: 1000, openedBy: 'op', openedAt: '2026-10-12T08:00:00Z', status: 'open', revision: 1 } },
  };
}

const text = (v: unknown) => JSON.stringify(v);

describe('practice snapshot round trip', () => {
  it('restores every entity with stable ids, opening balance and menu', () => {
    const d = dataset();
    const r = parseSnapshot(text(buildSnapshot(d, '2026-10-12T09:30:00Z')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.data).toEqual(d);
    expect(r.snapshot.exportedAt).toBe('2026-10-12T09:30:00Z');
    expect(r.counts).toEqual({ students: 1, vendors: 1, transactions: 1, auditEvents: 0, dailySettlements: 0, cashSessions: 1 });
  });

  it('round-trips a blank dataset', () => {
    const blank: PracticeDataset = { students: [], transactions: [], vendors: [], todayMenu: EMPTY_TODAY_MENU, auditEvents: [], dailySettlements: [], businessDateStatuses: {}, cashSessions: {} };
    const r = parseSnapshot(text(buildSnapshot(blank, '2026-10-12T09:30:00Z')));
    expect(r.ok).toBe(true);
  });

  it('pickDataset drops actions and unrelated fields', () => {
    const withExtras = { ...dataset(), someAction: () => {}, schemaVersion: 2 };
    expect(Object.keys(pickDataset(withExtras)).sort()).toEqual(
      ['auditEvents', 'businessDateStatuses', 'cashSessions', 'dailySettlements', 'students', 'todayMenu', 'transactions', 'vendors'],
    );
  });
});

describe('parseSnapshot rejects bad files without partial data', () => {
  const good = () => buildSnapshot(dataset(), '2026-10-12T09:30:00Z');

  it.each([
    ['not json', '{oops', '不是有效的 JSON'],
    ['wrong format', text({ ...good(), format: 'other' }), '不是便當櫃台的練習快照檔'],
    ['unsupported version', text({ ...good(), schemaVersion: 99 }), '不支援的快照版本：99'],
    ['missing exportedAt', text({ ...good(), exportedAt: undefined }), '缺少匯出時間'],
    ['missing collection', text({ ...good(), data: { ...good().data, vendors: undefined } }), '資料格式不正確'],
    ['non-integer amount', text({ ...good(), data: { ...good().data, transactions: [{ ...tx('t1', '001', -90, 110), mealPrice: 1.5 }] } }), '資料格式不正確'],
  ])('%s', (_name, input, reason) => {
    const r = parseSnapshot(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  it('duplicate account id', () => {
    const d = dataset();
    const r = parseSnapshot(text(buildSnapshot({ ...d, students: [...d.students, ...d.students] }, 'x')));
    expect(r).toEqual({ ok: false, reason: '帳戶編號重複：001' });
  });

  it('duplicate transaction id', () => {
    const d = dataset();
    const r = parseSnapshot(text(buildSnapshot({ ...d, transactions: [...d.transactions, ...d.transactions] }, 'x')));
    expect(r).toEqual({ ok: false, reason: '交易編號重複：t1' });
  });

  it('transaction pointing to a missing account (cashier rows are allowed)', () => {
    const d = dataset();
    const bad = parseSnapshot(text(buildSnapshot({ ...d, transactions: [tx('t2', '999', -90, -90)] }, 'x')));
    expect(bad).toEqual({ ok: false, reason: '交易 t2 指向不存在的帳戶 999。' });
    const cashier = parseSnapshot(text(buildSnapshot({ ...d, transactions: [{ ...tx('t3', CASHIER_SENTINEL, 0, 0), type: 'expense' }] }, 'x')));
    expect(cashier.ok).toBe(true);
  });
});

describe('clearTransactionsKeepRoster', () => {
  it('keeps roster, vendors and menu; clears ledger state; balances return to opening (110 → 200)', () => {
    const r = clearTransactionsKeepRoster(dataset());
    expect(r.students[0].currentBalance).toBe(200);
    expect(r.students[0].openingBalance?.amount).toBe(200);
    expect(r.vendors).toHaveLength(1);
    expect(r.todayMenu.itemName).toBe('晚餐');
    expect(r.transactions).toEqual([]);
    expect(r.auditEvents).toEqual([]);
    expect(r.dailySettlements).toEqual([]);
    expect(r.businessDateStatuses).toEqual({});
    expect(r.cashSessions).toEqual({});
  });
});

describe('snapshotFileName', () => {
  it('uses local date and time', () => {
    expect(snapshotFileName(new Date(2026, 9, 12, 9, 5))).toBe('easyorder-practice-20261012-0905.json');
  });
});
