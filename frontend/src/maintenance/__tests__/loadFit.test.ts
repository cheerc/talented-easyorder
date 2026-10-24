import { describe, expect, it } from 'vitest';
import { fitLoad, type FitInput, type FitState } from '../loadFit';

/**
 * P16d load fit, with hand-computed fixtures. The fixture load costs, at page size P,
 *   reads = 3 + a + 2·b + 4·a/P            (4 reads per page of `a`, `b` has no page overhead)
 *   authorization = 1 + 2·a                 (2 calls per document of `a`, none per page)
 * so the slope of `a` at page size 2 is 1 + 4/2 = 3, at page size 4 it is 1 + 4/4 = 2, which gives c = (3 − 2) / (1/2 − 1/4) = 4
 * reads per page and b = 3 − 4/2 = 1 read per document of `a`; at the production page size 10 a unit of `a` costs 1 + 4/10 = 1.4.
 */
const reads = (a: number, b: number, page: number) => 3 + a + 2 * b + (4 * a) / page;
const authorization = (a: number) => 1 + 2 * a;
const sample = (a: number, b: number, c = 0): FitState => ({
  dims: { a, b, c },
  small: { reads: reads(a, b, 2), authorization: authorization(a), authQueries: 2 },
  large: { reads: reads(a, b, 4), authorization: authorization(a), authQueries: 2 },
});

// phase a: a grows 2, 4, 6 with b = 2; phase b: b grows 2, 4, 6 with a = 6 (the first state of phase b is the last one of phase a)
const states: FitState[] = [sample(2, 2), sample(4, 2), sample(6, 2), sample(6, 4), sample(6, 6)];
const phases = [
  { dimension: 'a', stateIndexes: [0, 1, 2] },
  { dimension: 'b', stateIndexes: [2, 3, 4] },
];
const paged: FitInput = { name: 'fixture', states, phases, dimensions: ['a', 'b'], pages: { small: 2, large: 4, production: 10 } };

describe('P16d load fit: paged load', () => {
  it('tells the cost per document from the cost per page by measuring two page sizes, and prices a document at the production page size', () => {
    const fit = fitLoad(paged);
    expect(fit.units).toEqual(['a', 'b']);
    // a: 1 + 4/10 = 1.4 per document; b: 2 (no page overhead)
    expect(fit.reads.perUnit).toEqual({ a: 1.4, b: 2 });
    // F = 3 at every state; one extra page of `a` (4 reads) is added to the fixed part
    expect(fit.reads.fixed).toBe(3 + 4);
    // authorization has no page overhead: 2 per document of a, 0 for b; fixed 1
    expect(fit.readAuthorization.perUnit).toEqual({ a: 2 });
    expect(fit.readAuthorization.fixed).toBe(1);
  });

  it('never prices below what was measured: at every measured state the line is at or above the reads', () => {
    const fit = fitLoad(paged);
    for (const state of states) {
      const modelled = fit.reads.fixed + (fit.reads.perUnit.a ?? 0) * state.dims.a! + (fit.reads.perUnit.b ?? 0) * state.dims.b!;
      expect(modelled).toBeGreaterThanOrEqual(state.large!.reads);
    }
  });
});

describe('P16d load fit: a load without a page-size seam', () => {
  it('uses the reads as measured and adds one page of query authorization at the production page size', () => {
    const unpaged: FitState[] = [2, 4, 6].map(a => ({ dims: { a }, small: { reads: 2 + a, authorization: 4 + 0.5 * a, authQueries: 2 } }));
    const fit = fitLoad({ name: 'unpaged', states: unpaged, phases: [{ dimension: 'a', stateIndexes: [0, 1, 2] }], dimensions: ['a'], pages: { production: 100 } });
    expect(fit.reads).toEqual({ fixed: 2, perUnit: { a: 1 } });
    // fixed 4 + 2 (one more page of query authorization); per document 0.5 + 2/100
    expect(fit.readAuthorization).toEqual({ fixed: 6, perUnit: { a: 0.52 } });
  });
});

