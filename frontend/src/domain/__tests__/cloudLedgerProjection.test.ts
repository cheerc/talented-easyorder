import { describe, expect, it } from 'vitest';
import {
  contribution,
  deriveDayTotals,
  deriveStudentBalance,
  sortTransactionsChronologically,
  type CloudTransactionInput,
} from '../cloudLedgerProjection';

describe('cloudLedgerProjection: 投影數學與帳務計算', () => {
  // L01：期初100，便當90收0，再繳200 → 餘額210；餐費90、收現200、便當1、交易2
  it('L01: 期初100，便當90收0，再繳200 → 餘額210；餐費90、收現200、便當1、交易2', () => {
    const studentId = 'stu-001';
    const opening = { amount: 100, asOfDate: '2026-10-14' };
    const tx1: CloudTransactionInput = {
      transactionId: 'tx-001',
      studentId,
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'order',
      mealKind: 'bento',
      mealPrice: 90,
      paidAmount: 0,
      status: 'active',
    };
    const tx2: CloudTransactionInput = {
      transactionId: 'tx-002',
      studentId,
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T11:00:00.000Z',
      type: 'payment',
      mealKind: null,
      mealPrice: 0,
      paidAmount: 200,
      status: 'active',
    };

    const balanceResult = deriveStudentBalance(opening, [tx1, tx2]);
    expect(balanceResult.complete).toBe(true);
    if (balanceResult.complete) {
      expect(balanceResult.currentBalance).toBe(210);
      expect(balanceResult.transactions).toHaveLength(2);
      expect(balanceResult.transactions[0].afterBalance).toBe(10); // 100 - 90 = 10
      expect(balanceResult.transactions[1].afterBalance).toBe(210); // 10 + 200 = 210
    }

    const dayTotals = deriveDayTotals([tx1, tx2]);
    expect(dayTotals.activeTransactionCount).toBe(2);
    expect(dayTotals.bentoCount).toBe(1);
    expect(dayTotals.otherMealCount).toBe(0);
    expect(dayTotals.mealTotal).toBe(90);
    expect(dayTotals.retainedReceipts).toBe(200);
    expect(dayTotals.totalIncome).toBe(200);
    expect(dayTotals.totalExpense).toBe(0);
    expect(dayTotals.netCash).toBe(200);
  });

  // L02：更正便當90→110 → 餘額190；所有畫面一致
  it('L02: 更正便當90→110 → 餘額190；所有畫面一致', () => {
    const studentId = 'stu-001';
    const opening = { amount: 100, asOfDate: '2026-10-14' };
    const tx1Corrected: CloudTransactionInput = {
      transactionId: 'tx-001',
      studentId,
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'order',
      mealKind: 'bento',
      mealPrice: 110,
      paidAmount: 0,
      status: 'active',
    };
    const tx2: CloudTransactionInput = {
      transactionId: 'tx-002',
      studentId,
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T11:00:00.000Z',
      type: 'payment',
      mealKind: null,
      mealPrice: 0,
      paidAmount: 200,
      status: 'active',
    };

    const balanceResult = deriveStudentBalance(opening, [tx1Corrected, tx2]);
    expect(balanceResult.complete).toBe(true);
    if (balanceResult.complete) {
      expect(balanceResult.currentBalance).toBe(190);
      expect(balanceResult.transactions[0].afterBalance).toBe(-10); // 100 - 110 = -10
      expect(balanceResult.transactions[1].afterBalance).toBe(190); // -10 + 200 = 190
    }

    const dayTotals = deriveDayTotals([tx1Corrected, tx2]);
    expect(dayTotals.activeTransactionCount).toBe(2);
    expect(dayTotals.bentoCount).toBe(1);
    expect(dayTotals.mealTotal).toBe(110);
    expect(dayTotals.retainedReceipts).toBe(200);
    expect(dayTotals.netCash).toBe(200);
  });

  // L03：期初0，餐90收100後取消留款 → 餘額100，payment1，餐費/份數0，收現100
  it('L03: 期初0，餐90收100後取消留款 → 餘額100，payment1，餐費/份數0，收現100', () => {
    const studentId = 'stu-001';
    const opening = { amount: 0, asOfDate: '2026-10-14' };
    // 取消留款後，原單轉為 payment，餐費變 0，保留 paidAmount=100
    const txKeepDeposit: CloudTransactionInput = {
      transactionId: 'tx-001',
      studentId,
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'payment',
      mealKind: null,
      mealPrice: 0,
      paidAmount: 100,
      status: 'active',
    };

    const balanceResult = deriveStudentBalance(opening, [txKeepDeposit]);
    expect(balanceResult.complete).toBe(true);
    if (balanceResult.complete) {
      expect(balanceResult.currentBalance).toBe(100);
      expect(balanceResult.transactions[0].afterBalance).toBe(100);
    }

    const dayTotals = deriveDayTotals([txKeepDeposit]);
    expect(dayTotals.activeTransactionCount).toBe(1);
    expect(dayTotals.bentoCount).toBe(0);
    expect(dayTotals.otherMealCount).toBe(0);
    expect(dayTotals.mealTotal).toBe(0);
    expect(dayTotals.retainedReceipts).toBe(100);
    expect(dayTotals.netCash).toBe(100);
  });

  // L04：餐90收100後取消退款 → 餘額0，active筆數0，有效收現0
  it('L04: 餐90收100後取消退款 → 餘額0，active筆數0，有效收現0', () => {
    const studentId = 'stu-001';
    const opening = { amount: 0, asOfDate: '2026-10-14' };
    // 取消退款後，原單 voided，對 totals 與餘額貢獻為 0
    const txVoided: CloudTransactionInput = {
      transactionId: 'tx-001',
      studentId,
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'order',
      mealKind: 'bento',
      mealPrice: 90,
      paidAmount: 100,
      status: 'voided',
    };

    const balanceResult = deriveStudentBalance(opening, [txVoided]);
    expect(balanceResult.complete).toBe(true);
    if (balanceResult.complete) {
      expect(balanceResult.currentBalance).toBe(0);
      expect(balanceResult.transactions[0].afterBalance).toBe(0);
      expect(balanceResult.transactions[0].delta).toBe(0);
    }

    const dayTotals = deriveDayTotals([txVoided]);
    expect(dayTotals.activeTransactionCount).toBe(0);
    expect(dayTotals.bentoCount).toBe(0);
    expect(dayTotals.otherMealCount).toBe(0);
    expect(dayTotals.mealTotal).toBe(0);
    expect(dayTotals.retainedReceipts).toBe(0);
    expect(dayTotals.totalIncome).toBe(0);
    expect(dayTotals.totalExpense).toBe(0);
    expect(dayTotals.netCash).toBe(0);
  });

  // Expense 雙方向（收入 mealPrice=0,paidAmount>0 與支出 mealPrice>0,paidAmount=0）
  it('Expense 雙方向：收入與支出各自正確貢獻且不影響學生餘額', () => {
    const incomeTx: CloudTransactionInput = {
      transactionId: 'tx-exp-in',
      studentId: '__cashier__',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T09:00:00.000Z',
      type: 'expense',
      mealPrice: 0,
      paidAmount: 50,
      status: 'active',
    };
    const expenseTx: CloudTransactionInput = {
      transactionId: 'tx-exp-out',
      studentId: '__cashier__',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T09:30:00.000Z',
      type: 'expense',
      mealPrice: 80,
      paidAmount: 0,
      status: 'active',
    };

    const cIncome = contribution(incomeTx);
    expect(cIncome.activeTransactionCount).toBe(1);
    expect(cIncome.cashierIncome).toBe(50);
    expect(cIncome.cashierExpense).toBe(0);
    expect(cIncome.retainedReceipts).toBe(0);
    expect(cIncome.mealTotal).toBe(0);

    const cExpense = contribution(expenseTx);
    expect(cExpense.activeTransactionCount).toBe(1);
    expect(cExpense.cashierIncome).toBe(0);
    expect(cExpense.cashierExpense).toBe(80);
    expect(cExpense.retainedReceipts).toBe(0);
    expect(cExpense.mealTotal).toBe(0);

    const totals = deriveDayTotals([incomeTx, expenseTx]);
    expect(totals.activeTransactionCount).toBe(2);
    expect(totals.cashierIncome).toBe(50);
    expect(totals.cashierExpense).toBe(80);
    expect(totals.totalIncome).toBe(50);
    expect(totals.totalExpense).toBe(80);
    expect(totals.netCash).toBe(-30);

    // 櫃台收支不影響學生餘額
    const studentBalance = deriveStudentBalance(100, [incomeTx, expenseTx]);
    expect(studentBalance.complete).toBe(true);
    if (studentBalance.complete) {
      expect(studentBalance.currentBalance).toBe(100);
      expect(studentBalance.transactions[0].afterBalance).toBe(100);
      expect(studentBalance.transactions[1].afterBalance).toBe(100);
    }
  });

  // Void 貢獻 0
  it('Void 交易全數值貢獻為 0', () => {
    const voidedOrder: CloudTransactionInput = {
      transactionId: 'tx-v-order',
      studentId: 'stu-001',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'order',
      mealKind: 'bento',
      mealPrice: 120,
      paidAmount: 120,
      status: 'voided',
    };
    const voidedExpense: CloudTransactionInput = {
      transactionId: 'tx-v-exp',
      studentId: '__cashier__',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:05:00.000Z',
      type: 'expense',
      mealPrice: 0,
      paidAmount: 100,
      status: 'voided',
    };

    const c1 = contribution(voidedOrder);
    expect(c1).toEqual({
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0, accountRefunds: 0,
    });

    const c2 = contribution(voidedExpense);
    expect(c2).toEqual({
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0, accountRefunds: 0,
    });
  });

  // 同毫秒排序（createdAt 相同時以 transactionId 排序）
  it('同毫秒排序：(businessDate ASC, createdAt ASC, transactionId ASC)', () => {
    const txA: CloudTransactionInput = {
      transactionId: 'tx-b-second',
      studentId: 'stu-001',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T12:00:00.000Z',
      type: 'order',
      mealPrice: 50,
      paidAmount: 0,
      status: 'active',
    };
    const txB: CloudTransactionInput = {
      transactionId: 'tx-a-first',
      studentId: 'stu-001',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T12:00:00.000Z',
      type: 'order',
      mealPrice: 30,
      paidAmount: 0,
      status: 'active',
    };

    // 刻意打亂傳入
    const sorted = sortTransactionsChronologically([txA, txB]);
    expect(sorted[0].transactionId).toBe('tx-a-first');
    expect(sorted[1].transactionId).toBe('tx-b-second');

    // 餘額計算會嚴格依此排序計算 afterBalance
    const balanceResult = deriveStudentBalance(100, [txA, txB]);
    expect(balanceResult.complete).toBe(true);
    if (balanceResult.complete) {
      expect(balanceResult.transactions[0].transactionId).toBe('tx-a-first');
      expect(balanceResult.transactions[0].afterBalance).toBe(70); // 100 - 30
      expect(balanceResult.transactions[1].transactionId).toBe('tx-b-second');
      expect(balanceResult.transactions[1].afterBalance).toBe(20); // 70 - 50
    }
  });

  // 缺頁不算 afterBalance（incomplete 標示）
  it('缺頁不算 afterBalance：complete: false 時不回精確數字', () => {
    const tx: CloudTransactionInput = {
      transactionId: 'tx-page-1',
      studentId: 'stu-001',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'order',
      mealPrice: 90,
      paidAmount: 90,
      status: 'active',
    };

    const result = deriveStudentBalance(100, [tx], { complete: false });
    expect(result.complete).toBe(false);
    expect(result.currentBalance).toBeNull();
    expect(result.transactions[0].afterBalance).toBeNull();
  });

  // 其他餐點分類：mealKind === 'other' 或 otherItemName 另計
  it('其他餐點分類：mealKind === other 計入 otherMealCount 而非 bentoCount', () => {
    const txOther: CloudTransactionInput = {
      transactionId: 'tx-other',
      studentId: 'stu-001',
      businessDate: '2026-10-14',
      createdAt: '2026-10-14T10:00:00.000Z',
      type: 'order',
      mealKind: 'other',
      mealPrice: 85,
      paidAmount: 100,
      status: 'active',
      otherItemName: '素食餐盒',
    };

    const c = contribution(txOther);
    expect(c.activeTransactionCount).toBe(1);
    expect(c.bentoCount).toBe(0);
    expect(c.otherMealCount).toBe(1);
    expect(c.mealTotal).toBe(85);
    expect(c.retainedReceipts).toBe(100);
  });
});
