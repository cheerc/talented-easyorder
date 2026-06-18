import { useSession } from '../selectors';
import { getOpeningCash } from '../../domain/cashClose';
import type { DailyCashSession } from '../../domain/cashSession';

export function useCashClose(viewDate: string): {
  openingCash: number;
  dateStatus: string;
  currentCashSession: DailyCashSession | undefined;
} {
  const { businessDateStatuses, cashSessions, dailySettlements } = useSession();
  const dateStatus = businessDateStatuses?.[viewDate] || 'open';
  const currentCashSession = cashSessions[viewDate];

  const openingCash = getOpeningCash(viewDate, dailySettlements, currentCashSession);

  return { openingCash, dateStatus, currentCashSession };
}
