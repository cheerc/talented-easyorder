import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  createInitialPosFlowState,
  reducePosFlow,
  toPosSourceDevice,
} from '../domain/posFlow';
import type { PosFlowState, PosMode, PosSelectionSource, ExpenseDirection } from '../domain/posFlow';
import type { ScannerInput } from '../domain/posSearch';
import { resolveScannedStudent } from '../domain/posSearch';
import { buildPosTransactionDraft, deriveTransactionAttributes } from '../domain/posTransaction';
import { saveCrashDraft } from '../storage/crashDraft';
import { checkStorageHealth } from '../storage/storageHealth';
import { countActiveOrdersForStudent } from '../domain/ledger';
import {
  validateIpadHandoffMessage,
  readHandoffIntent,
  toHandoffScannerInput,
} from '../domain/ipadHandoff';
import { usePosStore } from '../store/posStore';

export interface UsePosFlowArgs {
  businessDate: string;
  isHistorical: boolean;
  priceOverride: number | null;
  priceOverrideLabel: string;
}

export interface UsePosFlowReturn {
  state: PosFlowState;
  setSearchText: (text: string) => void;
  selectStudent: (studentId: string, source: PosSelectionSource) => void;
  changeMode: (mode: PosMode) => void;
  setPaidAmountText: (text: string) => void;
  enterExpenseMode: () => void;
  updateExpenseAmount: (text: string) => void;
  confirmExpenseAmount: (amount: number) => void;
  selectExpenseDirection: (direction: ExpenseDirection) => void;
  selectExpenseReason: (reason: '付便當錢' | '支出其他' | '收入其他') => void;
  updateExpenseNote: (note: string) => void;
  confirmExpenseNote: (note: string) => void;
  receiveScannerInput: (input: ScannerInput) => void;
  receiveIpadHandoff: (channel: string) => { ok: boolean; studentId?: string };
  requestConfirm: () => void;
  confirmDuplicate: () => void;
  cancelFlow: () => void;
  dismissSuccess: () => void;
  commitTransaction: () => void;
}

