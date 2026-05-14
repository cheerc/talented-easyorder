import { useCallback, useReducer, useRef } from 'react';
import {
  createInitialPosFlowState,
  reducePosFlow,
  toPosSourceDevice,
} from '../domain/posFlow';
import type { PosFlowState, PosMode, PosSelectionSource } from '../domain/posFlow';
import type { ScannerInput } from '../domain/posSearch';
import { resolveScannedStudent } from '../domain/posSearch';
import { parsePaidAmount, buildPosTransactionDraft } from '../domain/posTransaction';
import { countActiveOrdersForStudent, canCancelToday } from '../domain/ledger';
import {
  validateIpadHandoffMessage,
  readHandoffIntent,
  toHandoffScannerInput,
} from '../domain/ipadHandoff';
import { usePosStore } from '../store/posStore';

export interface UsePosFlowArgs {
  businessDate: string;
  isHistorical: boolean;
}

export interface UsePosFlowReturn {
  state: PosFlowState;
  setSearchText: (text: string) => void;
  selectStudent: (studentId: string, source: PosSelectionSource) => void;
  changeMode: (mode: PosMode) => void;
  setPaidAmountText: (text: string) => void;
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

  const setSearchText = useCallback((text: string) => {
    dispatch({ type: 'updateSearchText', text });
  }, []);

  const selectStudent = useCallback((studentId: string, source: PosSelectionSource) => {
    const searchTextHint = state.kind === 'idle' ? state.searchText : '';
    dispatch({ type: 'selectStudent', studentId, source, searchTextHint });
  }, [state.kind, state.searchText]);

  const changeMode = useCallback((mode: PosMode) => {
    const cancelAvailable =
      state.kind === 'student_selected'
        ? canCancelToday(transactions, state.studentId, args.businessDate)
        : false;
    dispatch({ type: 'changeMode', mode, cancelAvailable });
  }, [transactions, args.businessDate, state]);

  const setPaidAmountText = useCallback((text: string) => {
    dispatch({ type: 'updatePaidAmount', text });
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

    const activeOrderCount =
      state.mode === 'order'
        ? countActiveOrdersForStudent(transactions, state.studentId, args.businessDate)
        : 0;
    const cancelAvailable = canCancelToday(transactions, state.studentId, args.businessDate);
    const hasDuplicateOrder = state.mode === 'order' && activeOrderCount > 0;

    dispatch({ type: 'requestCommit', hasDuplicateOrder, cancelAvailable });
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

    committingRef.current = true;

    const student = students.find((s) => s.studentId === sid);
    if (!student) {
      dispatch({ type: 'commitFailed', message: '找不到學生', retryable: false });
      committingRef.current = false;
      return;
    }

    // If we're in duplicate_warning, transition to committing first
    if (state.kind === 'duplicate_warning') {
      dispatch({ type: 'confirmDuplicate' });
    }

    const parsedAmount = parsePaidAmount(paidAmountText);
    const paidAmountVal = parsedAmount.ok ? parsedAmount.value : 0;

    let mealPrice = 0;
    let note = '';
    if (mode === 'order') {
      mealPrice = todayMenu.price;
      note = todayMenu.itemName + (paidAmountVal > 0 ? ' (已付)' : '');
    } else if (mode === 'topup') {
      note = '現金儲值';
    } else if (mode === 'cancel') {
      note = '退餐';
    }

    const intent = {
      businessDate: args.businessDate,
      studentId: sid,
      type: mode,
      mealPrice,
      paidAmount: paidAmountVal,
      note,
      sourceDevice: toPosSourceDevice(source),
    };

    const activeOrder = mode === 'cancel'
      ? transactions.find(
          (t) =>
            t.studentId === sid &&
            t.type === 'order' &&
            t.businessDate === args.businessDate,
        )
      : undefined;

    try {
      const draft = buildPosTransactionDraft({
        intent,
        student,
        menu: todayMenu,
        activeOrder,
      });

      commitPosTransactionDraft(draft);
      dispatch({
        type: 'commitSucceeded',
        transactionId: draft.intent.businessDate + '-' + Date.now(),
        syncStatus: 'queued',
      });
    } catch {
      const errMsg = e instanceof Error ? e.message : '未知錯誤';
      dispatch({ type: 'commitFailed', message: '交易建立失敗: ' + errMsg, retryable: true });
    } finally {
      committingRef.current = false;
    }
  }, [state, students, todayMenu, transactions, commitPosTransactionDraft, args.businessDate]);

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
    receiveScannerInput,
    receiveIpadHandoff,
    requestConfirm,
    confirmDuplicate,
    cancelFlow,
    dismissSuccess,
    commitTransaction,
  };
}
