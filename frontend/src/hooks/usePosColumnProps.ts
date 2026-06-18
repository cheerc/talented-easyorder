import type { PosColumnProps } from '../components/PosColumn.types';
import { useMemo } from 'react';

/**
 * Ref: #316 — Logical sub-groups for the 30+ deps of posColumnProps.
 * Each group represents a distinct concern; usePosColumnProps merges them
 * into a single memoized PosColumnProps object.
 */

/** Date/calendar state */
export interface PosColumnDateArgs {
  isHistorical: boolean;
  dateStatus: string;
  viewDate: string;
  systemDate: string;
  setViewDate: (d: string) => void;
}

/** POS flow state & actions */
export interface PosColumnFlowArgs {
  state: PosColumnProps['state'];
  picked: PosColumnProps['picked'];
  currentMode: PosColumnProps['currentMode'];
  currentPaidAmount: string;
  selectStudent: PosColumnProps['selectStudent'];
  setPaidAmountText: PosColumnProps['setPaidAmountText'];
  handleConfirm: PosColumnProps['handleConfirm'];
  cancelFlow: PosColumnProps['cancelFlow'];
  changeMode: PosColumnProps['changeMode'];
  openCancelConfirm: PosColumnProps['openCancelConfirm'];
  openCancelConfirmForTx: PosColumnProps['openCancelConfirmForTx'];
  handleDeleteOrder: PosColumnProps['handleDeleteOrder'];
  onViewHistory: () => void;
}

/** Expense flow actions */
export interface PosColumnExpenseArgs {
  expenseProps: PosColumnProps['expenseProps'];
  enterExpenseMode: PosColumnProps['enterExpenseMode'];
  updateExpenseAmount: PosColumnProps['updateExpenseAmount'];
  confirmExpenseAmount: PosColumnProps['confirmExpenseAmount'];
  selectExpenseDirection: PosColumnProps['selectExpenseDirection'];
  selectExpenseReason: PosColumnProps['selectExpenseReason'];
  updateExpenseNote: PosColumnProps['updateExpenseNote'];
  confirmExpenseNote: PosColumnProps['confirmExpenseNote'];
}

/** UI state */
export interface PosColumnUIArgs {
  setFocusZone: PosColumnProps['setFocusZone'];
  focusZone: string;
  hasFlash: boolean;
  crashDraftRestored: boolean;
  setCrashDraftRestored: (v: boolean) => void;
}

/** Search state */
export interface PosColumnSearchArgs {
  setSearchText: PosColumnProps['setSearchText'];
  searchFocusKey: number;
}

/** Menu & data */
export interface PosColumnMenuArgs {
  allTx: PosColumnProps['allTx'];
  students: PosColumnProps['students'];
  todayMenu: PosColumnProps['todayMenu'];
  todayCount: number;
  vendors: PosColumnProps['vendors'];
  tx: PosColumnProps['tx'];
  operatorUid: string;
  tweaks: PosColumnProps['tweaks'];
}

/** Price override */
export interface PosColumnPricingArgs {
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (v: number | null) => void;
  setPriceOverrideLabel: (v: string) => void;
}

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
  openCancelConfirmForTx: PosColumnProps['openCancelConfirmForTx'];
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
  operatorUid: string;
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
    openCancelConfirmForTx: args.openCancelConfirmForTx,
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
    operatorUid: args.operatorUid,
    priceOverride: args.priceOverride,
    priceOverrideLabel: args.priceOverrideLabel,
    setPriceOverride: args.setPriceOverride,
    setPriceOverrideLabel: args.setPriceOverrideLabel,
    handleDeleteOrder: args.handleDeleteOrder,
    onViewHistory: args.onViewHistory,
  };
}

/**
 * Ref: #316 — Hook wrapper for buildPosColumnProps.
 * Accepts logically-grouped arg objects instead of 30+ flat deps.
 * The useMemo dep array references the sub-objects; callers should
 * stabilize each sub-object (e.g. via useMemo or stable references).
 */
export function usePosColumnProps(
  date: PosColumnDateArgs,
  flow: PosColumnFlowArgs,
  expense: PosColumnExpenseArgs,
  ui: PosColumnUIArgs,
  search: PosColumnSearchArgs,
  menu: PosColumnMenuArgs,
  pricing: PosColumnPricingArgs,
): PosColumnProps {
  return useMemo(() => buildPosColumnProps({
    // date
    isHistorical: date.isHistorical,
    dateStatus: date.dateStatus,
    viewDate: date.viewDate,
    systemDate: date.systemDate,
    setViewDate: date.setViewDate,
    // flow
    state: flow.state,
    picked: flow.picked,
    currentMode: flow.currentMode,
    currentPaidAmount: flow.currentPaidAmount,
    selectStudent: flow.selectStudent,
    setPaidAmountText: flow.setPaidAmountText,
    handleConfirm: flow.handleConfirm,
    cancelFlow: flow.cancelFlow,
    changeMode: flow.changeMode,
    openCancelConfirm: flow.openCancelConfirm,
    openCancelConfirmForTx: flow.openCancelConfirmForTx,
    handleDeleteOrder: flow.handleDeleteOrder,
    onViewHistory: flow.onViewHistory,
    // expense
    expenseProps: expense.expenseProps,
    enterExpenseMode: expense.enterExpenseMode,
    updateExpenseAmount: expense.updateExpenseAmount,
    confirmExpenseAmount: expense.confirmExpenseAmount,
    selectExpenseDirection: expense.selectExpenseDirection,
    selectExpenseReason: expense.selectExpenseReason,
    updateExpenseNote: expense.updateExpenseNote,
    confirmExpenseNote: expense.confirmExpenseNote,
    // ui
    setFocusZone: ui.setFocusZone,
    focusZone: ui.focusZone,
    hasFlash: ui.hasFlash,
    crashDraftRestored: ui.crashDraftRestored,
    setCrashDraftRestored: ui.setCrashDraftRestored,
    // search
    setSearchText: search.setSearchText,
    searchFocusKey: search.searchFocusKey,
    // menu
    allTx: menu.allTx,
    students: menu.students,
    todayMenu: menu.todayMenu,
    todayCount: menu.todayCount,
    vendors: menu.vendors,
    tx: menu.tx,
    operatorUid: menu.operatorUid,
    tweaks: menu.tweaks,
    // pricing
    priceOverride: pricing.priceOverride,
    priceOverrideLabel: pricing.priceOverrideLabel,
    setPriceOverride: pricing.setPriceOverride,
    setPriceOverrideLabel: pricing.setPriceOverrideLabel,
  }), [date, flow, expense, ui, search, menu, pricing]);
}
