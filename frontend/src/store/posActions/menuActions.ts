import type { PosState } from '../posTypes';
import { isMenuReady } from '../../domain/menu';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX } from '../../mocks/initialData';

const defaultState = {
  auditEvents: [] as PosState['auditEvents'],
  dailySettlements: [] as PosState['dailySettlements'],
  businessDateStatuses: {} as PosState['businessDateStatuses'],
  cashSessions: {} as PosState['cashSessions'],
};

export function createMenuActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void
): Pick<PosState, 'setTodayMenu' | 'setMenuForDate' | 'setVendors' | 'resetData'> {
  return {
    setTodayMenu: (menu) => set({ todayMenu: menu }),
    setMenuForDate: (date, menu, now) => set((state) => {
      const prev = state.menusByDate[date];
      const saved = { ...menu, businessDate: date, updatedAt: now, revision: (prev?.revision ?? 0) + 1 };
      // 第一次依日期儲存時，把原本的單一菜單留在它自己的日期，不被新設定覆蓋（不論新日期較早或較晚）。
      const legacy = state.todayMenu;
      const seed = Object.keys(state.menusByDate).length === 0 && isMenuReady(legacy) && legacy.businessDate !== date
        ? { [legacy.businessDate]: legacy } : {};
      const menusByDate = { ...seed, ...state.menusByDate, [date]: saved };
      // todayMenu 保持為最新營業日的設定，給仍讀單一菜單的舊路徑與沒有日期設定時的後備。
      const isLatest = Object.keys(menusByDate).every(k => k <= date);
      return isLatest ? { menusByDate, todayMenu: saved } : { menusByDate };
    }),
    setVendors: (vendors) => set({ vendors }),

    resetData: () => set({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      todayMenu: INITIAL_TODAY_MENU,
      menusByDate: {},
      ...defaultState,
    }),
  };
}
