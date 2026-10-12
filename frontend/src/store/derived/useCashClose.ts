import { useSession } from '../selectors';
import { getConfirmedOpeningCash, suggestOpeningCash } from '../../domain/cashClose';
import type { DailyCashSession } from '../../domain/cashSession';

export function useCashClose(viewDate: string): {
  /** 本人在 F3 確認過的開帳金額；沒有設定時是 null。 */
  openingCash: number | null;
  /** F3 預填用：前一天關帳的實際點算。 */
  suggestedOpeningCash: number | null;
  dateStatus: string;
  currentCashSession: DailyCashSession | undefined;
} {
  const { businessDateStatuses, cashSessions, dailySettlements } = useSession();
  const dateStatus = businessDateStatuses?.[viewDate] || 'open';
  const currentCashSession = cashSessions[viewDate];

  const openingCash = getConfirmedOpeningCash(currentCashSession);
  const suggestedOpeningCash = suggestOpeningCash(viewDate, dailySettlements);

  return { openingCash, suggestedOpeningCash, dateStatus, currentCashSession };
}
