import { describe, it, expect } from 'vitest';
import {
  calculateTransactionAmount,
  createLedgerTransaction,
  countActiveOrdersForStudent,
  recalculateStudentBalances,
  mergeLedgerTransactions,
} from '../ledger';
import type { LedgerTransaction } from '../ledger';
import {
  STUDENT_001,
  STUDENT_004,
  TODAY_MENU_KARAAGE,
  TX_ORDER_001,
  FIXTURE_BUSINESS_DATE,
} from './fixtures';
import { createStudentSnapshot } from '../student';
import { createMenuSnapshot } from '../menu';

describe('calculateTransactionAmount', () => {
  it('order with no cash: amount = -mealPrice', () => {
    expect(calculateTransactionAmount(90, 0)).toBe(-90);
  });

  it('order with full cash: amount = 0', () => {
    expect(calculateTransactionAmount(90, 90)).toBe(0);
  });

  it('payment: amount = paidAmount', () => {
    expect(calculateTransactionAmount(0, 500)).toBe(500);
  });

  it('partial payment: amount = paidAmount - mealPrice', () => {
    expect(calculateTransactionAmount(90, 50)).toBe(-40);
  });
});

describe('createLedgerTransaction', () => {
  it('creates a transaction with snapshots and correct amount', () => {
    const studentSnapshot = createStudentSnapshot(STUDENT_001);
    const menuSnapshot = createMenuSnapshot(TODAY_MENU_KARAAGE);
    const tx = createLedgerTransaction({
      transactionId: 'tx-test-1',
      businessDate: FIXTURE_BUSINESS_DATE,
      createdAt: '2026-05-07T04:00:00Z',
      studentSnapshot,
      menuSnapshot,
      type: 'order',
      mealPrice: 90,
      paidAmount: 0,
      previousBalance: 1250,
      sourceDevice: 'pc',
      note: '日式唐揚雞便當',
    });

    expect(tx.transactionId).toBe('tx-test-1');
    expect(tx.studentId).toBe('001');
    expect(tx.studentNameSnapshot).toBe('王柏翰');
    expect(tx.menuNameSnapshot).toBe('日式唐揚雞便當');
    expect(tx.vendorNameSnapshot).toBe('阿榮便當');
    expect(tx.amount).toBe(-90);
    expect(tx.afterBalance).toBe(1160);
    expect(tx.syncStatus).toBe('local');
    expect(tx.revision).toBe(1);
  });
});

describe('countActiveOrdersForStudent', () => {
  it('counts active orders for student on given business date', () => {
    const count = countActiveOrdersForStudent([TX_ORDER_001], '001', FIXTURE_BUSINESS_DATE);
    expect(count).toBe(1);
  });

  it('excludes other students', () => {
    const count = countActiveOrdersForStudent([TX_ORDER_001], '002', FIXTURE_BUSINESS_DATE);
    expect(count).toBe(0);
  });

  it('excludes other business dates', () => {
    const count = countActiveOrdersForStudent([TX_ORDER_001], '001', '2026-05-08');
    expect(count).toBe(0);
  });

  it('excludes payment and expense rows', () => {
    const paymentRow: LedgerTransaction = {
      ...TX_ORDER_001,
      transactionId: 'tx-payment-1',
      type: 'payment',
      mealPrice: 0,
      paidAmount: 100,
      amount: 100,
      afterBalance: 1350,
    };
    const expenseRow: LedgerTransaction = {
      ...TX_ORDER_001,
      transactionId: 'tx-expense-1',
      type: 'expense',
      mealPrice: 50,
      paidAmount: 0,
      amount: -50,
      afterBalance: 1200,
    };
    const count = countActiveOrdersForStudent(
      [TX_ORDER_001, paymentRow, expenseRow],
      '001',
      FIXTURE_BUSINESS_DATE,
    );
    expect(count).toBe(1);
  });
});

