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
  settlementRevision = 1,
): DailySettlement {
  const expectedCash = openingCash + totals.netCash;
  const difference = countedCash - expectedCash;
  return {
    // 重開後再關帳的版次也寫進編號，同一毫秒內關帳兩次也不會撞號。
    settlementId: `settle-${businessDate}-${closedAt}${settlementRevision > 1 ? `-r${settlementRevision}` : ''}`,
    businessDate,
    status: 'closed',
    settlementRevision,
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
  settlementRevision = previous.settlementRevision + 1,
): DailySettlement {
  return {
    ...previous,
    // M3：重開是一筆新的版本，要有自己的編號；以前沿用原關帳編號，結帳歷史會有兩列同一個編號。
    settlementId: `settle-${previous.businessDate}-${reopenedAt}-r${settlementRevision}`,
    status: 'reopened',
    settlementRevision,
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

/**
 * M3：同一天的最後一版結帳紀錄。每一版都比前一版晚發生，所以先比這一版的時間（重開時間或關帳時間）；
 * 舊資料裡重開後再關帳的版次都寫成 1，不能只看版次。時間相同時才比版次。
 */
export function latestSettlement(businessDate: string, dailySettlements: DailySettlement[]): DailySettlement | undefined {
  return dailySettlements
    .filter(s => s.businessDate === businessDate)
    .sort(compareSettlementVersionDesc)[0];
}

/** 新版本排前面：先比這一版的重開或關帳時間，相同時再比版次。 */
export function compareSettlementVersionDesc(a: DailySettlement, b: DailySettlement): number {
  const at = (s: DailySettlement) => (s.status === 'reopened' && s.reopenedAt ? s.reopenedAt : s.closedAt);
  return at(b).localeCompare(at(a)) || b.settlementRevision - a.settlementRevision;
}

/** M3：重開或再關帳時，新紀錄的版次接在這一天既有最高版次之後。 */
export function nextSettlementRevision(businessDate: string, dailySettlements: DailySettlement[]): number {
  return dailySettlements
    .filter(s => s.businessDate === businessDate)
    .reduce((max, s) => Math.max(max, s.settlementRevision), 0) + 1;
}

export interface OpeningCashSuggestion {
  amount: number;
  /** same_day：這一天上一次關帳用的開帳金額（重開的日子）；previous_day：前一天關帳的實際點算。 */
  source: 'same_day' | 'previous_day';
  /** source === 'previous_day' 時，記錄該前一個營業日的日期字串 (YYYY-MM-DD) */
  fromDate?: string;
}

/**
 * M3：F3 開帳金額欄位的預填建議值，本人仍要按儲存確認。
 * 這一天已經關帳過（後來重開）時，優先用那次關帳記錄的開帳金額；
 * 否則找 businessDate 之前最近一個已關帳（status === 'closed'）的營業日最後一版的實際點算。
 */
export function suggestOpeningCash(businessDate: string, dailySettlements: DailySettlement[]): OpeningCashSuggestion | null {
  const sameDay = latestSettlement(businessDate, dailySettlements);
  if (sameDay) return { amount: sameDay.openingCash, source: 'same_day' };

  const closedSettlements = dailySettlements.filter(s => s.status === 'closed' && s.businessDate < businessDate);
  if (closedSettlements.length === 0) return null;

  const previousDates = Array.from(
    new Set(closedSettlements.map(s => s.businessDate))
  ).sort((a, b) => b.localeCompare(a));

  const mostRecentDate = previousDates[0];
  const lastClosed = latestSettlement(mostRecentDate, closedSettlements);
  return lastClosed ? { amount: lastClosed.countedCash, source: 'previous_day', fromDate: lastClosed.businessDate } : null;
}

export const OPENING_CASH_MISSING_MESSAGE = '還沒設定這一天的開帳金額，請先到今日設定（F3）設定，才能關帳。';