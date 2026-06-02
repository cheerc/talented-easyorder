import type { PosColumnProps } from '../components/PosColumn.types';

export function buildPosColumnProps(args: {
  state: PosColumnProps['state'];
  isHistorical: boolean;
  dateStatus: string;
  viewDate: string;
  systemDate: string;
  setViewDate: (d: string) => void;
  picked: PosColumnProps['picked'];
  currentMode: PosColumnProps['currentMode'];
  currentPaidAmount: string;
  allTx: PosColumnProps['allTx'];
  students: PosColumnProps['students'];
  selectStudent: PosColumnProps['selectStudent'];
  expenseProps: PosColumnProps['expenseProps'];
  updateExpenseAmount: PosColumnProps['updateExpenseAmount'];
  confirmExpenseAmount: PosColumnProps['confirmExpenseAmount'];
  selectExpenseDirection: PosColumnProps['selectExpenseDirection'];
  selectExpenseReason: PosColumnProps['selectExpenseReason'];
  updateExpenseNote: PosColumnProps['updateExpenseNote'];
  confirmExpenseNote: PosColumnProps['confirmExpenseNote'];
  setPaidAmountText: PosColumnProps['setPaidAmountText'];
  handleConfirm: PosColumnProps['handleConfirm'];
  cancelFlow: PosColumnProps['cancelFlow'];
  changeMode: PosColumnProps['changeMode'];
  setFocusZone: PosColumnProps['setFocusZone'];
  focusZone: string;
  openCancelConfirm: PosColumnProps['openCancelConfirm'];
  setSearchText: PosColumnProps['setSearchText'];
  searchFocusKey: number;
  hasFlash: boolean;
  crashDraftRestored: boolean;
  setCrashDraftRestored: (v: boolean) => void;
  todayMenu: PosColumnProps['todayMenu'];
  todayCount: number;
  vendors: PosColumnProps['vendors'];
  enterExpenseMode: PosColumnProps['enterExpenseMode'];
  tweaks: PosColumnProps['tweaks'];
  tx: PosColumnProps['tx'];
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (v: number | null) => void;
  setPriceOverrideLabel: (v: string) => void;
  handleDeleteOrder: PosColumnProps['handleDeleteOrder'];
  onViewHistory: () => void;
}): PosColumnProps {
  return {
    state: args.state,
    isHistorical: args.isHistorical,
    dateStatus: args.dateStatus,
    viewDate: args.viewDate,
    systemDate: args.systemDate,
    setViewDate: args.setViewDate,
    picked: args.picked,
    currentMode: args.currentMode,
    currentPaidAmount: args.currentPaidAmount,
    allTx: args.allTx,
    students: args.students,
    selectStudent: args.selectStudent,
    expenseProps: args.expenseProps,
    updateExpenseAmount: args.updateExpenseAmount,
    confirmExpenseAmount: args.confirmExpenseAmount,
    selectExpenseDirection: args.selectExpenseDirection,
    selectExpenseReason: args.selectExpenseReason,
    updateExpenseNote: args.updateExpenseNote,
    confirmExpenseNote: args.confirmExpenseNote,
    setPaidAmountText: args.setPaidAmountText,
    handleConfirm: args.handleConfirm,
    cancelFlow: args.cancelFlow,
    changeMode: args.changeMode,
    setFocusZone: args.setFocusZone,
    focusZone: args.focusZone,
    openCancelConfirm: args.openCancelConfirm,
    setSearchText: args.setSearchText,
    searchFocusKey: args.searchFocusKey,
    hasFlash: args.hasFlash,
    crashDraftRestored: args.crashDraftRestored,
    setCrashDraftRestored: args.setCrashDraftRestored,
    todayMenu: args.todayMenu,
    todayCount: args.todayCount,
    vendors: args.vendors,
    enterExpenseMode: args.enterExpenseMode,
    tweaks: args.tweaks,
    tx: args.tx,
    priceOverride: args.priceOverride,
    priceOverrideLabel: args.priceOverrideLabel,
    setPriceOverride: args.setPriceOverride,
    setPriceOverrideLabel: args.setPriceOverrideLabel,
    handleDeleteOrder: args.handleDeleteOrder,
    onViewHistory: args.onViewHistory,
  };
}
