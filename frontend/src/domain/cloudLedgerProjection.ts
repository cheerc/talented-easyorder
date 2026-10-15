/**
 * 零費用正式後端：雲端帳務投影數學（Projection Math）
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §7
 * 計畫來源：docs/superpowers/plans/2026-10-13-free-production-backend-plan.md §P02
 */

import { CASHIER_SENTINEL, type LedgerTransaction } from './ledger';
import type { LedgerTotals } from './ledgerReport';
import type { DailySettlement } from './cashClose';
import type { DailyCashSession } from './cashSession';

export { CASHIER_SENTINEL };

/**
 * 投影計算支援的最小交易介面。
 * 兼容舊版 LedgerTransaction 與新版 CloudTransactionDoc。
 */
export interface CloudTransactionInput {
  transactionId: string;
  studentId: string;
  businessDate: string;
  createdAt: string;
  type: 'order' | 'payment' | 'expense';
  mealKind?: 'bento' | 'other' | null;
  mealPrice?: number;
  paidAmount?: number;
  amount?: number;
  status?: 'active' | 'voided' | string;
  otherItemName?: string;
  note?: string;
  [key: string]: unknown;
}

/**
 * 單筆交易對當日 totals 的貢獻數值。
 * 規格 §7.1：day.totals 固定包含 activeTransactionCount、bentoCount、otherMealCount、mealTotal、retainedReceipts、cashierIncome、cashierExpense。
 * voided 全部貢獻零。
 */
export interface DayTotalsContribution {
  activeTransactionCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  retainedReceipts: number;
  cashierIncome: number;
  cashierExpense: number;
}

export interface CloudDayTotals extends DayTotalsContribution {
  orderCount: number;
  totalIncome: number;
  totalExpense: number;
  netCash: number;
}

/**
 * 規格 §7.1：contribution(tx)
 * 每次用同一 contribution 函式計 before/after 差額。
 * - voided 全部貢獻零
 * - active order 計餐費與份數（便當／其他餐點分開）
 * - 所有非 expense 的 paidAmount 計 retainedReceipts
 * - expense 分到 cashierIncome／cashierExpense
 */
export function contribution(tx: CloudTransactionInput): DayTotalsContribution {
  // voided 全部貢獻零
  if (tx.status === 'voided') {
    return {
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0,
    };
  }

  const mealPrice = Math.max(0, Number(tx.mealPrice) || 0);
  const paidAmount = Math.max(0, Number(tx.paidAmount) || 0);
  const isExpense = tx.type === 'expense' || tx.studentId === CASHIER_SENTINEL;

  if (isExpense) {
    // 櫃台現金收支：
    // spec §6.1, §7.1：expense 收入 mealPrice=0,paidAmount>0；支出 mealPrice>0,paidAmount=0
    const cashierIncome = mealPrice === 0 && paidAmount > 0
      ? paidAmount
      : Math.max(0, paidAmount - mealPrice);
    const cashierExpense = mealPrice > 0 && paidAmount === 0
      ? mealPrice
      : Math.max(0, mealPrice - paidAmount);

    return {
      activeTransactionCount: 1,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome,
      cashierExpense,
    };
  }

  // 學生交易（order 或 payment）
  const isOrder = tx.type === 'order';
  let bentoCount = 0;
  let otherMealCount = 0;
  let mealTotal = 0;

  if (isOrder) {
    mealTotal = mealPrice;
    const isOther = tx.mealKind === 'other' ||
      Boolean(tx.otherItemName) ||
      (typeof tx.note === 'string' && tx.note.startsWith('單筆改價：'));

    if (isOther) {
      otherMealCount = 1;
    } else {
      bentoCount = 1;
    }
  }

  return {
    activeTransactionCount: 1,
    bentoCount,
    otherMealCount,
    mealTotal,
    retainedReceipts: paidAmount,
    cashierIncome: 0,
    cashierExpense: 0,
  };
}

/**
 * 聚合多筆交易產生當日日結 Totals。
 */
export function deriveDayTotals(transactions: readonly CloudTransactionInput[]): CloudDayTotals {
  let activeTransactionCount = 0;
  let bentoCount = 0;
  let otherMealCount = 0;
  let mealTotal = 0;
  let retainedReceipts = 0;
  let cashierIncome = 0;
  let cashierExpense = 0;

  for (const tx of transactions) {
    const c = contribution(tx);
    activeTransactionCount += c.activeTransactionCount;
    bentoCount += c.bentoCount;
    otherMealCount += c.otherMealCount;
    mealTotal += c.mealTotal;
    retainedReceipts += c.retainedReceipts;
    cashierIncome += c.cashierIncome;
    cashierExpense += c.cashierExpense;
  }

  const orderCount = bentoCount + otherMealCount;
  const totalIncome = retainedReceipts + cashierIncome;
  const totalExpense = cashierExpense;
  const netCash = totalIncome - totalExpense;

  return {
    activeTransactionCount,
    bentoCount,
    otherMealCount,
    mealTotal,
    retainedReceipts,
    cashierIncome,
    cashierExpense,
    orderCount,
    totalIncome,
    totalExpense,
    netCash,
  };
}

