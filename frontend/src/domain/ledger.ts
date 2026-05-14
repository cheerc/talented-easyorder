export type TransactionType = 'order' | 'topup' | 'cancel' | 'correction' | 'void';
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
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  correctsTransactionId?: string;
}

import type { StudentSnapshot } from './student';
import type { MenuSnapshot } from './menu';
import type { StudentAccount } from './student';

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
  return {
    transactionId: input.transactionId,
    businessDate: input.businessDate,
    createdAt: input.createdAt,
    studentId: input.studentSnapshot.studentId,
    studentNameSnapshot: input.studentSnapshot.studentNameSnapshot,
    type: input.type,
    mealPrice: input.mealPrice,
    paidAmount: input.paidAmount,
    amount,
    afterBalance: input.previousBalance + amount,
    menuNameSnapshot: input.menuSnapshot.menuNameSnapshot,
    vendorNameSnapshot: input.menuSnapshot.vendorNameSnapshot,
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
  const relevant = transactions.filter(
    t => t.studentId === studentId && t.businessDate === businessDate,
  );
  const orders = relevant.filter(t => t.type === 'order').length;
  const cancels = relevant.filter(t => t.type === 'cancel').length;
  return Math.max(0, orders - cancels);
}

export function canCancelToday(
  transactions: LedgerTransaction[],
  studentId: string,
  businessDate: string,
): boolean {
  return countActiveOrdersForStudent(transactions, studentId, businessDate) > 0;
}

export interface RecalculationResult {
  students: StudentAccount[];
  transactions: LedgerTransaction[];
}

export function recalculateStudentBalances(
  students: StudentAccount[],
  transactions: LedgerTransaction[],
): RecalculationResult {
  const sorted = [...transactions].sort((a, b) => {
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
    currentBalance: balanceMap.get(s.studentId) ?? s.currentBalance,
  }));

  return { students: updatedStudents, transactions: updatedTx };
}
