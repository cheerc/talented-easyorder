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
