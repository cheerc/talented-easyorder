import type { LedgerSyncStatus } from './ledger';
import type { LedgerTotals } from './ledgerReport';

export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export interface DailySettlement {
  settlementId: string;
  businessDate: string;
  status: BusinessDateStatus;
  settlementRevision: number;
  orderCount: number;
  transactionCount: number;
  totalIncome: number;
  totalExpense: number;
  openingCash: number;
  netCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  closedBy: string;
  closedAt: string;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
}

export interface CashCloseDraft {
  businessDate: string;
  openingCash: number;
  netCash: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  queuedSettlementAccepted: boolean;
}

export function createCashCloseDraft(
  totals: LedgerTotals,
  businessDate: string,
  openingCash: number,
  countedCash: number,
  note: string,
  queuedSettlementAccepted: boolean,
): CashCloseDraft {
  const expectedCash = openingCash + totals.netCash;
  return {
    businessDate,
    openingCash,
    netCash: totals.netCash,
    expectedCash,
    countedCash,
    difference: countedCash - expectedCash,
    note,
    queuedSettlementAccepted,
  };
}

export function validateCashClose(
  expectedCash: number,
  countedCash: number,
  hasFailed: boolean,
  hasConflict: boolean,
  hasQueuedRows: boolean,
  note: string,
): { ok: true } | { ok: false; code: string; message: string } {
  if (hasFailed || hasConflict) {
    return { ok: false, code: 'blocked_sync', message: '存在失敗或衝突的同步記錄，無法關帳' };
  }
  if (hasQueuedRows) {
    return { ok: false, code: 'queued_unconfirmed', message: '存在排隊中的記錄，需要確認後才能關帳' };
  }
  if (expectedCash !== countedCash && !note.trim()) {
    return { ok: false, code: 'discrepancy_no_note', message: '現金差異需填寫備註' };
  }
  return { ok: true };
}

export function createDailySettlement(
  businessDate: string,
  totals: LedgerTotals,
  openingCash: number,
  countedCash: number,
  note: string,
  closedBy: string,
  closedAt: string,
  hasQueuedRows: boolean,
): DailySettlement {
  const expectedCash = openingCash + totals.netCash;
  const difference = countedCash - expectedCash;
  return {
    settlementId: `settle-${businessDate}-${closedAt}`,
    businessDate,
    status: 'closed',
    settlementRevision: 1,
    orderCount: totals.orderCount,
    transactionCount: totals.transactionCount,
    totalIncome: totals.totalIncome,
    totalExpense: totals.totalExpense,
    openingCash,
    netCash: totals.netCash,
    expectedCash,
    countedCash,
    difference,
    note,
    closedBy,
    closedAt,
    syncStatus: hasQueuedRows ? 'queued' : 'local',
    revision: 1,
  };
}

export function reopenBusinessDate(
  previous: DailySettlement,
  reason: string,
  reopenedBy: string,
  reopenedAt: string,
): DailySettlement {
  return {
    ...previous,
    status: 'reopened',
    settlementRevision: previous.settlementRevision + 1,
    reopenedBy,
    reopenedAt,
    reopenReason: reason,
    revision: previous.revision + 1,
  };
}

export function isBusinessDateWritable(status: BusinessDateStatus): boolean {
  return status !== 'closed';
}

export function getOpeningCash(
  businessDate: string,
  dailySettlements: DailySettlement[],
  cashSession?: { openingCash: number },
): number {
  const yesterday = shiftDateStr(businessDate, -1);
  const yesterdaySettlement = dailySettlements
    .filter(s => s.businessDate === yesterday)
    .sort((a, b) => b.settlementRevision - a.settlementRevision)[0];

  if (yesterdaySettlement) return yesterdaySettlement.countedCash;
  if (cashSession) return cashSession.openingCash;
  return 4000;
}

function shiftDateStr(dateStr: string, offset: number): string {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}