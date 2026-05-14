import type { StudentAccount, StudentSnapshot } from './student';
import type { TodayMenu, MenuSnapshot } from './menu';
import type { LedgerTransaction } from './ledger';
import type { PosMode, PosSourceDevice } from './posFlow';
import { createStudentSnapshot } from './student';
import { createMenuSnapshot } from './menu';
import { calculateTransactionAmount } from './ledger';

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
  activeOrder?: LedgerTransaction;
}

export function buildPosTransactionDraft(args: BuildPosTransactionDraftArgs): PosTransactionDraft {
  const snapshots: PosTransactionSnapshotInput = {
    student: createStudentSnapshot(args.student),
    menu: createMenuSnapshot(args.menu),
  };

  let amount: number;
  if (args.intent.type === 'cancel' && args.activeOrder) {
    amount = -args.activeOrder.amount;
  } else {
    amount = calculateTransactionAmount(args.intent.mealPrice, args.intent.paidAmount);
  }

  const expectedBalanceAfter = args.student.currentBalance + amount;

  return {
    intent: args.intent,
    snapshots,
    amount,
    expectedBalanceAfter,
  };
}
