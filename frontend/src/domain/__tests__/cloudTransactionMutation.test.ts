import { describe, expect, it } from 'vitest';
import { normalizeEnabledCommandInput } from '../cloudCommandSchema';
import {
  applyTransactionMutation,
  mutationCashEffect,
  studentContribution,
  totalsContribution,
  TransactionMutationRejected,
  UNDO_REASON,
  type MutableTransaction,
  type TransactionMutationPayload,
} from '../cloudTransactionMutation';

const commandId = '33333333-3333-4333-8333-333333333333';
const transactionId = '44444444-4444-4444-8444-444444444444';
const studentId = '55555555-5555-4555-8555-555555555555';
const dayId = '2026-10-16';

function tx(overrides: Partial<MutableTransaction> = {}): MutableTransaction {
  return {
    type: 'order', mealKind: 'bento', mealPrice: 90, paidAmount: 100, amount: 10, status: 'active', note: '',
    menuNameSnapshot: '排骨飯', menuPriceSnapshot: 90, vendorIdSnapshot: 'v1', vendorNameSnapshot: '阿榮', otherItemName: null,
    ...overrides,
  };
}
const payment = (paid: number) => tx({
  type: 'payment', mealKind: null, mealPrice: 0, paidAmount: paid, amount: paid,
  menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '',
});
const expense = (meal: number, paid: number, note = '付餐費給廠商') => ({ ...payment(0), type: 'expense' as const, mealPrice: meal, paidAmount: paid, amount: paid - meal, note });
const refund = (amount: number) => ({ ...payment(0), type: 'refund' as const, amount, note: '學期結束' });

function effect(before: MutableTransaction, mutation: TransactionMutationPayload) {
  return mutationCashEffect(mutation.kind, before, applyTransactionMutation(before, mutation));
}

describe('P10a mutation arithmetic (same as Rules)', () => {
  it('L02: correcting a meal 90 → 110 changes the balance contribution, not cash', () => {
    const before = tx();
    const after = applyTransactionMutation(before, {
      kind: 'CorrectTransaction', payload: { mealPrice: 110, paidAmount: 100, amount: -10, note: '', reason: '價格記錯' },
    });
    expect(studentContribution(after) - studentContribution(before)).toBe(-20);
    expect(mutationCashEffect('CorrectTransaction', before, after)).toEqual({ before: 100, after: 100, delta: 0, reasonKind: 'none', refundAmount: 0 });
  });

  it('L03: cancelling and keeping the deposit turns the order into a payment of what was paid', () => {
    const after = applyTransactionMutation(tx(), { kind: 'CancelKeepDeposit', payload: { reason: '請假' } });
    expect(after).toMatchObject({ type: 'payment', status: 'active', mealKind: null, mealPrice: 0, paidAmount: 100, amount: 100, menuNameSnapshot: '' });
    expect(totalsContribution(after)).toMatchObject({ bentoCount: 0, mealTotal: 0, retainedReceipts: 100 });
    expect(mutationCashEffect('CancelKeepDeposit', tx(), after).delta).toBe(0);
  });

  it('L04 / zero-paid: cancelling with a refund voids and returns the paid cash once; a zero-paid cancel is a void, never a zero payment', () => {
    expect(effect(tx(), { kind: 'CancelRefund', payload: { reason: '請假' } }))
      .toEqual({ before: 100, after: 0, delta: -100, reasonKind: 'refund', refundAmount: 100 });
    const unpaid = tx({ paidAmount: 0, amount: -90 });
    const kept = applyTransactionMutation(unpaid, { kind: 'CancelKeepDeposit', payload: { reason: '請假' } });
    expect(kept).toMatchObject({ type: 'order', status: 'voided' });
    expect(mutationCashEffect('CancelKeepDeposit', unpaid, kept)).toEqual({ before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 });
  });

  it('L11: undo maps payments to refund and counter cash or refunds to reversal', () => {
    const undo: TransactionMutationPayload = { kind: 'Undo', payload: { targetCommandId: commandId, reason: UNDO_REASON } };
    expect(effect(payment(100), undo)).toEqual({ before: 100, after: 0, delta: -100, reasonKind: 'refund', refundAmount: 100 });
    expect(effect(expense(0, 50, '零錢補充'), undo)).toEqual({ before: 50, after: 0, delta: -50, reasonKind: 'reversal', refundAmount: 0 });
    expect(effect(expense(80, 0), undo)).toEqual({ before: -80, after: 0, delta: 80, reasonKind: 'reversal', refundAmount: 0 });
    expect(effect(refund(60), undo)).toEqual({ before: -60, after: 0, delta: 60, reasonKind: 'reversal', refundAmount: 0 });
    expect(effect(tx({ paidAmount: 0, amount: -90 }), undo).reasonKind).toBe('none');
  });

  it('a book correction of a collection 100 → 80 is −20 cash with reasonKind correction', () => {
    expect(effect(payment(100), { kind: 'CorrectTransaction', payload: { mealPrice: 0, paidAmount: 80, amount: 80, note: '', reason: '記錯' } }))
      .toEqual({ before: 100, after: 80, delta: -20, reasonKind: 'correction', refundAmount: 0 });
    expect(effect(payment(100), { kind: 'VoidTransaction', payload: { reason: '重複' } }).reasonKind).toBe('correction');
  });

  it.each([
    ['a voided row', { ...payment(10), status: 'voided' as const }, { kind: 'VoidTransaction', payload: { reason: 'x' } }],
    ['a payment corrected to zero', payment(10), { kind: 'CorrectTransaction', payload: { mealPrice: 0, paidAmount: 0, amount: 0, note: '', reason: 'x' } }],
    ['an expense turned into income', expense(80, 0), { kind: 'CorrectTransaction', payload: { mealPrice: 0, paidAmount: 80, amount: 80, note: 'x', reason: 'x' } }],
    ['an expense with an empty note', expense(80, 0), { kind: 'CorrectTransaction', payload: { mealPrice: 70, paidAmount: 0, amount: -70, note: ' ', reason: 'x' } }],
    ['a refund of zero', refund(60), { kind: 'CorrectTransaction', payload: { mealPrice: 0, paidAmount: 0, amount: 0, note: 'x', reason: 'x' } }],
    ['an inconsistent amount', tx(), { kind: 'CorrectTransaction', payload: { mealPrice: 90, paidAmount: 100, amount: 0, note: '', reason: 'x' } }],
    ['nothing changed', tx(), { kind: 'CorrectTransaction', payload: { mealPrice: 90, paidAmount: 100, amount: 10, note: '', reason: 'x' } }],
    ['cancelling a payment', payment(10), { kind: 'CancelRefund', payload: { reason: 'x' } }],
  ] as const)('refuses %s', (_label, before, mutation) => {
    expect(() => applyTransactionMutation(before as MutableTransaction, mutation as TransactionMutationPayload)).toThrow(TransactionMutationRejected);
  });
});

