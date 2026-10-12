export type { TransactionType, LedgerSyncStatus } from './types';

export interface LedgerTransaction {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string;
  studentNameSnapshot: string;
  type: TransactionType;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  operatorId?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
  note: string;
  depositAmount?: number;
  unpaidAmount?: number;
}

import type { StudentSnapshot } from './student';
import type { MenuSnapshot } from './menu';
import type { StudentAccount } from './student';

export const CASHIER_SENTINEL = '__cashier__' as const;

export function isStudentTransaction(tx: { studentId: string }): boolean {
  return tx.studentId !== CASHIER_SENTINEL;
}

export interface CreateLedgerTransactionInput {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentSnapshot: StudentSnapshot;
  menuSnapshot: MenuSnapshot;
  type: TransactionType;
  mealPrice: number;
  paidAmount: number;
  previousBalance: number;
  sourceDevice: LedgerTransaction['sourceDevice'];
  operatorId?: string;
  note: string;
}

export function calculateTransactionAmount(mealPrice: number, paidAmount: number): number {
  return paidAmount - mealPrice;
}

export function createLedgerTransaction(input: CreateLedgerTransactionInput): LedgerTransaction {
  const amount = calculateTransactionAmount(input.mealPrice, input.paidAmount);
  const studentId = input.type === 'expense' ? CASHIER_SENTINEL : input.studentSnapshot.studentId;
  return {
    transactionId: input.transactionId,
    businessDate: input.businessDate,
    createdAt: input.createdAt,
    studentId,
    studentNameSnapshot: input.type === 'expense' ? '櫃台' : input.studentSnapshot.studentNameSnapshot,
    type: input.type,
    mealPrice: input.mealPrice,
    paidAmount: input.paidAmount,
    amount,
    afterBalance: input.type === 'expense' ? 0 : input.previousBalance + amount,
    menuNameSnapshot: input.type === 'expense' ? '' : input.menuSnapshot.menuNameSnapshot,
    vendorNameSnapshot: input.type === 'expense' ? '' : input.menuSnapshot.vendorNameSnapshot,
    sourceDevice: input.sourceDevice,
    operatorId: input.operatorId,
    syncStatus: 'local',
    revision: 1,
    note: input.note,
  };
}

export function countActiveOrdersForStudent(
  transactions: LedgerTransaction[],
  studentId: string,
  businessDate: string,
): number {
  return transactions.filter(
    t => t.studentId === studentId && t.businessDate === businessDate && t.type === 'order',
  ).length;
}

export interface RecalculationResult {
  students: StudentAccount[];
  transactions: LedgerTransaction[];
}

export function recalculateStudentBalances(
  students: StudentAccount[],
  transactions: LedgerTransaction[],
): RecalculationResult {
  const studentTx = transactions.filter(isStudentTransaction);
  const sorted = [...studentTx].sort((a, b) => {
    if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.transactionId.localeCompare(b.transactionId);
  });

  const balanceMap = new Map<string, number>();
  // M0：以期初餘額為起點，重算不可把期初歸零。
  for (const s of students) {
    balanceMap.set(s.studentId, s.openingBalance?.amount ?? 0);
  }

  const updatedTx = sorted.map(tx => {
    const currentBalance = balanceMap.get(tx.studentId) ?? 0;
    const newBalance = currentBalance + tx.amount;
    balanceMap.set(tx.studentId, newBalance);
    return { ...tx, afterBalance: newBalance };
  });

  const updatedStudents = students.map(s => ({
    ...s,
    currentBalance: Math.round(balanceMap.get(s.studentId) ?? s.currentBalance),
  }));

  return { students: updatedStudents, transactions: updatedTx };
}

/**
 * M2 F03／R04：任何一筆交易新增、修改、刪除後，受影響帳戶的整串餘額都從起點重算。
 * 起點：有期初就用期初；舊資料沒有期初時，用「改動前的目前餘額 − 改動前所有交易」反推，避免把沒有交易紀錄的舊餘額歸零。
 * 依營業日、建立時間（同時間依陣列先後）排序後逐筆累加，回寫每筆的 afterBalance 與帳戶 currentBalance；交易陣列維持原本的順序。
 */