describe('P16d load fit: a load must depend on the dimensions it declares and on no other', () => {
  it('rejects a load that also grows with a dimension that was not declared (the fixture grows each dimension on its own)', () => {
    // `c` grows in its own phase and the load reads 3 more per unit of it: declaring only a and b would lose that cost
    const withC: FitState[] = [sample(6, 6, 0), sample(6, 6, 2), sample(6, 6, 4)].map((state, index) => ({
      ...state, small: { ...state.small, reads: state.small.reads + 3 * 2 * index }, large: { ...state.large!, reads: state.large!.reads + 3 * 2 * index },
    }));
    const all = [...states, ...withC.slice(1)];
    const phasesWithC = [...phases, { dimension: 'c', stateIndexes: [4, 5, 6] }];
    expect(() => fitLoad({ ...paged, states: all, phases: phasesWithC })).toThrow(/fixture: .*dimension c/);
    // declaring it fixes it
    expect(fitLoad({ ...paged, states: all, phases: phasesWithC, dimensions: ['a', 'b', 'c'] }).reads.perUnit.c).toBe(3);
  });

  it('rejects a series that grows faster than a line, because a line would underestimate it further out', () => {
    // 13 at 2 units, 8 at 4 units, 25 at 6 units: the middle state is 11 below the line through the ends (19), more than a page (6)
    const bent = [sample(2, 2), { ...sample(4, 2), small: { reads: 8, authorization: authorization(4), authQueries: 2 } }, sample(6, 2)];
    expect(() => fitLoad({ ...paged, states: bent, phases: [{ dimension: 'a', stateIndexes: [0, 1, 2] }], dimensions: ['a'] })).toThrow(/not a line/);
  });

  it('accepts a step that starts with the first unit (a new query), which a line only overestimates, and covers it with the intercept', () => {
    // authorization 5, 7, 7 at 2, 4, 6 units of `a`: +2 once, then flat; the line through the ends has slope 0.5 and says 6 at 4 units
    const step: FitState[] = [5, 7, 7].map((auth, index) => ({ dims: { a: 2 + 2 * index, b: 2 }, small: { reads: 10, authorization: auth, authQueries: 2 }, large: { reads: 10, authorization: auth, authQueries: 2 } }));
    const fit = fitLoad({ ...paged, states: step, phases: [{ dimension: 'a', stateIndexes: [0, 1, 2] }], dimensions: ['a'] });
    // at 4 units: fixed + 0.5 × 4 ≥ 7, and at the other states too
    for (const state of step) expect(fit.readAuthorization.fixed + (fit.readAuthorization.perUnit.a ?? 0) * state.dims.a!).toBeGreaterThanOrEqual(state.small.authorization);
  });

  it('accepts the step in which a new page starts, which a straight line cannot follow', () => {
    // at page size 4 the third state starts a second page: reads 3 + a + 2b + 4·ceil(a/4) → 11, 11, 17 for a = 2, 4, 6 (b = 2);
    // the line through the ends says 14 for a = 4, 3 reads away: within one page of `a` (slope 1.5 × page size 4 = 6)
    const ceilReads = (a: number, page: number) => 3 + a + 2 * 2 + 4 * Math.ceil(a / page);
    const stepped: FitState[] = [2, 4, 6].map(a => ({
      dims: { a, b: 2 },
      small: { reads: ceilReads(a, 2), authorization: authorization(a), authQueries: 2 },
      large: { reads: ceilReads(a, 4), authorization: authorization(a), authQueries: 2 },
    }));
    expect(() => fitLoad({ ...paged, states: stepped, phases: [{ dimension: 'a', stateIndexes: [0, 1, 2] }], dimensions: ['a'] })).not.toThrow();
  });

  it('rejects a phase in which the dimension did not grow', () => {
    expect(() => fitLoad({ ...paged, phases: [{ dimension: 'a', stateIndexes: [2, 2] }], dimensions: ['a'] })).toThrow(/did not grow/);
  });
});
