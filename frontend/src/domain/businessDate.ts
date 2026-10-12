export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export function isHistoricalBusinessDate(viewDate: string, systemDate: string): boolean {
  return viewDate < systemDate;
}

export function canWriteBusinessDate(
  status: BusinessDateStatus,
  viewDate: string,
  systemDate: string,
): boolean {
  if (isHistoricalBusinessDate(viewDate, systemDate)) return false;
  if (status === 'closed') return false;
  return true;
}

/** M0 S-DATE：營業日加減天數（YYYY-MM-DD，以 UTC 計算避免時區偏移）。 */
export function shiftBusinessDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
