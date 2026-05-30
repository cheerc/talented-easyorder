import type { PosState } from '../posTypes';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX } from '../../mocks/initialData';

const defaultState = {
  auditEvents: [] as PosState['auditEvents'],
  dailySettlements: [] as PosState['dailySettlements'],
  businessDateStatuses: {} as PosState['businessDateStatuses'],
  cashSessions: {} as PosState['cashSessions'],
};

export function createMenuActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void
): Pick<PosState, 'setTodayMenu' | 'setVendors' | 'resetData'> {
  return {
    setTodayMenu: (menu) => set({ todayMenu: menu }),
    setVendors: (vendors) => set({ vendors }),

    resetData: () => set({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      todayMenu: INITIAL_TODAY_MENU,
      ...defaultState,
    }),
  };
}
