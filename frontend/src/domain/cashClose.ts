import type { LedgerSyncStatus } from './types';
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

/** M3：點算和應有現金不同時一定要寫原因；差額為 0 可以不寫。 */
export const CASH_DIFFERENCE_NOTE_MESSAGE = '點算金額和應有現金不同，請寫下原因。';

export function validateCashClose(
  expectedCash: number,
  countedCash: number,
  hasFailed: boolean,
  hasConflict: boolean,
  hasQueuedRows: boolean,
  note: string,
  queuedAccepted = false,
): { ok: true } | { ok: false; code: string; message: string } {
  if (hasFailed || hasConflict) {
    return { ok: false, code: 'blocked_sync', message: '存在失敗或衝突的同步記錄，無法關帳' };
  }
  if (hasQueuedRows && !queuedAccepted) {
    return { ok: false, code: 'queued_unconfirmed', message: '存在排隊中的記錄，需要確認後才能關帳' };
  }
  if (expectedCash !== countedCash && !note.trim()) {
    return { ok: false, code: 'discrepancy_no_note', message: CASH_DIFFERENCE_NOTE_MESSAGE };
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

/**
 * M3：開帳金額只認這一天本人確認過的設定（F3「儲存開帳金額」）。沒有設定就回傳 null，
 * 關帳畫面與 store 都不准關帳，不再自動沿用昨天點算或預設 4000。
 */
export function getConfirmedOpeningCash(cashSession?: { openingCash: number }): number | null {
  return cashSession ? cashSession.openingCash : null;
}

/** M3：F3 開帳金額欄位的預填建議值＝前一天最後一版關帳的實際點算；本人仍要按儲存確認。 */
export function suggestOpeningCash(businessDate: string, dailySettlements: DailySettlement[]): number | null {
  const yesterday = shiftDateStr(businessDate, -1);
  const latest = dailySettlements
    .filter(s => s.businessDate === yesterday && s.status === 'closed')
    .sort((a, b) => b.settlementRevision - a.settlementRevision)[0];
  return latest ? latest.countedCash : null;
}

export const OPENING_CASH_MISSING_MESSAGE = '還沒設定這一天的開帳金額，請先到今日設定（F3）設定，才能關帳。';

function shiftDateStr(dateStr: string, offset: number): string {
  const parts = dateStr.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}