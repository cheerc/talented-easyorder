import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  cashMovementEffect,
  decodeEnabledCommandDoc,
  fingerprintCommandInput,
  normalizeEnabledCommandInput,
} from '../cloudCommandSchema';
import { expectedCashFromTotals } from '../cloudLedgerProjection';

const commandId = '33333333-3333-4333-8333-333333333333';
const transactionId = '44444444-4444-4444-8444-444444444444';
const dayId = '2026-10-16';

function input(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'CreateCashMovement',
    leaseEpoch: 1,
    targets: { transactionId, dayId },
    expectedRevisions: { transaction: 0, day: 4 },
    payload,
    ...overrides,
  };
}

describe('P09a CreateCashMovement schema', () => {
  it('normalizes income and expense with exactly one positive side and a required reason', () => {
    expect(normalizeEnabledCommandInput(input({ mealPrice: 0, paidAmount: 50, reason: '零錢補充' }))).toEqual(
      input({ mealPrice: 0, paidAmount: 50, reason: '零錢補充' }),
    );
    expect(normalizeEnabledCommandInput(input({ mealPrice: 80, paidAmount: 0, reason: '付餐費給廠商' })).payload)
      .toEqual({ mealPrice: 80, paidAmount: 0, reason: '付餐費給廠商' });
  });

  it.each([
    ['both sides positive', { mealPrice: 10, paidAmount: 10, reason: 'x' }],
    ['zero amount', { mealPrice: 0, paidAmount: 0, reason: 'x' }],
    ['negative amount', { mealPrice: -5, paidAmount: 0, reason: 'x' }],
    ['over 1,000,000', { mealPrice: 0, paidAmount: 1_000_001, reason: 'x' }],
    ['missing reason', { mealPrice: 0, paidAmount: 10 }],
    ['empty reason', { mealPrice: 0, paidAmount: 10, reason: '' }],
    ['501-char reason', { mealPrice: 0, paidAmount: 10, reason: 'r'.repeat(501) }],
    ['an extra note field', { mealPrice: 0, paidAmount: 10, reason: 'x', note: '' }],
  ])('rejects %s', (_label, payload) => {
    expect(() => normalizeEnabledCommandInput(input(payload))).toThrow();
  });

  it('rejects a student target, a nonzero transaction revision and a missing day revision', () => {
    const payload = { mealPrice: 0, paidAmount: 10, reason: 'x' };
    expect(() => normalizeEnabledCommandInput(input(payload, {
      targets: { transactionId, dayId, studentId: '55555555-5555-4555-8555-555555555555' },
    }))).toThrow();
    expect(() => normalizeEnabledCommandInput(input(payload, { expectedRevisions: { transaction: 1, day: 4 } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(input(payload, { expectedRevisions: { transaction: 0 } }))).toThrow();
  });

  it('derives the spec §7.1 cash effect: income is a collection, expense a payout', () => {
    expect(cashMovementEffect({ mealPrice: 0, paidAmount: 50 }))
      .toEqual({ before: 0, after: 50, delta: 50, reasonKind: 'collection', refundAmount: 0 });
    expect(cashMovementEffect({ mealPrice: 80, paidAmount: 0 }))
      .toEqual({ before: 0, after: -80, delta: -80, reasonKind: 'payout', refundAmount: 0 });
  });

  it('decodes a consistent receipt and rejects one whose reason or cashier sentinel was altered', async () => {
    const committedAt = Timestamp.fromDate(new Date('2026-10-16T04:00:00.000Z'));
    const earlier = Timestamp.fromDate(new Date('2026-10-16T01:00:00.000Z'));
    const payload = { mealPrice: 80, paidAmount: 0, reason: '付餐費給廠商' };
    const fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input(payload)));
    const head = (seq: number, last: string | null, at: Timestamp) => ({
      schemaVersion: 1, datasetId: 'synthetic', seq, lastCommandId: last, maintenance: false,
      goLiveDate: '2026-10-01', updatedAt: at,
    });
    const totals = (count: number, expense: number) => ({
      activeTransactionCount: count, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: expense, accountRefunds: 0,
    });
    const day = (revision: number, last: string, at: Timestamp, count: number, expense: number) => ({
      status: 'open', revision, menu: null, openingCash: 1000, openedBy: 'synthetic-uid', openedAt: earlier,
      totals: totals(count, expense), lastSettlementRevision: 0, lastCommandId: last, updatedAt: at,
    });
    const priorId = '66666666-6666-4666-8666-666666666666';
    const raw = {
      commandId, kind: 'CreateCashMovement', seq: 5, leaseEpoch: 1,
      actor: { uid: 'synthetic-uid', email: 'synthetic@example.test' }, committedAt,
      businessDate: dayId, studentId: '__cashier__',
      targets: { transactionId, dayId }, expectedRevisions: { transaction: 0, day: 4 },
      before: { head: head(4, priorId, earlier), day: day(4, priorId, earlier, 0, 0), transaction: null },
      after: {
        head: head(5, commandId, committedAt),
        day: day(5, commandId, committedAt, 1, 80),
        transaction: {
          transactionId, studentId: '__cashier__', businessDate: dayId, type: 'expense', mealKind: null,
          mealPrice: 80, paidAmount: 0, amount: -80, studentNameSnapshot: '櫃台', menuNameSnapshot: '',
          menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '', otherItemName: null,
          status: 'active', revision: 1, createdAt: committedAt, createdSeq: 5,
          operatorUid: 'synthetic-uid', operatorEmail: 'synthetic@example.test', sourceDevice: 'pc',
          note: '付餐費給廠商', lastCommandId: commandId, updatedAt: committedAt,
        },
      },
      reason: '付餐費給廠商',
      cashEffect: { before: 0, after: -80, delta: -80, reasonKind: 'payout', refundAmount: 0 },
      payload, inputFingerprint: fingerprint,
    };
    expect(decodeEnabledCommandDoc(raw).kind).toBe('CreateCashMovement');
    expect(() => decodeEnabledCommandDoc({ ...raw, reason: 'changed' })).toThrow();
    expect(() => decodeEnabledCommandDoc({ ...raw, studentId: '55555555-5555-4555-8555-555555555555' })).toThrow();
    expect(() => decodeEnabledCommandDoc({
      ...raw, cashEffect: { before: 0, after: -80, delta: -80, reasonKind: 'collection', refundAmount: 0 },
    })).toThrow();
  });
});

describe('spec §7.1 expected cash', () => {
  it('L05: opening 1000, receipts 200, counter income 50 and expense 80 give expected cash 1170', () => {
    expect(expectedCashFromTotals(1000, { retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 0 }))
      .toEqual({ totalIncome: 250, totalExpense: 80, totalRefund: 0, netCash: 170, expectedCash: 1170 });
  });

  it('has no expected cash until the opening cash is confirmed', () => {
    expect(expectedCashFromTotals(null, { retainedReceipts: 200, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 }).expectedCash).toBeNull();
  });
});
