import { useMemo } from 'react';
import {
  useStudents,
  useTransactions,
  useMenu,
  useMenuActions,
  useSession,
  useSessionActions,
  useGlobalActions,
} from '../store/selectors';
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
  dailySettlements: ReturnType<typeof import('../store/selectors').useSession>['dailySettlements'];
  openCashSession: (input: { businessDate: string; openingCash: number; operatorId: string; openedAt: string }) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  tx: LedgerTransaction[];
  todayCount: number;
  queuedCount: number;
  failedSyncCount: number;
  conflictSyncCount: number;
}

/**
 * @deprecated Prefer domain-specific selectors (useStudents, useTransactions, useMenu, useSession, etc.)
 * from store/selectors.ts. This composite hook remains only for App.tsx posColumnProps orchestration.
 * Screens and sub-components should use domain selectors directly — see #264.
 */
export function useAppState(viewDate: string): UseAppStateReturn {
  const { students } = useStudents();
  const { transactions: allTx } = useTransactions();
  const { todayMenu, vendors } = useMenu();
  const { setTodayMenu, setVendors } = useMenuActions();
  const { cashSessions, dailySettlements } = useSession();
  const { openCashSession, updateOpeningCash, getBusinessDateStatus } = useSessionActions();
  const { resetData } = useGlobalActions();

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
