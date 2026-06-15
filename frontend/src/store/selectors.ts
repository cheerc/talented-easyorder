// Ref: #264 — Domain-specific selector hooks for re-render isolation.
// Facade pattern: single unified Zustand store internally, but consumers
// subscribe only to their relevant slice via useShallow.

import { useShallow } from 'zustand/shallow';
import { usePosStore } from './posStore';
import type {
  StudentStateSlice,
  TransactionStateSlice,
  MenuStateSlice,
  AuditStateSlice,
  SettlementStateSlice,
} from './posTypes';

// ─── State Selectors (subscribe only to domain slice) ───

/** Student domain state only. Re-renders only when students change. */
export function useStudents(): StudentStateSlice {
  return usePosStore(useShallow((s) => ({ students: s.students })));
}

/** Transaction domain state only. Re-renders only when transactions change. */
export function useTransactions(): TransactionStateSlice {
  return usePosStore(useShallow((s) => ({ transactions: s.transactions })));
}

/** Menu domain state only. Re-renders only when menu/vendors change. */
export function useMenu(): MenuStateSlice {
  return usePosStore(useShallow((s) => ({
    vendors: s.vendors,
    todayMenu: s.todayMenu,
  })));
}

/** Session + Audit + Settlement state. Re-renders only when these change. */
export function useSession(): AuditStateSlice & SettlementStateSlice {
  return usePosStore(useShallow((s) => ({
    auditEvents: s.auditEvents,
    dailySettlements: s.dailySettlements,
    businessDateStatuses: s.businessDateStatuses,
    cashSessions: s.cashSessions,
  })));
}

// ─── Action Selectors (stable references, no re-render on state change) ───

// Selectors hoisted to module scope for optimal perf (reviewer finding #4)
const transactionActionsSelector = (s: ReturnType<typeof usePosStore.getState>) => ({
  commitPosTransactionDraft: s.commitPosTransactionDraft,
  processTransaction: s.processTransaction,
  updateTransaction: s.updateTransaction,
  deleteTransaction: s.deleteTransaction,
  deleteOrderWithRefundCheck: s.deleteOrderWithRefundCheck,
  editTransaction: s.editTransaction,
});

const sessionActionsSelector = (s: ReturnType<typeof usePosStore.getState>) => ({
  setBusinessDateStatus: s.setBusinessDateStatus,
  openCashSession: s.openCashSession,
  updateOpeningCash: s.updateOpeningCash,
  closeBusinessDate: s.closeBusinessDate,
  reopenBusinessDate: s.reopenBusinessDate,
  getBusinessDateStatus: s.getBusinessDateStatus,
});

const menuActionsSelector = (s: ReturnType<typeof usePosStore.getState>) => ({
  setTodayMenu: s.setTodayMenu,
  setVendors: s.setVendors,
});

const studentActionsSelector = (s: ReturnType<typeof usePosStore.getState>) => ({
  addStudent: s.addStudent,
  disableStudent: s.disableStudent,
});

const globalActionsSelector = (s: ReturnType<typeof usePosStore.getState>) => ({
  resetData: s.resetData,
});

/** Transaction actions. Stable references — will not cause re-renders. */
export function useTransactionActions() {
  return usePosStore(useShallow(transactionActionsSelector));
}

/** Session actions. Stable references — will not cause re-renders. */
export function useSessionActions() {
  return usePosStore(useShallow(sessionActionsSelector));
}

/** Menu actions. Stable references. */
export function useMenuActions() {
  return usePosStore(useShallow(menuActionsSelector));
}

/** Student actions. Stable references. */
export function useStudentActions() {
  return usePosStore(useShallow(studentActionsSelector));
}

/** Global actions. */
export function useGlobalActions() {
  return usePosStore(useShallow(globalActionsSelector));
}
