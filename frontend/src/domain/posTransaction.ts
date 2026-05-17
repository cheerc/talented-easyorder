import type { StudentAccount, StudentSnapshot } from './student';
import type { TodayMenu, MenuSnapshot } from './menu';
import type { PosMode, PosSourceDevice } from './posFlow';
import { createStudentSnapshot } from './student';
import { createMenuSnapshot } from './menu';
import { calculateTransactionAmount, CASHIER_SENTINEL } from './ledger';

export interface PosTransactionIntent {
  businessDate: string;
  studentId: string;
  type: PosMode;
  mealPrice: number;
  paidAmount: number;
  note: string;
  sourceDevice: PosSourceDevice;
}

export interface PosTransactionSnapshotInput {
  student: StudentSnapshot;
  menu: MenuSnapshot;
}

export interface PosTransactionDraft {
  intent: PosTransactionIntent;
  snapshots: PosTransactionSnapshotInput;
  amount: number;
  expectedBalanceAfter: number;
}

export function parsePaidAmount(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: 0 };

  const num = Number(trimmed);
  if (!Number.isFinite(num) || !/^\d+$/.test(trimmed)) {
    return { ok: false, message: '請輸入有效正整數' };
  }
  if (!Number.isInteger(num)) {
    return { ok: false, message: '金額必須為整數' };
  }
  if (num < 0) {
    return { ok: false, message: '金額不可為負數' };
  }
  return { ok: true, value: num };
}

export interface BuildPosTransactionDraftArgs {
  intent: PosTransactionIntent;
  student: StudentAccount;
  menu: TodayMenu;
}

export function buildPosTransactionDraft(args: BuildPosTransactionDraftArgs): PosTransactionDraft {
  const snapshots: PosTransactionSnapshotInput = {
    student: createStudentSnapshot(args.student),
    menu: createMenuSnapshot(args.menu),
  };

  const amount = calculateTransactionAmount(args.intent.mealPrice, args.intent.paidAmount);
  const expectedBalanceAfter = Math.round(args.student.currentBalance + amount);

  return {
    intent: args.intent,
    snapshots,
    amount,
    expectedBalanceAfter,
  };
}

export interface BuildExpenseTransactionDraftArgs {
  businessDate: string;
  amount: number;
  note: string;
  sourceDevice: PosSourceDevice;
}

export function buildExpenseTransactionDraft(args: BuildExpenseTransactionDraftArgs): PosTransactionDraft {
  const snapshots: PosTransactionSnapshotInput = {
    student: { studentId: CASHIER_SENTINEL, studentNameSnapshot: '櫃台' },
    menu: { menuNameSnapshot: '', vendorNameSnapshot: '' },
  };

  return {
    intent: {
      businessDate: args.businessDate,
      studentId: CASHIER_SENTINEL,
      type: 'expense',
      mealPrice: args.amount,
      paidAmount: 0,
      note: args.note,
      sourceDevice: args.sourceDevice,
    },
    snapshots,
    amount: -args.amount,
    expectedBalanceAfter: 0,
  };
}