export function rebalanceAccounts(
  studentsBefore: StudentAccount[],
  transactionsBefore: LedgerTransaction[],
  transactionsAfter: LedgerTransaction[],
  studentIds: Iterable<string>,
): { students: StudentAccount[]; transactions: LedgerTransaction[] } {
  const ids = new Set([...studentIds].filter(id => id !== CASHIER_SENTINEL));
  if (ids.size === 0) return { students: studentsBefore, transactions: transactionsAfter };

  const base = new Map<string, number>();
  for (const s of studentsBefore) {
    if (!ids.has(s.studentId)) continue;
    if (s.openingBalance) {
      base.set(s.studentId, s.openingBalance.amount);
    } else {
      const sumBefore = transactionsBefore
        .filter(t => t.studentId === s.studentId)
        .reduce((sum, t) => sum + t.amount, 0);
      base.set(s.studentId, s.currentBalance - sumBefore);
    }
  }

  // 同一毫秒建立的交易以陣列位置排先後：store 的交易陣列新的在前，位置越後面越早發生。
  const position = new Map(transactionsAfter.map((t, i) => [t.transactionId, i]));
  const ordered = transactionsAfter
    .filter(t => ids.has(t.studentId))
    .sort((a, b) => {
      if (a.businessDate !== b.businessDate) return a.businessDate.localeCompare(b.businessDate);
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return (position.get(b.transactionId) ?? 0) - (position.get(a.transactionId) ?? 0);
    });

  const running = new Map(base);
  const after = new Map<string, number>();
  for (const t of ordered) {
    const next = Math.round((running.get(t.studentId) ?? 0) + t.amount);
    running.set(t.studentId, next);
    after.set(t.transactionId, next);
  }

  const transactions = transactionsAfter.map(t => {
    const bal = after.get(t.transactionId);
    return bal === undefined || bal === t.afterBalance ? t : { ...t, afterBalance: bal };
  });
  const students = studentsBefore.map(s =>
    ids.has(s.studentId) && base.has(s.studentId)
      ? { ...s, currentBalance: Math.round(running.get(s.studentId) ?? s.currentBalance) }
      : s,
  );
  return { students, transactions };
}

export interface MergedTransaction extends LedgerTransaction {
  depositAmount: number;
  unpaidAmount: number;
  orderCount: number;
  displayBalance: number;
}

export interface TransactionEditView {
  transactionId: string;
  mealPrice: number;
  paidAmount: number;
  note: string;
}

export function mergeLedgerTransactions(transactions: LedgerTransaction[]): MergedTransaction[] {
  const cashierTxs: LedgerTransaction[] = [];
  const studentGroups: Record<string, LedgerTransaction[]> = {};

  for (const tx of transactions) {
    if (!isStudentTransaction(tx)) {
      cashierTxs.push(tx);
    } else {
      const key = `${tx.businessDate}_${tx.studentId}`;
      if (!studentGroups[key]) {
        studentGroups[key] = [];
      }
      studentGroups[key].push(tx);
    }
  }

  const mergedList: MergedTransaction[] = [];

  for (const tx of cashierTxs) {
    mergedList.push({
      ...tx,
      depositAmount: 0,
      unpaidAmount: 0,
      orderCount: 0,
      displayBalance: 0,
    });
  }

  for (const key in studentGroups) {
    const studentTxs = [...studentGroups[key]].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (studentTxs.length === 0) continue;

    const latestTx = studentTxs[studentTxs.length - 1];
    const displayBalance = latestTx.afterBalance;

    const orders = studentTxs.filter(t => t.type === 'order');
    const payments = studentTxs.filter(t => t.type === 'payment');
    const orderCount = orders.length;

    const totalMealPrice = orders.reduce((sum, o) => sum + o.mealPrice, 0);
    const totalPaid = orders.reduce((sum, o) => sum + o.paidAmount, 0) + payments.reduce((sum, p) => sum + p.paidAmount, 0);

    if (orderCount > 0) {
      // Merge all orders and payments into a single order row
      const earliestTx = studentTxs[0];
      const depositAmount = Math.max(0, totalPaid - totalMealPrice);
      const unpaidAmount = Math.max(0, totalMealPrice - totalPaid);
      const mergedNote = orders.map(o => o.note).filter(Boolean).join(', ');

      mergedList.push({
        ...earliestTx,
        type: 'order',
        mealPrice: totalMealPrice,
        paidAmount: totalPaid,
        amount: totalPaid - totalMealPrice,
        afterBalance: displayBalance,
        depositAmount,
        unpaidAmount,
        orderCount,
        displayBalance,
        note: mergedNote || earliestTx.note,
      });
    } else {
      // No orders: keep payments as independent rows (for today's report)
      for (const p of payments) {
        mergedList.push({
          ...p,
          depositAmount: p.paidAmount,
          unpaidAmount: 0,
          orderCount: 0,
          displayBalance,
        });
      }
    }
  }

  return mergedList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