/**
 * 規格 §7.3：交易排序固定為 `(businessDate ASC, createdAt ASC, transactionId ASC)`。
 * 伺服器時間為準，同一毫秒時依 transactionId 排序。
 */
export function compareTransactionsChronologically(
  a: Pick<CloudTransactionInput, 'businessDate' | 'createdAt' | 'transactionId'>,
  b: Pick<CloudTransactionInput, 'businessDate' | 'createdAt' | 'transactionId'>,
): number {
  if (a.businessDate !== b.businessDate) {
    return a.businessDate.localeCompare(b.businessDate);
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  return a.transactionId.localeCompare(b.transactionId);
}

export function sortTransactionsChronologically<T extends CloudTransactionInput>(
  transactions: readonly T[],
): T[] {
  return [...transactions].sort(compareTransactionsChronologically);
}

export interface StudentOpeningBalance {
  amount: number;
  asOfDate?: string;
  note?: string;
}

export type ProjectedTransaction<T extends CloudTransactionInput> = T & {
  delta: number;
  afterBalance: number | null;
};

export type DeriveStudentBalanceResult<T extends CloudTransactionInput> =
  | {
      complete: true;
      currentBalance: number;
      transactions: Array<ProjectedTransaction<T>>;
    }
  | {
      complete: false;
      currentBalance: null;
      transactions: Array<ProjectedTransaction<T>>;
    };

export interface DeriveBalanceOptions {
  /** 完整有效歷史旗標：未完整讀取時設為 false（缺頁情況） */
  complete?: boolean;
}

/**
 * 規格 §7.1, §7.3：從期初 + 完整有效歷史推導每筆 afterBalance。
 * - 缺頁旗標：未完整時回 `complete: false`，不可回精確 afterBalance。
 * - 排序：(businessDate ASC, createdAt ASC, transactionId ASC)。
 * - void 交易 delta = 0，不改動 afterBalance。
 * - 櫃台交易 (expense) 不改動學生餘額。
 */
export function deriveStudentBalance<T extends CloudTransactionInput>(
  opening: StudentOpeningBalance | number,
  transactions: readonly T[],
  options: DeriveBalanceOptions = {},
): DeriveStudentBalanceResult<T> {
  const isComplete = options.complete !== false;
  const sorted = sortTransactionsChronologically(transactions);
  const openingAmount = typeof opening === 'number' ? opening : opening.amount;

  if (!isComplete) {
    // 缺頁旗標：未完整時回 complete: false，不可回精確 afterBalance
    const incompleteTx: Array<ProjectedTransaction<T>> = sorted.map(tx => {
      const isStudentTx = tx.studentId !== CASHIER_SENTINEL && tx.type !== 'expense';
      const isVoided = tx.status === 'voided';
      const delta = isStudentTx && !isVoided
        ? (Number(tx.paidAmount) || 0) - (Number(tx.mealPrice) || 0)
        : 0;
      return {
        ...tx,
        delta,
        afterBalance: null,
      };
    });

    return {
      complete: false,
      currentBalance: null,
      transactions: incompleteTx,
    };
  }

  let runningBalance = openingAmount;
  const projectedTx: Array<ProjectedTransaction<T>> = sorted.map(tx => {
    const isStudentTx = tx.studentId !== CASHIER_SENTINEL && tx.type !== 'expense';
    const isVoided = tx.status === 'voided';

    if (!isStudentTx || isVoided) {
      return {
        ...tx,
        delta: 0,
        afterBalance: runningBalance,
      };
    }

    const delta = (Number(tx.paidAmount) || 0) - (Number(tx.mealPrice) || 0);
    runningBalance += delta;
    return {
      ...tx,
      delta,
      afterBalance: runningBalance,
    };
  });

  return {
    complete: true,
    currentBalance: runningBalance,
    transactions: projectedTx,
  };
}

/**
 * 輔助轉換器：將 CloudDayTotals 轉成現有 UI 所需的 LedgerTotals 型別。
 */
export function toLedgerTotals(dayTotals: CloudDayTotals): LedgerTotals {
  return {
    orderCount: dayTotals.orderCount,
    bentoCount: dayTotals.bentoCount,
    otherMealCount: dayTotals.otherMealCount,
    mealTotal: dayTotals.mealTotal,
    orderUnpaid: Math.max(0, dayTotals.mealTotal - dayTotals.retainedReceipts),
    totalIncome: dayTotals.totalIncome,
    totalExpense: dayTotals.totalExpense,
    netCash: dayTotals.netCash,
    transactionCount: dayTotals.activeTransactionCount,
  };
}

/** 型別再導出，保持與 domain/ledger, domain/cashClose, domain/cashSession 兼容 */
export type { LedgerTransaction, DailySettlement, DailyCashSession };
