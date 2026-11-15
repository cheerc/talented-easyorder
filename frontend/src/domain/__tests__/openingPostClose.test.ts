import { describe, expect, it } from 'vitest';
import { openingPostCloseOffer, sameOpeningContext } from '../openingPostClose';
import type { CloudOpeningContextLookup } from '../../firebase/cloudDayCloseRepository';

const context: CloudOpeningContextLookup = {
  previous: { dayId: '2026-10-01', countedCash: 1000, postCloseNet: -50, dayRevision: 3, settlementRevision: 2, countedEntryIds: ['a', 'b'] },
  gapDayCount: 0, unclosedDayIds: [], seq: 10,
};

describe('openingPostCloseOffer (#734)', () => {
  it('offers the appropriate direction and effective-cash difference', () => {
    expect(openingPostCloseOffer(context, 1000, null)).toEqual({ targetDayId: '2026-10-01', direction: 'income', amount: 50, previousEffectiveCash: 950 });
    expect(openingPostCloseOffer(context, 900, null)).toEqual({ targetDayId: '2026-10-01', direction: 'expense', amount: 50, previousEffectiveCash: 950 });
  });
  it('enforces the amount and eligibility boundaries', () => {
    expect(openingPostCloseOffer(context, 950, null)).toBeNull();
    expect(openingPostCloseOffer(context, 20950, null)?.amount).toBe(20000);
    expect(openingPostCloseOffer(context, 20951, null)).toBeNull();
    expect(openingPostCloseOffer({ ...context, gapDayCount: 1 }, 1000, null)).toBeNull();
    expect(openingPostCloseOffer({ ...context, unclosedDayIds: ['2026-10-02'] }, 1000, null)).toBeNull();
    expect(openingPostCloseOffer(context, 1000, 100)).toBeNull();
    expect(openingPostCloseOffer({ ...context, previous: null }, 1000, null)).toBeNull();
  });
});

describe('sameOpeningContext (#734)', () => {
  it('compares every material field including entry IDs even when the net is unchanged', () => {
    expect(sameOpeningContext(context, { ...context, seq: 11 })).toBe(true);
    const previous = context.previous!;
    for (const change of [
      { dayId: '2026-09-30' }, { countedCash: 999 }, { postCloseNet: 0 }, { dayRevision: 4 },
      { settlementRevision: 3 }, { countedEntryIds: ['a', 'b', 'c', 'd'] },
    ]) expect(sameOpeningContext(context, { ...context, previous: { ...previous, ...change } })).toBe(false);
    expect(sameOpeningContext(context, { ...context, previous: null })).toBe(false);
    expect(sameOpeningContext(context, { ...context, gapDayCount: 1 })).toBe(false);
    expect(sameOpeningContext(context, { ...context, unclosedDayIds: ['2026-10-02'] })).toBe(false);
    expect(sameOpeningContext({ ...context, previous: null }, { ...context, previous: null })).toBe(true);
  });
});
