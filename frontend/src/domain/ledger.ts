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
  for (const s of students) {
    balanceMap.set(s.studentId, 0);
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

