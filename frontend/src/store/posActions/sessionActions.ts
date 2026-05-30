import type { PosState } from '../posTypes';
import { validateCashClose, createDailySettlement, reopenBusinessDate as reopenSettlement } from '../../domain/cashClose';
import { calculateLedgerTotals } from '../../domain/ledgerReport';
import { createDailyCashSession } from '../../domain/cashSession';

export function createSessionActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState
): Pick<PosState, 'openCashSession' | 'updateOpeningCash' | 'closeBusinessDate' | 'reopenBusinessDate' | 'setBusinessDateStatus' | 'getBusinessDateStatus'> {
  return {
    openCashSession: (input) => {
      set((state) => {
        if (state.cashSessions[input.businessDate]) return state;

        return {
          cashSessions: {
            ...state.cashSessions,
            [input.businessDate]: createDailyCashSession({
              businessDate: input.businessDate,
              openingCash: input.openingCash,
              openedBy: input.operatorId,
              openedAt: input.openedAt,
            }),
          },
        };
      });
    },

    updateOpeningCash: (businessDate, amount) => {
      set((state) => {
        const existing = state.cashSessions[businessDate];
        if (!existing) return state;
        const dateStatus = state.businessDateStatuses[businessDate] || 'open';
        if (dateStatus === 'closed') return state;
        return {
          cashSessions: {
            ...state.cashSessions,
            [businessDate]: { ...existing, openingCash: amount },
          },
        };
      });
    },

    setBusinessDateStatus: (date, status) => {
      set(state => ({
        businessDateStatuses: { ...state.businessDateStatuses, [date]: status },
      }));
    },

    closeBusinessDate: (input) => {
      const state = get();
      const { businessDate, countedCash, note, queuedSettlementAccepted, operatorId } = input;

      if (state.businessDateStatuses[businessDate] === 'closed') return;

      const dayTx = state.transactions.filter(t => t.businessDate === businessDate);
      const totals = calculateLedgerTotals(dayTx);

      const hasQueued = dayTx.some(t => t.syncStatus === 'queued');
      const hasFailed = dayTx.some(t => t.syncStatus === 'failed');
      const hasConflict = dayTx.some(t => t.syncStatus === 'conflict');

      const cashSession = state.cashSessions[businessDate];
      const openingCash = cashSession?.openingCash ?? 0;
      const expectedCash = openingCash + totals.netCash;

      const validation = validateCashClose(expectedCash, countedCash, hasFailed, hasConflict, hasQueued, note);
      if (!validation.ok) return;

      if (hasQueued && !queuedSettlementAccepted) return;

      const now = new Date().toISOString();
      const settlement = createDailySettlement(businessDate, totals, openingCash, countedCash, note, operatorId, now, hasQueued);

      set(state => ({
        dailySettlements: [...state.dailySettlements, settlement],
        businessDateStatuses: { ...state.businessDateStatuses, [businessDate]: 'closed' },
      }));
    },

    reopenBusinessDate: (input) => {
      const state = get();
      const { businessDate, reason, operatorId } = input;

      if (state.businessDateStatuses[businessDate] === 'open') return;

      const existing = state.dailySettlements
        .filter(s => s.businessDate === businessDate)
        .sort((a, b) => b.settlementRevision - a.settlementRevision)[0];

      if (!existing) return;

      const now = new Date().toISOString();
      const reopened = reopenSettlement(existing, reason, operatorId, now);

      set(state => ({
        dailySettlements: [...state.dailySettlements, reopened],
        businessDateStatuses: { ...state.businessDateStatuses, [businessDate]: 'reopened' },
      }));
    },

    getBusinessDateStatus: (businessDate) => {
      return get().businessDateStatuses[businessDate] || 'open';
    },
  };
}
