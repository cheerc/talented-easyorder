import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { usePosStore } from '../store/posStore';
import type { StudentAccount } from '../domain/student';
import type { LedgerTransaction } from '../domain/ledger';
import type { TodayMenu, Vendor } from '../domain/menu';

export interface UseAppStateReturn {
  students: StudentAccount[];
  allTx: LedgerTransaction[];
  todayMenu: TodayMenu;
  vendors: Vendor[];
  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  resetData: () => void;
  getBusinessDateStatus: (date: string) => string;
  cashSessions: Record<string, { openingCash: number }>;
  dailySettlements: ReturnType<typeof usePosStore.getState>['dailySettlements'];
  openCashSession: (input: { businessDate: string; openingCash: number; operatorId: string; openedAt: string }) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  tx: LedgerTransaction[];
  todayCount: number;
  queuedCount: number;
  failedSyncCount: number;
  conflictSyncCount: number;
}

export function useAppState(viewDate: string): UseAppStateReturn {
  const {
    students,
    transactions: allTx,
    todayMenu,
    vendors,
    setTodayMenu,
    setVendors,
    resetData,
    getBusinessDateStatus,
    cashSessions,
    dailySettlements,
    openCashSession,
    updateOpeningCash,
  } = usePosStore(useShallow((s) => ({
    students: s.students,
    transactions: s.transactions,
    todayMenu: s.todayMenu,
    vendors: s.vendors,
    setTodayMenu: s.setTodayMenu,
    setVendors: s.setVendors,
    resetData: s.resetData,
    getBusinessDateStatus: s.getBusinessDateStatus,
    cashSessions: s.cashSessions,
    dailySettlements: s.dailySettlements,
    openCashSession: s.openCashSession,
    updateOpeningCash: s.updateOpeningCash,
  })));

  const tx = useMemo(() =>
    allTx.filter(t => t.businessDate === viewDate).reverse().slice(0, 200),
  [allTx, viewDate]);

  const todayCount = useMemo(() => {
    const defaultBentoOrders = tx.filter(t =>
      t.type === 'order' &&
      t.menuNameSnapshot === todayMenu.itemName &&
      t.mealPrice === todayMenu.price &&
      (!t.note || !t.note.startsWith('單筆改價：'))
    );
    return defaultBentoOrders.length;
  }, [tx, todayMenu.itemName, todayMenu.price]);

  const queuedCount = useMemo(() => allTx.filter(t => t.syncStatus === 'queued').length, [allTx]);
  const failedSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'failed').length, [allTx]);
  const conflictSyncCount = useMemo(() => allTx.filter(t => t.syncStatus === 'conflict').length, [allTx]);

  return {
    students, allTx, todayMenu, vendors,
    setTodayMenu, setVendors, resetData,
    getBusinessDateStatus, cashSessions, dailySettlements,
    openCashSession, updateOpeningCash,
    tx, todayCount, queuedCount, failedSyncCount, conflictSyncCount,
  };
}
