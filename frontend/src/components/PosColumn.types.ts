import type { PosFlowState, PosMode, PosSelectionSource, ExpenseDirection } from '../domain/posFlow';
import type { StudentAccount } from '../domain/student';
import type { WorkflowTransactionView } from '../domain/transactionViews';
import type { TodayMenu, Vendor } from '../domain/menu';

export interface PosColumnProps {
  state: PosFlowState;
  isHistorical: boolean;
  dateStatus: string;
  viewDate: string;
  systemDate: string;
  setViewDate: (d: string) => void;
  // Student
  picked: StudentAccount | null;
  currentMode: PosMode;
  currentPaidAmount: string;
  allTx: WorkflowTransactionView[];
  students: StudentAccount[];
  selectStudent: (id: string, src: PosSelectionSource) => void;
  // Expense
  expenseProps: { kind: string; amountText: string; amount: number } | null;
  updateExpenseAmount: (t: string) => void;
  confirmExpenseAmount: (n: number) => void;
  selectExpenseDirection: (d: ExpenseDirection) => void;
  selectExpenseReason: (r: string) => void;
  updateExpenseNote: (n: string) => void;
  confirmExpenseNote: (n: string) => void;
  // Actions
  setPaidAmountText: (t: string) => void;
  handleConfirm: () => void;
  cancelFlow: () => void;
  changeMode: (m: PosMode) => void;
  setFocusZone: (z: string) => void;
  focusZone: string;
  openCancelConfirm: () => void;
  // Search
  setSearchText: (t: string) => void;
  searchFocusKey: number;
  hasFlash: boolean;
  // Misc
  crashDraftRestored: boolean;
  setCrashDraftRestored: (v: boolean) => void;
  todayMenu: TodayMenu;
  todayCount: number;
  vendors: Vendor[];
  enterExpenseMode: () => void;
  tweaks: { theme: string; fontSize: string; disableHoverSelection: boolean };
  // Recent strip
  tx: WorkflowTransactionView[];
  operatorUid: string;
  // Price override
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (v: number | null) => void;
  setPriceOverrideLabel: (v: string) => void;
  handleDeleteOrder: () => void;
  onViewHistory: () => void;
}
