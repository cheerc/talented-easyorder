import { useCallback, useEffect, useRef } from 'react';
import type { PosFlowEvent, PosFlowState, PosMode } from '../domain/posFlow';
import { toPosSourceDevice } from '../domain/posFlow';
import type { StudentAccount } from '../domain/student';
import type { TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';
import { countActiveOrdersForStudent, CASHIER_SENTINEL } from '../domain/ledger';
import type { PosTransactionDraft } from '../domain/posTransaction';
import { buildPosTransactionDraft, deriveTransactionAttributes } from '../domain/posTransaction';
import { saveCrashDraft } from '../storage/crashDraft';
import { checkStorageHealth } from '../storage/storageHealth';

interface UseTransactionCommitArgs {
  businessDate: string;
  priceOverride: number | null;
  priceOverrideLabel: string;
}

export function useTransactionCommit(
  dispatch: (action: PosFlowEvent) => void,
  state: PosFlowState,
  students: StudentAccount[],
  todayMenu: TodayMenu,
  transactions: LedgerTransaction[],
  commitPosTransactionDraft: (draft: PosTransactionDraft) => void,
  args: UseTransactionCommitArgs,
) {
  const committingRef = useRef(false);
  const storageHealthyRef = useRef(true);

  useEffect(() => {
    storageHealthyRef.current = checkStorageHealth().ok;
  }, []);

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
  }, [dispatch, state, transactions, args.businessDate]);

  const confirmDuplicate = useCallback(() => {
    dispatch({ type: 'confirmDuplicate' });
  }, [dispatch]);

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
        // Ref: #283 — Use CASHIER_SENTINEL to match domain layer convention.
        const studentSnapshot = { studentId: CASHIER_SENTINEL, studentNameSnapshot: '櫃台' };

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
  }, [dispatch, state, students, todayMenu, commitPosTransactionDraft, args.businessDate, args.priceOverride, args.priceOverrideLabel]);

  return { requestConfirm, confirmDuplicate, commitTransaction };
}
