import type { Linear } from './capacityModel';

/**
 * P16d load fit: turns the measurements of a load that grows with history into a cost per unit of each growing dimension.
 *
 * The fixture grows one dimension at a time (students, vendors, orders of the day, ... each in its own phase, all the others
 * held constant), and every load is measured at the start of the first phase and after every step. So the cost of a load can be
 * attributed to the collection that causes it: a load's reads are `fixed + Σ perUnit[dimension] × units of the dimension`.
 *
 * A cost has a part per document (`b`) and a part per page (`c`: the head and lease fence reads and the Rules authorization of
 * every page request, which depend on the page size, not on the documents). A paged load is measured at two page sizes, so
 * the slope of a dimension at page size P is `b + c / P` and the two can be told apart; the production slope is
 * `b + c / production page size`. Each series (one dimension in its own phase) is checked not to grow faster than a line, the intercept is
 * the largest one over every measured state (so the model is never below a measurement), and one extra page of every
 * paged dimension is added to the fixed part. A load that also grows with a dimension it does not declare is rejected: the
 * loss would otherwise go unnoticed.
 */

export interface FitSample {
  /** Billed client reads of one run of the load. */
  reads: number;
  /** Rules read authorization calls of the same run (documents and queries). */
  authorization: number;
  /** The part of `authorization` that comes from queries (one page request each). */
  authQueries: number;
}

export interface FitState {
  /** The unit count of every dimension at the time of the run. */
  dims: Record<string, number>;
  /** The run at the small page size (the only run for a load without a page-size seam). */
  small: FitSample;
  /** The run at the large page size (absent for a load without a page-size seam). */
  large?: FitSample;
}

export interface FitPhase {
  /** The dimension that grew in this phase; every other dimension stayed constant. */
  dimension: string;
  /** Indexes into `states`, in order, of the states that give the slope: the state after each step of the phase. */
  stateIndexes: number[];
}

export interface FitInput {
  name: string;
  states: FitState[];
  phases: FitPhase[];
  /** The dimensions the load depends on; the others must not change its cost. */
  dimensions: string[];
  /** `small` and `large` are the two measured page sizes (both, or neither for a load without a seam). */
  pages: { small?: number; large?: number; production: number };
}

export interface FitResult {
  units: string[];
  reads: Linear;
  readAuthorization: Linear;
  /** What the figures are made of, for the reader of the table. */
  detail: Record<string, unknown>;
}

type Pick = (sample: FitSample) => number;

const round = (value: number) => Math.round(value * 1e6) / 1e6;
/**
 * What a run may differ by for reasons that are not a dimension of the fixture: a scan that follows a settlement command also
 * reads that settlement (at most two documents, so 2 reads and 4 authorization calls).
 */
const RUN_NOISE = 4;

/**
 * How far below its line a point may be: the run noise, 2 % of the cost, and for a paged load one page more, because the cost
 * per page arrives in steps (a new page starts when a dimension passes a multiple of the page size) while the line is straight.
 */
const slackOf = (last: number, slope: number, pageSize: number | undefined) => Math.max(RUN_NOISE, 0.02 * Math.abs(last), pageSize === undefined ? 0 : Math.abs(slope) * pageSize);

interface Slope {
  small: number;
  large: number | null;
}

function slopeOf(input: FitInput, phase: FitPhase, pick: Pick, size: 'small' | 'large'): number | null {
  const at = (index: number) => {
    const state = input.states[index]!;
    const sample = size === 'small' ? state.small : state.large;
    return sample ? { x: state.dims[phase.dimension] ?? 0, y: pick(sample) } : null;
  };
  const points = phase.stateIndexes.map(at);
  if (points.some(point => point === null)) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (!(last.x > first.x)) throw new Error(`${input.name}: dimension ${phase.dimension} did not grow in its phase`);
  const slope = (last.y - first.y) / (last.x - first.x);
  const slack = slackOf(last.y, slope, input.pages[size]);
  for (const point of points) {
    const line = first.y + slope * (point!.x - first.x);
    // A point below the line means a cost that grows faster than a line (it would be underestimated further out); a point above
    // it is a step (a new query or page that starts with the first unit), which a line through the ends only overestimates,
    // and the intercept below is raised to cover every measured state.
    if (line - point!.y > slack) {
      throw new Error(`${input.name}: dimension ${phase.dimension} is not a line (${size} page size: ${point!.y} at ${point!.x} units, the line says ${round(line)}: the cost grows faster than a line)`);
    }
  }
  return slope;
}

