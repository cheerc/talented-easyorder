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
  it('merges multiple duplicate orders into a single order', () => {
    const txs: LedgerTransaction[] = [
      {
        ...TX_ORDER_001,
        transactionId: 'tx-1',
        createdAt: '2026-05-07T12:00:00Z',
        mealPrice: 90,
        paidAmount: 0,
        amount: -90,
        afterBalance: -90,
      },
      {
        ...TX_ORDER_001,
        transactionId: 'tx-2',
        createdAt: '2026-05-07T12:01:00Z',
        mealPrice: 90,
        paidAmount: 0,
        amount: -90,
        afterBalance: -180,
      },
    ];

    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(1);
    expect(merged[0].mealPrice).toBe(180);
    expect(merged[0].paidAmount).toBe(0);
    expect(merged[0].unpaidAmount).toBe(180);
    expect(merged[0].depositAmount).toBe(0);
    expect(merged[0].createdAt).toBe('2026-05-07T12:00:00Z');
  });

  it('offsets order with subsequent payment resulting in deposit (separate rows)', () => {
    const txs: LedgerTransaction[] = [
      {
        ...TX_ORDER_001,
        transactionId: 'tx-1',
        createdAt: '2026-05-07T12:00:00Z',
        mealPrice: 90,
        paidAmount: 0,
        amount: -90,
        afterBalance: -90,
      },
      {
        ...TX_ORDER_001,
        transactionId: 'tx-2',
        createdAt: '2026-05-07T12:01:00Z',
        mealPrice: 90,
        paidAmount: 0,
        amount: -90,
        afterBalance: -180,
      },
      {
        ...TX_ORDER_001,
        transactionId: 'tx-3',
        type: 'payment',
        createdAt: '2026-05-07T12:02:00Z',
        mealPrice: 0,
        paidAmount: 200,
        amount: 200,
        afterBalance: 20,
      },
    ];

    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(2); // Order and Payment are separate rows

    // Sorted descending (latest first): Payment first, Order second
    expect(merged[0].type).toBe('payment');
    expect(merged[0].paidAmount).toBe(200);
    expect(merged[0].depositAmount).toBe(20);
    expect(merged[0].unpaidAmount).toBe(0);

    expect(merged[1].type).toBe('order');
    expect(merged[1].mealPrice).toBe(180);
    expect(merged[1].paidAmount).toBe(180);
    expect(merged[1].unpaidAmount).toBe(0);
    expect(merged[1].depositAmount).toBe(0);
  });

  it('offsets payment first then order resulting in deposit (separate rows)', () => {
    const txs: LedgerTransaction[] = [
      {
        ...TX_ORDER_001,
        transactionId: 'tx-3',
        type: 'payment',
        createdAt: '2026-05-07T12:00:00Z',
        mealPrice: 0,
        paidAmount: 200,
        amount: 200,
        afterBalance: 200,
      },
      {
        ...TX_ORDER_001,
        transactionId: 'tx-1',
        createdAt: '2026-05-07T12:01:00Z',
        mealPrice: 90,
        paidAmount: 0,
        amount: -90,
        afterBalance: 110,
      },
      {
        ...TX_ORDER_001,
        transactionId: 'tx-2',
        createdAt: '2026-05-07T12:02:00Z',
        mealPrice: 90,
        paidAmount: 0,
        amount: -90,
        afterBalance: 20,
      },
    ];

    const merged = mergeLedgerTransactions(txs);
    expect(merged).toHaveLength(2); // Order and Payment are separate rows

    // Sorted descending (latest first): Order first (since 12:01 and 12:02 are merged into earliest 12:01? Wait!
    // The duplicate orders are merged into the earliestOrder, which is 12:01.
    // The payment is at 12:00.
    // So order is at 12:01, payment is at 12:00.
    // Sorted descending: Order first (12:01), Payment second (12:00)
    expect(merged[0].type).toBe('order');
    expect(merged[0].mealPrice).toBe(180);
    expect(merged[0].paidAmount).toBe(180);
    expect(merged[0].unpaidAmount).toBe(0);
    expect(merged[0].depositAmount).toBe(0);

    expect(merged[1].type).toBe('payment');
    expect(merged[1].paidAmount).toBe(200);
    expect(merged[1].depositAmount).toBe(20);
    expect(merged[1].unpaidAmount).toBe(0);
  });
});
