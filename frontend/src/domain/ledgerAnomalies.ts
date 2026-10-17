/**
 * P11c1 帳務異常（契約 §11）：由營業日清單與各已關帳日最新日結版本的實點現金，純函式算出兩種異常。
 * 不改任何資料；修補工具是 P11c2–c4。
 */

export type LedgerDayStatus = 'open' | 'closed' | 'reopened';

export interface LedgerAnomalyDay {
  dayId: string;
  status: LedgerDayStatus;
  openingCash: number | null;
  activeTransactionCount: number;
  /** 已關帳日最新日結版本的實點現金；其他狀態為 null。 */
  countedCash: number | null;
}

export interface OpeningMismatchAnomaly {
  kind: 'opening-mismatch';
  /** 開帳現金與上次關帳不符的那一天（D）。 */
  dayId: string;
  openingCash: number;
  /** 日期早於 D 的最近一個已關帳日（P）與它最新日結版本的實點。 */
  previousClosedDayId: string;
  previousCountedCash: number;
  /** openingCash − previousCountedCash，不為 0。 */
  difference: number;
  /** D 與 P 相差幾個日曆天（連續兩天為 1）。 */
  daysApart: number;
}

export interface UnclosedPastDayAnomaly {
  kind: 'unclosed-past-day';
  dayId: string;
  status: 'open' | 'reopened';
  openingCash: number | null;
  activeTransactionCount: number;
}

export type LedgerAnomaly = OpeningMismatchAnomaly | UnclosedPastDayAnomaly;

function dayNumber(dayId: string): number {
  return Date.parse(`${dayId}T00:00:00.000Z`) / 86_400_000;
}

export function calendarDaysBetween(earlier: string, later: string): number {
  return Math.round(dayNumber(later) - dayNumber(earlier));
}

export interface PreviousClosedDay {
  dayId: string;
  countedCash: number;
}

/** 日期早於 dayId 的最近一個已關帳日；`days` 須依日期升冪。 */
export function previousClosedDay(closedDays: readonly PreviousClosedDay[], dayId: string): PreviousClosedDay | null {
  let found: PreviousClosedDay | null = null;
  for (const closed of closedDays) {
    if (closed.dayId >= dayId) break;
    found = closed;
  }
  return found;
}

/**
 * @param days 營業日（任意順序），今天以前的才會被檢查
 * @param today 伺服器租約的台北日期
 * 輸出依日期排序；同一天先列 unclosed-past-day 再列 opening-mismatch。
 */
export function computeLedgerAnomalies(days: readonly LedgerAnomalyDay[], today: string): LedgerAnomaly[] {
  const sorted = [...days].filter(day => day.dayId <= today).sort((a, b) => a.dayId.localeCompare(b.dayId));
  const closedDays: PreviousClosedDay[] = [];
  const anomalies: LedgerAnomaly[] = [];
  for (const day of sorted) {
    if (day.status !== 'closed' && day.dayId < today
      && (day.openingCash !== null || day.activeTransactionCount > 0)) {
      anomalies.push({
        kind: 'unclosed-past-day',
        dayId: day.dayId,
        status: day.status,
        openingCash: day.openingCash,
        activeTransactionCount: day.activeTransactionCount,
      });
    }
    if (day.openingCash !== null) {
      const previous = previousClosedDay(closedDays, day.dayId);
      if (previous && previous.countedCash !== day.openingCash) {
        anomalies.push({
          kind: 'opening-mismatch',
          dayId: day.dayId,
          openingCash: day.openingCash,
          previousClosedDayId: previous.dayId,
          previousCountedCash: previous.countedCash,
          difference: day.openingCash - previous.countedCash,
          daysApart: calendarDaysBetween(previous.dayId, day.dayId),
        });
      }
    }
    if (day.status === 'closed') {
      if (day.countedCash === null) throw new Error(`已關帳日 ${day.dayId} 缺少實點現金`);
      closedDays.push({ dayId: day.dayId, countedCash: day.countedCash });
    }
  }
  return anomalies;
}

/** 開帳表單用：輸入金額與上一個已關帳日的實點不同時回傳差額，否則 null。 */
export function openingDifference(previous: PreviousClosedDay | null, openingCash: number): number | null {
  if (!previous || previous.countedCash === openingCash) return null;
  return openingCash - previous.countedCash;
}
