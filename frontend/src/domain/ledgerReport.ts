import type { LedgerTransaction } from './ledger';

export type LedgerDateRangeKind = 'today' | 'week' | 'month' | 'custom';

export interface LedgerDateRange {
  kind: LedgerDateRangeKind;
  startDate: string;
  endDate: string;
}

export interface LedgerTotals {
  orderCount: number;
  orderSalesAmount: number;
  cashCollected: number;
  refundAmount: number;
  netCash: number;
  newDebt: number;
  topUpAmount: number;
  cancellationCount: number;
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

export function getEffectiveLedgerRows(transactions: LedgerTransaction[]): LedgerTransaction[] {
  // Exclude voided originals, include correction and void rows
  return transactions.filter(tx => tx.type !== 'order' || !tx.voidedAt);
}

export function calculateLedgerTotals(transactions: LedgerTransaction[]): LedgerTotals {
  const effective = getEffectiveLedgerRows(transactions);

  let orderCount = 0;
  let orderSalesAmount = 0;
  let cashCollected = 0;
  let refundAmount = 0;
  let newDebt = 0;
  let topUpAmount = 0;
  let cancellationCount = 0;

  for (const tx of effective) {
    if (tx.type === 'order') {
      orderCount++;
      orderSalesAmount += Math.max(0, tx.mealPrice);
      if (tx.paidAmount > 0) {
        cashCollected += tx.paidAmount;
      }
      const unpaid = Math.max(tx.mealPrice - Math.max(tx.paidAmount, 0), 0);
      newDebt += unpaid;
    } else if (tx.type === 'topup') {
      topUpAmount += Math.max(0, tx.paidAmount);
      if (tx.paidAmount > 0) {
        cashCollected += tx.paidAmount;
      }
    } else if (tx.type === 'cancel' || tx.type === 'void' || tx.type === 'correction') {
      cancellationCount++;
      if (tx.paidAmount < 0) {
        refundAmount += Math.abs(tx.paidAmount);
      }
    }
  }

  return {
    orderCount,
    orderSalesAmount,
    cashCollected,
    refundAmount,
    netCash: cashCollected - refundAmount,
    newDebt,
    topUpAmount,
    cancellationCount,
    transactionCount: effective.length,
  };
}

export function groupLedgerRowsByStudent(transactions: LedgerTransaction[]): LedgerGroup[] {
  const map = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) {
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
      if (tx.type === 'order') mealTotal += Math.max(0, tx.mealPrice);
      paidTotal += Math.max(0, tx.paidAmount);
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

  // Sort groups by latest transaction time descending
  groups.sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));

  return groups;
}