export function usePosFlow(args: UsePosFlowArgs): UsePosFlowReturn {
  const [state, dispatch] = useReducer(
    reducePosFlow,
    createInitialPosFlowState(args.isHistorical, args.businessDate),
  );

  const students = usePosStore((s) => s.students);
  const todayMenu = usePosStore((s) => s.todayMenu);
  const transactions = usePosStore((s) => s.transactions);
  const commitPosTransactionDraft = usePosStore((s) => s.commitPosTransactionDraft);

  const committingRef = useRef(false);
  const storageHealthyRef = useRef(true);

  useEffect(() => {
    storageHealthyRef.current = checkStorageHealth().ok;
  }, []);



  const setSearchText = useCallback((text: string) => {
    dispatch({ type: 'updateSearchText', text });
  }, []);

  const hintSearchText = state.kind === 'idle' ? state.searchText : '';
  const selectStudent = useCallback((studentId: string, source: PosSelectionSource) => {
    const searchTextHint = hintSearchText;
    const hasOrderToday = countActiveOrdersForStudent(transactions, studentId, args.businessDate) > 0;
    dispatch({ type: 'selectStudent', studentId, source, searchTextHint, hasOrderToday });
  }, [hintSearchText, transactions, args.businessDate]);

  const changeMode = useCallback((mode: PosMode) => {
    dispatch({ type: 'changeMode', mode });
  }, []);

  const setPaidAmountText = useCallback((text: string) => {
    dispatch({ type: 'updatePaidAmount', text });
  }, []);

  const enterExpenseMode = useCallback(() => {
    dispatch({ type: 'enterExpenseMode' });
  }, []);

  const updateExpenseAmount = useCallback((text: string) => {
    dispatch({ type: 'expenseUpdateAmount', text });
  }, []);

  const confirmExpenseAmount = useCallback((amount: number) => {
    dispatch({ type: 'expenseConfirmAmount', amount });
  }, []);

  const selectExpenseDirection = useCallback((direction: ExpenseDirection) => {
    dispatch({ type: 'expenseSelectDirection', direction });
  }, []);

  const selectExpenseReason = useCallback((reason: '付便當錢' | '支出其他' | '收入其他') => {
    dispatch({ type: 'expenseSelectReason', reason });
  }, []);

  const updateExpenseNote = useCallback((note: string) => {
    dispatch({ type: 'expenseUpdateNote', note });
  }, []);

  const confirmExpenseNote = useCallback((note: string) => {
    dispatch({ type: 'expenseConfirmNote', note });
  }, []);

  const receiveScannerInput = useCallback((input: ScannerInput) => {
    const result = resolveScannedStudent(students, input);
    if (result.ok && result.students.length === 1) {
      dispatch({ type: 'selectStudent', studentId: result.students[0].studentId, source: 'scan' });
    }
  }, [students]);

  const receiveIpadHandoff = useCallback((channel: string) => {
    const msg = readHandoffIntent(channel);
    if (!msg) return { ok: false };
    const validation = validateIpadHandoffMessage(msg);
    if (!validation.ok) return { ok: false };
    const scannerInput = toHandoffScannerInput(msg);
    const result = resolveScannedStudent(students, scannerInput);
    if (result.ok && result.students.length === 1) {
      dispatch({
        type: 'selectStudent',
        studentId: result.students[0].studentId,
        source: 'ipad',
      });
      return { ok: true, studentId: result.students[0].studentId };
    }
    return { ok: false };
  }, [students]);

  const requestConfirm = useCallback(() => {
    if (state.kind !== 'student_selected') return;

    if (state.mode === 'payment') {
      const amt = Number(state.paidAmountText || '0');
      if (!state.paidAmountText || !Number.isFinite(amt) || amt <= 0) {
        return;
      }
    }

    const activeOrderCount =
      state.mode === 'order'
        ? countActiveOrdersForStudent(transactions, state.studentId, args.businessDate)
        : 0;
    const hasDuplicateOrder = state.mode === 'order' && activeOrderCount > 0;

    dispatch({ type: 'requestCommit', hasDuplicateOrder });
  }, [state, transactions, args.businessDate]);

  const confirmDuplicate = useCallback(() => {
    dispatch({ type: 'confirmDuplicate' });
  }, []);

  const commitTransaction = useCallback(() => {
    if (state.kind !== 'committing' && state.kind !== 'duplicate_warning') return;
    if (committingRef.current) return;

    const sid = state.kind === 'committing' ? state.studentId : state.studentId;
    const mode = state.kind === 'committing' ? state.mode : 'order' as PosMode;
    const source = state.kind === 'committing' ? state.source : state.source;
    const paidAmountText = state.kind === 'committing' ? state.paidAmountText : state.paidAmountText;
    const expenseAmount = state.kind === 'committing' ? state.expenseAmount : undefined;
    const expenseNote = state.kind === 'committing' ? state.expenseNote : undefined;
    const expenseDirection = state.kind === 'committing' ? state.expenseDirection : undefined;

    committingRef.current = true;

    // Save crash draft for non-expense commits before store mutation
    if (mode !== 'expense' && storageHealthyRef.current && sid) {
      const student = students.find((s) => s.studentId === sid);
      if (student) {
        const crashAttrs = deriveTransactionAttributes({
          mode,
          todayMenuPrice: todayMenu.price,
          todayMenuItemName: todayMenu.itemName,
          priceOverride: args.priceOverride,
          priceOverrideLabel: args.priceOverrideLabel,
          paidAmountText,
        });
        const amount = mode === 'order' ? -crashAttrs.mealPrice : (mode === 'payment' ? crashAttrs.paidAmount : 0);
        saveCrashDraft({
          intent: {
            businessDate: args.businessDate,
            studentId: sid,
            type: mode,
            mealPrice: crashAttrs.mealPrice,
            paidAmount: crashAttrs.paidAmount,
            note: crashAttrs.note,
            sourceDevice: 'pc' as const,
          },
          snapshots: {
            student: { studentId: sid, studentNameSnapshot: student.displayName },
            menu: { menuNameSnapshot: todayMenu.itemName, menuPriceSnapshot: crashAttrs.mealPrice, vendorIdSnapshot: todayMenu.vendorId, vendorNameSnapshot: todayMenu.vendorNameSnapshot },
          },
          amount,
          expectedBalanceAfter: student.currentBalance + amount,
        });
      }
    }

    // If in duplicate_warning, confirm first
    if (state.kind === 'duplicate_warning') {
      dispatch({ type: 'confirmDuplicate' });
    }

    const attrs = deriveTransactionAttributes({
      mode,
      todayMenuPrice: todayMenu.price,
      todayMenuItemName: todayMenu.itemName,
      priceOverride: args.priceOverride,
      priceOverrideLabel: args.priceOverrideLabel,
      paidAmountText,
      expenseAmount,
      expenseNote,
      expenseDirection,
    });
    const mealPrice = attrs.mealPrice;
    const paidAmountVal = attrs.paidAmount;
    const note = attrs.note;

    try {
      if (mode === 'expense') {
        const student = students.length > 0 ? students[0] : null;
        const studentSnapshot = student
          ? { studentId: 'expense-operator', studentNameSnapshot: '櫃台' }
          : { studentId: 'expense-operator', studentNameSnapshot: '櫃台' };

        const draft = buildPosTransactionDraft({
          intent: {
            businessDate: args.businessDate,
            studentId: studentSnapshot.studentId,
            type: mode,
            mealPrice,
            paidAmount: paidAmountVal,
            note,
            sourceDevice: toPosSourceDevice(source),
          },
          student: {
            studentId: studentSnapshot.studentId,
            displayName: studentSnapshot.studentNameSnapshot,
            status: 'active',
            currentBalance: 0,
            aliases: [],
            faceEnrollmentStatus: 'none',
            createdAt: '',
            updatedAt: '',
            revision: 1,
          },
          menu: todayMenu,
        });

        commitPosTransactionDraft(draft);
        dispatch({
          type: 'commitSucceeded',
          transactionId: draft.intent.businessDate + '-' + Date.now(),
          syncStatus: 'queued',
        });
      } else {
        const student = students.find((s) => s.studentId === sid);
        if (!student) {
          dispatch({ type: 'commitFailed', message: '找不到學生', retryable: false });
          committingRef.current = false;
          return;
        }

        const intent = {
          businessDate: args.businessDate,
          studentId: sid ?? '',
          type: mode,
          mealPrice,
          paidAmount: paidAmountVal,
          note,
          sourceDevice: toPosSourceDevice(source),
        };

        const draft = buildPosTransactionDraft({
          intent,
          student,
          menu: todayMenu,
        });

        commitPosTransactionDraft(draft);
        dispatch({
          type: 'commitSucceeded',
          transactionId: draft.intent.businessDate + '-' + Date.now(),
          syncStatus: 'queued',
        });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '未知錯誤';
      dispatch({ type: 'commitFailed', message: '交易建立失敗: ' + errMsg, retryable: true });
    } finally {
      committingRef.current = false;
    }
  }, [state, students, todayMenu, commitPosTransactionDraft, args.businessDate, args.priceOverride, args.priceOverrideLabel]);

  // Auto-trigger commitTransaction when state transitions to committing
  useEffect(() => {
    if (state.kind !== 'committing') return;
    commitTransaction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);


  const cancelFlow = useCallback(() => {
    dispatch({ type: 'cancel' });
  }, []);

  const dismissSuccess = useCallback(() => {
    dispatch({ type: 'dismissSuccess' });
  }, []);

  return {
    state,
    setSearchText,
    selectStudent,
    changeMode,
    setPaidAmountText,
    enterExpenseMode,
    updateExpenseAmount,
    confirmExpenseAmount,
    selectExpenseDirection,
    selectExpenseReason,
    updateExpenseNote,
    confirmExpenseNote,
    receiveScannerInput,
    receiveIpadHandoff,
    requestConfirm,
    confirmDuplicate,
    cancelFlow,
    dismissSuccess,
    commitTransaction,
  };
}
