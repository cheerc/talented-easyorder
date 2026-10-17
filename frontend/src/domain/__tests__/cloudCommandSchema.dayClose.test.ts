import { describe, expect, it } from 'vitest';
import { normalizeEnabledCommandInput, settlementExpectedCash } from '../cloudCommandSchema';

const commandId = '11111111-1111-4111-8111-111111111111';

function closeDay(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'CloseDay',
    leaseEpoch: 1,
    targets: { dayId: '2026-10-17', settlementRevision: 1 },
    expectedRevisions: { day: 6, settlement: 0 },
    payload,
    ...overrides,
  };
}

function reopenDay(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'ReopenDay',
    leaseEpoch: 1,
    targets: { dayId: '2026-10-17', settlementRevision: 2 },
    expectedRevisions: { day: 7, settlement: 1 },
    payload,
    ...overrides,
  };
}

function backfillOpening(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'BackfillOpeningCash',
    leaseEpoch: 1,
    targets: { dayId: '2026-10-16' },
    expectedRevisions: { day: 3 },
    payload,
    ...overrides,
  };
}

describe('P11 CloseDay／ReopenDay command schema', () => {
  it('uses one expectedCash formula: opening + receipts + counter income − expense − account refunds (spec L05)', () => {
    expect(settlementExpectedCash({
      openingCash: 1000,
      totals: {
        activeTransactionCount: 4, bentoCount: 2, otherMealCount: 0, mealTotal: 180,
        retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 0,
      },
    })).toBe(1170);
  });

  it('requires a note only when counted differs from expected', () => {
    expect(normalizeEnabledCommandInput(closeDay({ countedCash: 1170, note: '', expectedCash: 1170 })).payload)
      .toEqual({ countedCash: 1170, note: '', expectedCash: 1170 });
    expect(() => normalizeEnabledCommandInput(closeDay({ countedCash: 1160, note: '', expectedCash: 1170 })))
      .toThrow('差額原因');
    expect(normalizeEnabledCommandInput(closeDay({ countedCash: 1160, note: '少 10 元', expectedCash: 1170 })).payload)
      .toMatchObject({ note: '少 10 元' });
  });

  it('accepts a negative expectedCash but refuses negative or fractional counted cash and long notes', () => {
    expect(normalizeEnabledCommandInput(closeDay({ countedCash: 0, note: '支出大於收入', expectedCash: -30 })).payload)
      .toMatchObject({ expectedCash: -30 });
    expect(() => normalizeEnabledCommandInput(closeDay({ countedCash: -1, note: 'x', expectedCash: 0 }))).toThrow();
    expect(() => normalizeEnabledCommandInput(closeDay({ countedCash: 1.5, note: 'x', expectedCash: 0 }))).toThrow();
    expect(() => normalizeEnabledCommandInput(closeDay({ countedCash: 0, note: 'x'.repeat(501), expectedCash: 0 }))).toThrow();
    expect(() => normalizeEnabledCommandInput(closeDay({ countedCash: 0, note: '', expectedCash: 0, extra: 1 }))).toThrow();
  });

  it('binds the new version to the current settlement pointer plus one', () => {
    expect(() => normalizeEnabledCommandInput(closeDay(
      { countedCash: 0, note: '', expectedCash: 0 }, { targets: { dayId: '2026-10-17', settlementRevision: 2 } },
    ))).toThrow();
    expect(() => normalizeEnabledCommandInput(closeDay(
      { countedCash: 0, note: '', expectedCash: 0 }, { expectedRevisions: { day: 0, settlement: 0 } },
    ))).toThrow();
    expect(() => normalizeEnabledCommandInput(closeDay(
      { countedCash: 0, note: '', expectedCash: 0 }, { targets: { dayId: '2026-02-30', settlementRevision: 1 } },
    ))).toThrow();
  });

  it('requires a 1–500 character reopen reason', () => {
    expect(normalizeEnabledCommandInput(reopenDay({ reason: '補登漏記' })).payload).toEqual({ reason: '補登漏記' });
    expect(() => normalizeEnabledCommandInput(reopenDay({ reason: '' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(reopenDay({ reason: 'x'.repeat(501) }))).toThrow();
    expect(() => normalizeEnabledCommandInput(reopenDay({ reason: 'ok', note: '' }))).toThrow();
  });

  it('BackfillOpeningCash needs an integer 0–20,000 opening cash, a 1–500 character reason and only a day target', () => {
    expect(normalizeEnabledCommandInput(backfillOpening({ openingCash: 800, reason: '當天網路中斷' })))
      .toMatchObject({
        kind: 'BackfillOpeningCash', targets: { dayId: '2026-10-16' }, expectedRevisions: { day: 3 },
        payload: { openingCash: 800, reason: '當天網路中斷' },
      });
    expect(normalizeEnabledCommandInput(backfillOpening({ openingCash: 0, reason: 'x'.repeat(500) })).payload)
      .toMatchObject({ openingCash: 0 });
    expect(normalizeEnabledCommandInput(backfillOpening({ openingCash: 20_000, reason: 'r' })).payload)
      .toMatchObject({ openingCash: 20_000 });
    for (const payload of [
      { openingCash: 800, reason: '' },
      { openingCash: 800, reason: 'x'.repeat(501) },
      { openingCash: 800 },
      { openingCash: -1, reason: 'r' },
      { openingCash: 20_001, reason: 'r' },
      { openingCash: 1.5, reason: 'r' },
      { openingCash: '800', reason: 'r' },
      { openingCash: 800, reason: 'r', note: '' },
    ]) {
      expect(() => normalizeEnabledCommandInput(backfillOpening(payload)), JSON.stringify(payload)).toThrow();
    }
    const ok = { openingCash: 800, reason: 'r' };
    expect(() => normalizeEnabledCommandInput(backfillOpening(ok, { targets: { dayId: '2026-02-30' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(backfillOpening(ok, { targets: { dayId: '2026-10-16', studentId: 's' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(backfillOpening(ok, { expectedRevisions: { day: 0 } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(backfillOpening(ok, { expectedRevisions: { day: 3, settlement: 0 } }))).toThrow();
  });
});
