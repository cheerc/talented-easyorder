export type TransactionType = 'order' | 'payment' | 'expense';
export type LedgerSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';

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
}

import type { StudentSnapshot } from './student';
import type { MenuSnapshot } from './menu';
import type { StudentAccount } from './student';

export const CASHIER_SENTINEL = '__cashier__' as const;

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
  const studentTx = transactions.filter(t => t.studentId !== CASHIER_SENTINEL);
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
}

export function mergeLedgerTransactions(transactions: LedgerTransaction[]): MergedTransaction[] {
  const cashierTxs: LedgerTransaction[] = [];
  const studentGroups: Record<string, LedgerTransaction[]> = {};

  for (const tx of transactions) {
    if (tx.studentId === CASHIER_SENTINEL) {
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
    });
  }

  for (const key in studentGroups) {
    const studentTxs = [...studentGroups[key]].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (studentTxs.length === 0) continue;

    const latestTx = studentTxs[studentTxs.length - 1];
    const endBalance = latestTx.afterBalance;
    const unpaidAmount = endBalance < 0 ? Math.abs(endBalance) : 0;

    const orders = studentTxs.filter(t => t.type === 'order');
    const payments = studentTxs.filter(t => t.type === 'payment');

    const commodityGroups: Record<string, LedgerTransaction[]> = {};
    for (const order of orders) {
      const commodityKey = `${order.menuNameSnapshot}_${order.mealPrice}`;
      if (!commodityGroups[commodityKey]) {
        commodityGroups[commodityKey] = [];
      }
      commodityGroups[commodityKey].push(order);
    }

    const mergedOrders: MergedTransaction[] = Object.values(commodityGroups)
      .map(group => {
        const earliestOrder = group[0];
        const latestOrderInGroup = group[group.length - 1];
        const totalMealPrice = group.reduce((sum, o) => sum + o.mealPrice, 0);
        const mergedNote = group.map(o => o.note).filter(Boolean).join(', ');

        return {
          ...earliestOrder,
          mealPrice: totalMealPrice,
          paidAmount: 0,
          amount: -totalMealPrice,
          afterBalance: latestOrderInGroup.afterBalance,
          depositAmount: 0,
          unpaidAmount: 0,
          note: mergedNote || earliestOrder.note,
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const sortedPayments: MergedTransaction[] = payments
      .map(p => ({
        ...p,
        depositAmount: 0,
        unpaidAmount: 0,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const totalPaidToday = orders.reduce((sum, o) => sum + o.paidAmount, 0) + payments.reduce((sum, p) => sum + p.paidAmount, 0);
    const totalMealToday = mergedOrders.reduce((sum, o) => sum + o.mealPrice, 0);

    let remainingPaidForOrders = totalPaidToday;
    for (const order of mergedOrders) {
      const allocated = Math.min(order.mealPrice, remainingPaidForOrders);
      order.paidAmount = allocated;
      order.unpaidAmount = unpaidAmount > 0 ? unpaidAmount : (order.mealPrice - allocated);
      remainingPaidForOrders -= allocated;
    }

    let remainingMealForPayments = totalMealToday;
    for (const payment of sortedPayments) {
      const used = Math.min(payment.paidAmount, remainingMealForPayments);
      remainingMealForPayments -= used;
      payment.depositAmount = payment.paidAmount - used;
      payment.unpaidAmount = unpaidAmount > 0 ? unpaidAmount : 0;
    }

    mergedList.push(...mergedOrders, ...sortedPayments);
  }

  return mergedList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