describe('recalculateStudentBalances', () => {
  it('recalculates balances in deterministic order', () => {
    const students = [
      { ...STUDENT_001, currentBalance: 0 },
    ];
    const transactions: LedgerTransaction[] = [
      {
        ...TX_ORDER_001,
        transactionId: 'tx-1',
        createdAt: '2026-05-07T03:00:00Z',
        amount: -90,
        afterBalance: 0,
      },
      {
        ...TX_ORDER_001,
        transactionId: 'tx-2',
        type: 'payment',
        createdAt: '2026-05-07T02:00:00Z',
        mealPrice: 0,
        paidAmount: 500,
        amount: 500,
        afterBalance: 0,
      },
    ];

    const result = recalculateStudentBalances(students, transactions);
    const student = result.students.find(s => s.studentId === '001')!;
    expect(student.currentBalance).toBe(410);

    expect(result.transactions[0].afterBalance).toBe(500);
    expect(result.transactions[1].afterBalance).toBe(410);
  });

  it('handles multiple students independently', () => {
    const students = [
      { ...STUDENT_001, currentBalance: 0 },
      { ...STUDENT_004, currentBalance: 0 },
    ];
    const transactions: LedgerTransaction[] = [
      TX_ORDER_001,
      {
        ...TX_ORDER_001,
        transactionId: 'tx-order-004',
        studentId: '004',
        studentNameSnapshot: '張哲瑋',
        amount: -90,
        afterBalance: 0,
      },
    ];

    const result = recalculateStudentBalances(students, transactions);
    const s001 = result.students.find(s => s.studentId === '001')!;
    const s004 = result.students.find(s => s.studentId === '004')!;
    expect(s001.currentBalance).toBe(-90);
    expect(s004.currentBalance).toBe(-90);
  });
});

