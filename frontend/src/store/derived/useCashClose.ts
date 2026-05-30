import { usePosStore } from '../posStore';
import { getOpeningCash } from '../../domain/cashClose';
import type { DailyCashSession } from '../../domain/cashSession';

export function useCashClose(viewDate: string): {
  openingCash: number;
  dateStatus: string;
  currentCashSession: DailyCashSession | undefined;
} {
  const dateStatus = usePosStore((s) => s.getBusinessDateStatus(viewDate));
  const cashSessions = usePosStore((s) => s.cashSessions);
  const dailySettlements = usePosStore((s) => s.dailySettlements);
  const currentCashSession = cashSessions[viewDate];

  const openingCash = getOpeningCash(viewDate, dailySettlements, currentCashSession);

  return { openingCash, dateStatus, currentCashSession };
}
