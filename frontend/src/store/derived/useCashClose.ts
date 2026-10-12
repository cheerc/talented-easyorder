import { useSession } from '../selectors';
import { getConfirmedOpeningCash, suggestOpeningCash } from '../../domain/cashClose';
import type { OpeningCashSuggestion } from '../../domain/cashClose';
import type { DailyCashSession } from '../../domain/cashSession';

export function useCashClose(viewDate: string): {
  /** 本人在 F3 確認過的開帳金額；沒有設定時是 null。 */
  openingCash: number | null;
  /** F3 預填用：重開日上一次關帳的開帳金額，或前一天關帳的實際點算。 */
  suggestedOpeningCash: OpeningCashSuggestion | null;
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
