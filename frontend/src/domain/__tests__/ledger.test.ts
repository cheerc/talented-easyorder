import { describe, it, expect } from 'vitest';
import {
  calculateTransactionAmount,
  createLedgerTransaction,
  countActiveOrdersForStudent,
  canCancelToday,
  recalculateStudentBalances,
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

  it('topup: amount = paidAmount', () => {
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
  const cancelledOrder: LedgerTransaction = {
    ...TX_ORDER_001,
    transactionId: 'tx-cancel-001',
    type: 'cancel',
    amount: 90,
    afterBalance: 1250,
  };

  it('counts active orders for student on given business date', () => {
    const count = countActiveOrdersForStudent([TX_ORDER_001], '001', FIXTURE_BUSINESS_DATE);
    expect(count).toBe(1);
  });

  it('excludes cancelled orders from count', () => {
    const count = countActiveOrdersForStudent(
      [TX_ORDER_001, cancelledOrder],
      '001',
      FIXTURE_BUSINESS_DATE,
    );
    expect(count).toBe(0);
  });

  it('excludes other students', () => {
    const count = countActiveOrdersForStudent([TX_ORDER_001], '002', FIXTURE_BUSINESS_DATE);
    expect(count).toBe(0);
  });

  it('excludes other business dates', () => {
    const count = countActiveOrdersForStudent([TX_ORDER_001], '001', '2026-05-08');
    expect(count).toBe(0);
  });
});

describe('canCancelToday', () => {
  it('can cancel when active order count > 0', () => {
    expect(canCancelToday([TX_ORDER_001], '001', FIXTURE_BUSINESS_DATE)).toBe(true);
  });

  it('cannot cancel when active order count is zero', () => {
    expect(canCancelToday([], '001', FIXTURE_BUSINESS_DATE)).toBe(false);
  });

  it('cannot cancel when all orders already cancelled', () => {
    const cancelled: LedgerTransaction = {
      ...TX_ORDER_001,
      transactionId: 'tx-cancel-001',
      type: 'cancel',
      amount: 90,
      afterBalance: 1250,
    };
    expect(canCancelToday([TX_ORDER_001, cancelled], '001', FIXTURE_BUSINESS_DATE)).toBe(false);
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
        type: 'topup',
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