/** The change of a series over its phase, for a dimension the load does not declare. */
function changeOf(input: FitInput, phase: FitPhase, pick: Pick, size: 'small' | 'large'): number {
  const first = input.states[phase.stateIndexes[0]!]!;
  const last = input.states[phase.stateIndexes[phase.stateIndexes.length - 1]!]!;
  const a = size === 'small' ? first.small : first.large;
  const b = size === 'small' ? last.small : last.large;
  return a && b ? pick(b) - pick(a) : 0;
}

function fitSeries(input: FitInput, pick: Pick): { fixed: number; perUnit: Record<string, number>; perPage: Record<string, number>; slopes: Record<string, Slope> } {
  const { pages } = input;
  const paged = pages.small !== undefined && pages.large !== undefined;
  const slopes: Record<string, Slope> = {};
  const offenders: string[] = [];
  for (const phase of input.phases) {
    if (!input.dimensions.includes(phase.dimension)) {
      for (const size of paged ? (['small', 'large'] as const) : (['small'] as const)) {
        const change = changeOf(input, phase, pick, size);
        if (Math.abs(change) > RUN_NOISE) offenders.push(`dimension ${phase.dimension} (${size}: ${round(change)} over its phase)`);
      }
      continue;
    }
    const small = slopeOf(input, phase, pick, 'small');
    const large = paged ? slopeOf(input, phase, pick, 'large') : null;
    slopes[phase.dimension] = { small: small ?? 0, large };
  }
  if (offenders.length > 0) {
    throw new Error(`${input.name}: the load grows with ${offenders.join(', ')}, which it does not declare; declare it or fix the fixture`);
  }
  const perUnit: Record<string, number> = {};
  const perPage: Record<string, number> = {};
  const split: Record<string, { b: number; c: number }> = {};
  for (const [dimension, slope] of Object.entries(slopes)) {
    if (paged && slope.large !== null) {
      const small = pages.small!;
      const large = pages.large!;
      // s_P = b + c / P at the two measured page sizes
      const c = Math.max(0, (slope.small - slope.large) / (1 / small - 1 / large));
      const b = Math.max(0, c > 0 ? slope.small - c / small : Math.max(slope.small, slope.large));
      split[dimension] = { b, c };
    } else {
      split[dimension] = { b: slope.small, c: 0 };
    }
    perPage[dimension] = split[dimension]!.c;
    perUnit[dimension] = split[dimension]!.b + split[dimension]!.c / pages.production;
  }
  // the intercept at each measured page size: no state is above the line
  const interceptAt = (size: 'small' | 'large') => Math.max(...input.states.flatMap(state => {
    const sample = size === 'small' ? state.small : state.large;
    if (!sample) return [];
    const growth = Object.entries(slopes).reduce((sum, [dimension, slope]) => sum + (size === 'small' ? slope.small : (slope.large ?? slope.small)) * (state.dims[dimension] ?? 0), 0);
    return [pick(sample) - growth];
  }));
  const fixed = Math.max(interceptAt('small'), paged ? interceptAt('large') : -Infinity) + Object.values(perPage).reduce((sum, c) => sum + c, 0);
  return { fixed, perUnit, perPage, slopes };
}

const compact = (record: Record<string, number>): Record<string, number> => Object.fromEntries(
  Object.entries(record).map(([key, value]) => [key, round(value)] as const).filter(([, value]) => value !== 0),
);

export function fitLoad(input: FitInput): FitResult {
  const reads = fitSeries(input, sample => sample.reads);
  const authorization = fitSeries(input, sample => sample.authorization);
  const paged = input.pages.small !== undefined && input.pages.large !== undefined;
  let authFixed = authorization.fixed;
  const authPerUnit = { ...authorization.perUnit };
  if (!paged) {
    // no page-size seam: one more page of query authorization, spread over the production page size
    const onePage = input.states[input.states.length - 1]!.small.authQueries;
    authFixed += onePage;
    for (const dimension of Object.keys(authPerUnit)) {
      if ((reads.perUnit[dimension] ?? 0) !== 0 || (authPerUnit[dimension] ?? 0) !== 0) authPerUnit[dimension] = (authPerUnit[dimension] ?? 0) + onePage / input.pages.production;
    }
  }
  return {
    units: [...input.dimensions],
    reads: { fixed: round(reads.fixed), perUnit: compact(reads.perUnit) },
    readAuthorization: { fixed: round(authFixed), perUnit: compact(authPerUnit) },
    detail: {
      pageSizes: paged ? [input.pages.small, input.pages.large] : null, productionPageSize: input.pages.production,
      readsPerDocument: compact(Object.fromEntries(Object.entries(reads.perUnit).map(([dimension, perUnit]) => [dimension, perUnit - (reads.perPage[dimension] ?? 0) / input.pages.production]))),
      readsPerPage: compact(reads.perPage),
    },
  };
}