describe('P10a mutation command schema', () => {
  const studentInput = (kind: string, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    commandId, kind, leaseEpoch: 1,
    targets: { transactionId, studentId, dayId },
    expectedRevisions: { transaction: 1, student: 3, day: 5 },
    payload,
    ...overrides,
  });

  it('accepts the five kinds with their exact payloads', () => {
    expect(normalizeEnabledCommandInput(studentInput('CorrectTransaction', { mealPrice: 110, paidAmount: 100, amount: -10, note: '', reason: '記錯' })).payload)
      .toEqual({ mealPrice: 110, paidAmount: 100, amount: -10, note: '', reason: '記錯' });
    for (const kind of ['VoidTransaction', 'CancelKeepDeposit', 'CancelRefund']) {
      expect(normalizeEnabledCommandInput(studentInput(kind, { reason: '請假' })).kind).toBe(kind);
    }
    expect(normalizeEnabledCommandInput(studentInput('Undo', { targetCommandId: commandId, reason: UNDO_REASON })).kind).toBe('Undo');
  });

  it('accepts a counter-cash mutation without a student revision', () => {
    const normalized = normalizeEnabledCommandInput(studentInput('VoidTransaction', { reason: '記錯' }, {
      targets: { transactionId, studentId: '__cashier__', dayId },
      expectedRevisions: { transaction: 1, day: 5 },
    }));
    expect(normalized.expectedRevisions).toEqual({ transaction: 1, day: 5 });
  });

  it.each([
    ['a missing reason', 'VoidTransaction', {}],
    ['an empty reason', 'VoidTransaction', { reason: '' }],
    ['a 501-char reason', 'CancelRefund', { reason: 'r'.repeat(501) }],
    ['an extra field', 'VoidTransaction', { reason: 'x', note: '' }],
    ['an undo with another reason', 'Undo', { targetCommandId: commandId, reason: '其他' }],
    ['an undo without a target', 'Undo', { reason: UNDO_REASON }],
    ['a correction without amount', 'CorrectTransaction', { mealPrice: 0, paidAmount: 10, note: '', reason: 'x' }],
    ['a correction over 1,000,000', 'CorrectTransaction', { mealPrice: 0, paidAmount: 1_000_001, amount: 1_000_001, note: '', reason: 'x' }],
    ['a 501-char correction note', 'CorrectTransaction', { mealPrice: 0, paidAmount: 10, amount: 10, note: 'n'.repeat(501), reason: 'x' }],
  ])('rejects %s', (_label, kind, payload) => {
    expect(() => normalizeEnabledCommandInput(studentInput(kind, payload))).toThrow();
  });

  it('rejects a revision 0 target, a student revision on counter cash and a missing student revision', () => {
    const payload = { reason: 'x' };
    expect(() => normalizeEnabledCommandInput(studentInput('VoidTransaction', payload, { expectedRevisions: { transaction: 0, student: 3, day: 5 } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(studentInput('VoidTransaction', payload, {
      targets: { transactionId, studentId: '__cashier__', dayId },
      expectedRevisions: { transaction: 1, student: 3, day: 5 },
    }))).toThrow();
    expect(() => normalizeEnabledCommandInput(studentInput('VoidTransaction', payload, { expectedRevisions: { transaction: 1, day: 5 } }))).toThrow();
  });
});