describe('mergeLedgerTransactions', () => {
  const baseTx = (overrides: Partial<LedgerTransaction>): LedgerTransaction => ({
    ...TX_ORDER_001,
    ...overrides,
  });

  // Edge case 1: 訂便當 90，沒付錢（餘額 −90）
  it('order 90 no payment: orderCount=1, displayBalance=-90, unpaidAmount=90', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90 }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('order');
    expect(merged[0].orderCount).toBe(1);
    expect(merged[0].displayBalance).toBe(-90);
    expect(merged[0].mealPrice).toBe(90);
    expect(merged[0].paidAmount).toBe(0);
    expect(merged[0].unpaidAmount).toBe(90);
    expect(merged[0].depositAmount).toBe(0);
  });

  // Edge case 2: 訂便當 90，付 50（餘額 −40）
  it('order 90 + payment 50: merges into single order, displayBalance=-40', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, createdAt: '2026-05-07T12:00:00Z' }),
      baseTx({ transactionId: 'tx-2', type: 'payment', mealPrice: 0, paidAmount: 50, amount: 50, afterBalance: -40, createdAt: '2026-05-07T12:01:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.type).toBe('order');
    expect(m.orderCount).toBe(1);
    expect(m.displayBalance).toBe(-40);
    expect(m.mealPrice).toBe(90);
    expect(m.paidAmount).toBe(50);
    expect(m.unpaidAmount).toBe(40);
    expect(m.depositAmount).toBe(0);
  });

  // Edge case 3: 訂便當 90，付 90（餘額 0）
  it('order 90 + payment 90: displayBalance=0, unpaidAmount=0', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, createdAt: '2026-05-07T12:00:00Z' }),
      baseTx({ transactionId: 'tx-2', type: 'payment', mealPrice: 0, paidAmount: 90, amount: 90, afterBalance: 0, createdAt: '2026-05-07T12:01:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.orderCount).toBe(1);
    expect(m.displayBalance).toBe(0);
    expect(m.mealPrice).toBe(90);
    expect(m.paidAmount).toBe(90);
    expect(m.unpaidAmount).toBe(0);
    expect(m.depositAmount).toBe(0);
  });

  // Edge case 4: 訂便當 90，付 100（餘額 10）
  it('order 90 + payment 100: depositAmount=10, displayBalance=10', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, createdAt: '2026-05-07T12:00:00Z' }),
      baseTx({ transactionId: 'tx-2', type: 'payment', mealPrice: 0, paidAmount: 100, amount: 100, afterBalance: 10, createdAt: '2026-05-07T12:01:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.orderCount).toBe(1);
    expect(m.displayBalance).toBe(10);
    expect(m.mealPrice).toBe(90);
    expect(m.paidAmount).toBe(100);
    expect(m.unpaidAmount).toBe(0);
    expect(m.depositAmount).toBe(10);
  });

  // Edge case 5: 訂便當 90×2，付 200（餘額 20）
  it('two orders 90 each + payment 200: orderCount=2, displayBalance=20', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, createdAt: '2026-05-07T12:00:00Z' }),
      baseTx({ transactionId: 'tx-2', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -180, createdAt: '2026-05-07T12:01:00Z' }),
      baseTx({ transactionId: 'tx-3', type: 'payment', mealPrice: 0, paidAmount: 200, amount: 200, afterBalance: 20, createdAt: '2026-05-07T12:02:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.orderCount).toBe(2);
    expect(m.displayBalance).toBe(20);
    expect(m.mealPrice).toBe(180);
    expect(m.paidAmount).toBe(200);
    expect(m.unpaidAmount).toBe(0);
    expect(m.depositAmount).toBe(20);
  });

  // Edge case 6: 先儲值 200，再訂便當 90（餘額 110）
  it('payment 200 first then order 90: orderCount=1, displayBalance=110, depositAmount=110', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', type: 'payment', mealPrice: 0, paidAmount: 200, amount: 200, afterBalance: 200, createdAt: '2026-05-07T12:00:00Z' }),
      baseTx({ transactionId: 'tx-2', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: 110, createdAt: '2026-05-07T12:01:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.type).toBe('order');
    expect(m.orderCount).toBe(1);
    expect(m.displayBalance).toBe(110);
    expect(m.mealPrice).toBe(90);
    expect(m.paidAmount).toBe(200);
    expect(m.depositAmount).toBe(110);
    expect(m.unpaidAmount).toBe(0);
  });

  // Edge case 7: 只繳費 500，沒訂便當 → 保留 payment 獨立行
  it('payment only no order: kept as independent row with orderCount=0', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', type: 'payment', mealPrice: 0, paidAmount: 500, amount: 500, afterBalance: 500, createdAt: '2026-05-07T12:00:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.type).toBe('payment');
    expect(m.orderCount).toBe(0);
    expect(m.displayBalance).toBe(500);
    expect(m.paidAmount).toBe(500);
    expect(m.unpaidAmount).toBe(0);
    expect(m.depositAmount).toBe(500);
  });

  // Edge case 8: 櫃台收支 → cashier rows still pass through
  it('cashier expense rows pass through with orderCount=0, displayBalance=0', () => {
    const txs: LedgerTransaction[] = [
      { ...TX_ORDER_001, transactionId: 'tx-cash-1', studentId: '__cashier__', studentNameSnapshot: '櫃台', type: 'expense', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: 0, note: '文具' },
    ];
    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    const m = merged[0];
    expect(m.type).toBe('expense');
    expect(m.orderCount).toBe(0);
    expect(m.displayBalance).toBe(0);
  });

  // Multiple students: each student merged independently
  it('merges each student independently', () => {
    const txs: LedgerTransaction[] = [
      baseTx({ transactionId: 'tx-1', studentId: '001', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, createdAt: '2026-05-07T12:00:00Z' }),
      baseTx({ transactionId: 'tx-2', studentId: '001', type: 'payment', mealPrice: 0, paidAmount: 90, amount: 90, afterBalance: 0, createdAt: '2026-05-07T12:01:00Z' }),
      baseTx({ transactionId: 'tx-3', studentId: '004', studentNameSnapshot: '張哲瑋', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, createdAt: '2026-05-07T12:02:00Z' }),
    ];
    const merged = mergeLedgerTransactions(txs);
    // Two students → two merged rows
    expect(merged.length).toBe(2);
    const s001 = merged.find(m => m.studentId === '001')!;
    const s004 = merged.find(m => m.studentId === '004')!;
    expect(s001.orderCount).toBe(1);
    expect(s001.displayBalance).toBe(0);
    expect(s004.orderCount).toBe(1);
    expect(s004.displayBalance).toBe(-90);
  });
});
