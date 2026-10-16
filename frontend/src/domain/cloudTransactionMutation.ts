/**
 * P10a：雲端交易更正、作廢、取消（留款／退款）與 5 秒撤回的共用算式。
 * 規格來源：docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §6.1、§7.1、§7.2
 * 契約：docs/superpowers/specs/2026-10-16-cloud-transaction-mutations-contract.md
 *
 * Rules（firestore.rules 的 mutationCashEffect、validCorrectedTransaction、validKeepDepositTransaction、
 * studentContribution、totalsContribution）與這裡是同一套算式；repository 用它組文件，receipt 驗證與畫面
 * 預覽也用它，避免出現第二套口徑。
 */
import type { CommandCashEffect } from './cloudCommands';
import { contribution, type DayTotalsContribution } from './cloudLedgerProjection';

export type TransactionMutationKind =
  | 'CorrectTransaction'
  | 'VoidTransaction'
  | 'CancelKeepDeposit'
  | 'CancelRefund'
  | 'Undo';

export const TRANSACTION_MUTATION_KINDS: readonly TransactionMutationKind[] = [
  'CorrectTransaction',
  'VoidTransaction',
  'CancelKeepDeposit',
  'CancelRefund',
  'Undo',
] as const;

/** Spec §7.2：5 秒撤回的固定理由。 */
export const UNDO_REASON = '送出後立即撤回';
/** Spec §7.2：撤回是成功確認後的畫面時窗，不是安全界線（Rules 另以原建立者、revision 1、台北今天把關）。 */
export const UNDO_WINDOW_MS = 5_000;

export function isTransactionMutationKind(kind: unknown): kind is TransactionMutationKind {
  return typeof kind === 'string' && (TRANSACTION_MUTATION_KINDS as readonly string[]).includes(kind);
}

/** 交易文件中會被更正或取消改動的業務欄位。 */
export interface MutableTransaction {
  type: 'order' | 'payment' | 'expense' | 'refund';
  mealKind: 'bento' | 'other' | null;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  status: 'active' | 'voided';
  note: string;
  menuNameSnapshot: string;
  menuPriceSnapshot: number;
  vendorIdSnapshot: string;
  vendorNameSnapshot: string;
  otherItemName: string | null;
}

export interface CorrectTransactionPayload {
  mealPrice: number;
  paidAmount: number;
  amount: number;
  note: string;
  reason: string;
}

export type TransactionMutationPayload =
  | { kind: 'CorrectTransaction'; payload: CorrectTransactionPayload }
  | { kind: 'VoidTransaction' | 'CancelKeepDeposit' | 'CancelRefund'; payload: { reason: string } }
  | { kind: 'Undo'; payload: { targetCommandId: string; reason: string } };

export class TransactionMutationRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionMutationRejected';
  }
}

/** Spec §7.1 cash contribution: order/payment paidAmount, expense paidAmount − mealPrice, refund −amount, voided 0. */
export function cashContribution(tx: Pick<MutableTransaction, 'status' | 'type' | 'mealPrice' | 'paidAmount' | 'amount'>): number {
  if (tx.status !== 'active') return 0;
  if (tx.type === 'expense') return tx.paidAmount - tx.mealPrice;
  if (tx.type === 'refund') return -tx.amount;
  return tx.paidAmount;
}

/** Student balance contribution: order/payment amount (= paidAmount − mealPrice), refund −amount, voided 0. */
export function studentContribution(tx: Pick<MutableTransaction, 'status' | 'type' | 'amount'>): number {
  if (tx.status !== 'active') return 0;
  return tx.type === 'refund' ? -tx.amount : tx.amount;
}

export function totalsContribution(tx: MutableTransaction & { transactionId?: string; studentId?: string }): DayTotalsContribution {
  return contribution({
    transactionId: tx.transactionId ?? '',
    studentId: tx.studentId ?? '',
    businessDate: '',
    createdAt: '',
    type: tx.type,
    mealKind: tx.mealKind,
    mealPrice: tx.mealPrice,
    paidAmount: tx.paidAmount,
    amount: tx.amount,
    status: tx.status,
  });
}

/** Spec §7.1/§7.2 cashEffect, identical to Rules `mutationCashEffect`. */
export function mutationCashEffect(kind: TransactionMutationKind, before: MutableTransaction, after: MutableTransaction): CommandCashEffect {
  const b = cashContribution(before);
  const a = cashContribution(after);
  const reasonKind: CommandCashEffect['reasonKind'] = kind === 'CorrectTransaction' ? (a === b ? 'none' : 'correction')
    : kind === 'VoidTransaction' ? (b === 0 ? 'none' : 'correction')
      : kind === 'CancelKeepDeposit' ? 'none'
        : before.type === 'expense' || before.type === 'refund' ? 'reversal'
          : before.paidAmount > 0 ? 'refund' : 'none';
  return {
    before: b,
    after: a,
    delta: a - b,
    reasonKind,
    refundAmount: reasonKind === 'refund' ? before.paidAmount : 0,
  };
}

/**
 * Applies one mutation to an active row and returns the business fields after it. Throws
 * TransactionMutationRejected for anything Rules would refuse (wrong type, voided row, no change...).
 * Server metadata (revision, lastCommandId, updatedAt) is added by the caller.
 */
export function applyTransactionMutation<T extends MutableTransaction>(before: T, mutation: TransactionMutationPayload): T {
  if (before.status !== 'active') throw new TransactionMutationRejected('這筆交易已作廢，不能再更正或取消');
  if (mutation.kind === 'CorrectTransaction') {
    const { mealPrice, paidAmount, amount, note } = mutation.payload;
    if (before.type === 'refund') {
      if (mealPrice !== 0 || paidAmount !== 0 || amount < 1) throw new TransactionMutationRejected('退款金額必須是正整數');
      if (note.trim().length < 1) throw new TransactionMutationRejected('退款原因不能空白');
    } else {
      if (amount !== paidAmount - mealPrice) throw new TransactionMutationRejected('更正金額不一致');
      if (before.type === 'payment' && (mealPrice !== 0 || paidAmount < 1)) {
        throw new TransactionMutationRejected('繳費金額必須大於零；要改成零請用作廢');
      }
      if (before.type === 'expense') {
        if (note.trim().length < 1) throw new TransactionMutationRejected('櫃台收支原因不能空白');
        const income = before.paidAmount > 0;
        if (income ? mealPrice !== 0 || paidAmount < 1 : paidAmount !== 0 || mealPrice < 1) {
          throw new TransactionMutationRejected('櫃台收支更正不能改變收入或支出方向，金額必須大於零');
        }
      }
    }
    if (mealPrice === before.mealPrice && paidAmount === before.paidAmount && amount === before.amount && note === before.note) {
      throw new TransactionMutationRejected('更正內容沒有變更');
    }
    return { ...before, mealPrice, paidAmount, amount, note };
  }
  if (mutation.kind === 'CancelKeepDeposit' || mutation.kind === 'CancelRefund') {
    if (before.type !== 'order') throw new TransactionMutationRejected('只有訂餐可以取消');
  }
  if (mutation.kind === 'CancelKeepDeposit' && before.paidAmount > 0) {
    return {
      ...before,
      type: 'payment',
      mealKind: null,
      mealPrice: 0,
      amount: before.paidAmount,
      menuNameSnapshot: '',
      menuPriceSnapshot: 0,
      vendorIdSnapshot: '',
      vendorNameSnapshot: '',
      otherItemName: null,
    };
  }
  return { ...before, status: 'voided' };
}
