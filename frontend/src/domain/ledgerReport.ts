import type { LedgerTransaction } from './ledger';
import { isStudentTransaction } from './ledger';

export type LedgerDateRangeKind = 'today' | 'week' | 'month' | 'custom';

export interface LedgerDateRange {
  kind: LedgerDateRangeKind;
  startDate: string;
  endDate: string;
}

export interface LedgerTotals {
  orderCount: number;
  totalIncome: number;
  totalExpense: number;
  netCash: number;
  newDebt: number;
  transactionCount: number;
}

export interface LedgerGroup {
  studentId: string;
  studentNameSnapshot: string;
  latestCreatedAt: string;
  mealTotal: number;
  paidTotal: number;
  afterBalance: number;
  recordCount: number;
  transactions: LedgerTransaction[];
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function getSunday(dateStr: string): string {
  const monday = new Date(getMonday(dateStr));
  monday.setDate(monday.getDate() + 6);
  return monday.toISOString().split('T')[0];
}

function getMonthEnd(dateStr: string): string {
  const [y, m] = dateStr.substring(0, 7).split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export function createLedgerDateRange(
  kind: LedgerDateRangeKind,
  anchorDate: string,
  custom?: { startDate: string; endDate: string },
): LedgerDateRange {
  if (kind === 'today') {
    return { kind, startDate: anchorDate, endDate: anchorDate };
  }
  if (kind === 'week') {
    return { kind, startDate: getMonday(anchorDate), endDate: getSunday(anchorDate) };
  }
  if (kind === 'month') {
    return { kind, startDate: `${anchorDate.substring(0, 7)}-01`, endDate: getMonthEnd(anchorDate) };
  }
  if (kind === 'custom' && custom) {
    return { kind, startDate: custom.startDate, endDate: custom.endDate };
  }
  return { kind, startDate: anchorDate, endDate: anchorDate };
}

export function filterTransactionsByBusinessDate(
  transactions: LedgerTransaction[],
  range: LedgerDateRange,
): LedgerTransaction[] {
  return transactions.filter(tx => tx.businessDate >= range.startDate && tx.businessDate <= range.endDate);
}

export function calculateLedgerTotals(transactions: LedgerTransaction[]): LedgerTotals {
  let orderCount = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  let newDebt = 0;

  for (const tx of transactions) {
    const roundedMealPrice = Math.round(tx.mealPrice);
    const roundedPaidAmount = Math.round(tx.paidAmount);
    if (tx.type === 'order') {
      orderCount++;
      totalIncome += roundedPaidAmount;
      const unpaid = Math.max(0, roundedMealPrice - roundedPaidAmount);
      newDebt += unpaid;
    } else if (tx.type === 'payment') {
      totalIncome += roundedPaidAmount;
    } else if (tx.type === 'expense') {
      if (roundedPaidAmount > 0) {
        totalIncome += roundedPaidAmount;
      }
      if (roundedMealPrice > 0) {
        totalExpense += roundedMealPrice;
      }
    }
  }

  return {
    orderCount,
    totalIncome,
    totalExpense,
    netCash: totalIncome - totalExpense,
    newDebt,
    transactionCount: transactions.filter(t =>
      t.type !== 'order' || t.paidAmount > 0
    ).length,
  };
}

export function groupLedgerRowsByStudent(transactions: LedgerTransaction[]): LedgerGroup[] {
  const map = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) {
    if (!isStudentTransaction(tx)) continue;
    const key = tx.studentId;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(tx);
  }

  const groups: LedgerGroup[] = [];
  for (const [studentId, txs] of map) {
    const sorted = [...txs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const latestCreatedAt = sorted[sorted.length - 1]?.createdAt ?? '';
    const lastTx = sorted[sorted.length - 1];
    const studentNameSnapshot = lastTx?.studentNameSnapshot ?? '';

    let mealTotal = 0;
    let paidTotal = 0;
    for (const tx of sorted) {
      if (tx.type === 'order') mealTotal += Math.round(Math.max(0, tx.mealPrice));
      paidTotal += Math.round(Math.max(0, tx.paidAmount));
    }

    groups.push({
      studentId,
      studentNameSnapshot,
      latestCreatedAt,
      mealTotal,
      paidTotal,
      afterBalance: lastTx?.afterBalance ?? 0,
      recordCount: sorted.length,
      transactions: sorted,
    });
  }

  groups.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));

  return groups;
}