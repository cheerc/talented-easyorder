import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn(),
  documentId: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  startAfter: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, ...firestoreMocks };
});

import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';

type Data = Record<string, unknown>;
type Constraint = { type: string; field?: unknown; op?: string; value?: unknown; direction?: string; count?: number };

const db = {} as Firestore;
const today = '2026-10-17';
const gap = '2026-10-14';
let currentUid = 'uid-a';
const userFor = (uid: string) => ({
  uid, email: 'operator@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }],
}) as unknown as User;

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const totals = (count = 0) => ({
  activeTransactionCount: count, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
  retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
});
const head = (change: Data = {}) => ({
  schemaVersion: 1, datasetId: 'dataset-a', seq: 10, lastCommandId: null, maintenance: false,
  goLiveDate: '2026-10-01', updatedAt: ts('2026-10-01T00:00:00.000Z'), ...change,
});
const dayDoc = (change: Data = {}) => ({
  status: 'open', revision: 3, menu: null, openingCash: 1000, openedBy: null, openedAt: null,
  totals: totals(2), lastSettlementRevision: 0, lastCommandId: 'c', updatedAt: ts('2026-10-01T00:00:00.000Z'), ...change,
});
const marker = (dayId: string) => ({
  dayId, reason: '那天斷線', startedBy: 'uid-a', startedAt: ts('2026-10-17T01:00:00.000Z'),
  commandId: '00000000-0000-4000-8000-0000000000c1',
});

const settlementDoc = (dayId: string, revision: number, change: Data = {}) => ({
  dayId, revision, status: 'closed', totals: totals(), openingCash: 100, expectedCash: 100,
  countedCash: 100, difference: 0, note: '', actorUid: 'uid-a', actorEmail: 'operator@example.test', sourceSeq: 5,
  committedAt: ts('2026-10-02T10:00:00.000Z'), previousRevision: revision - 1, lastCommandId: 'c', ...change,
});

interface Setup {
  days?: Array<[string, Data]>;
  settlements?: Record<string, Data>;
  backfill?: Array<[string, Data]>;
  /** The data head returned by the n-th head read (0-based); the last entry repeats. */
  heads?: (index: number) => Data;
  failDayQueries?: (request: { collectionRef: { path: string }; constraints: Constraint[] }) => unknown;
}

function setup({ days = [], settlements = {}, backfill = [], heads = () => head(), failDayQueries }: Setup = {}) {
  const metadata = { fromCache: false, hasPendingWrites: false };
  let headReads = 0;
  firestoreMocks.documentId.mockReturnValue('__name__');
  firestoreMocks.doc.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.collection.mockImplementation((_db: unknown, path: string, ...rest: string[]) => ({ path: [path, ...rest].join('/') }));
  firestoreMocks.where.mockImplementation((field: unknown, op: string, value: unknown) => ({ type: 'where', field, op, value }));
  firestoreMocks.orderBy.mockImplementation((field: unknown, direction?: string) => ({ type: 'orderBy', field, direction }));
  firestoreMocks.startAfter.mockImplementation((snapshot: unknown) => ({ type: 'startAfter', snapshot }));
  firestoreMocks.limit.mockImplementation((count: number) => ({ type: 'limit', count }));
  firestoreMocks.query.mockImplementation((collectionRef: { path: string }, ...constraints: Constraint[]) => ({ collectionRef, constraints }));
  firestoreMocks.getDocFromServer.mockImplementation(async (ref: { path: string }) => {
    let value: Data | undefined;
    if (ref.path === 'system/dataHead') value = heads(headReads++);
    else if (ref.path === 'system/accessLease') value = { holderUid: currentUid, epoch: 1, updatedAt: ts('2026-10-17T02:00:00.000Z') };
    else if (ref.path.includes('/settlements/')) value = settlements[ref.path];
    else if (ref.path.startsWith('days/')) value = days.find(([id]) => `days/${id}` === ref.path)?.[1];
    else if (ref.path.startsWith('backfillDays/')) value = backfill.find(([id]) => `backfillDays/${id}` === ref.path)?.[1];
    return { id: ref.path.split('/').at(-1), exists: () => value !== undefined, data: () => value, metadata };
  });
  firestoreMocks.getDocsFromServer.mockImplementation(async (request: { collectionRef: { path: string }; constraints: Constraint[] }) => {
    const failure = failDayQueries?.(request);
    if (failure) throw failure;
    const path = request.collectionRef.path;
    let selected: Array<[string, Data]> = path === 'backfillDays' ? [...backfill] : path === 'days' ? [...days] : [];
    selected.sort(([left], [right]) => left.localeCompare(right));
    for (const item of request.constraints) {
      if (item.type !== 'where') continue;
      if (item.op === 'in' && item.field === '__name__') {
        selected = selected.filter(([id]) => (item.value as string[]).includes(id));
      } else if (item.op === 'in') {
        selected = selected.filter(([, data]) => (item.value as unknown[]).includes(data[String(item.field)]));
      } else if (item.field === '__name__') {
        const value = String(item.value);
        selected = selected.filter(([id]) => (item.op === '>=' ? id >= value : item.op === '<=' ? id <= value : item.op === '<' ? id < value : item.op === '>' ? id > value : false));
      }
    }
    const bound = request.constraints.find(item => item.type === 'limit')?.count ?? Infinity;
    const docs = selected.slice(0, bound).map(([id, value]) => ({ id, data: () => value, metadata }));
    return { size: docs.length, docs, metadata };
  });
  return { headReads: () => headReads };
}

const subject = () => createCloudDayCloseRepository(db, { currentUser: () => userFor(currentUid) });

describe('CloudDayCloseRepository.loadSnapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    currentUid = 'uid-a';
  });

  it('returns the dataset identity with the composed overview, selected day and lookups under one head fence', async () => {
    setup({ days: [[today, dayDoc()]] });
    const snapshot = await subject().loadSnapshot();
    expect(snapshot.datasetId).toBe('dataset-a');
    expect(snapshot.dayId).toBe(today);
    expect(snapshot.overview.selectionDate).toBe(today);
    expect(snapshot.overview.seq).toBe(10);
    expect(snapshot.day).toMatchObject({ dayId: today, seq: 10, openingCash: 1000 });
    expect(snapshot.backfill).toBeNull();
    expect(snapshot.previous).toBeNull();
    expect(snapshot.align).toBeNull();
  });

  it('reports a missing selected day as null and looks up the previous closed day for a backfillable gap', async () => {
    setup({
      days: [['2026-10-12', dayDoc({ status: 'closed', lastSettlementRevision: 1 })]],
      settlements: { 'days/2026-10-12/settlements/1': settlementDoc('2026-10-12', 1, { countedCash: 870 }) },
    });
    const snapshot = await subject().loadSnapshot(gap);
    expect(snapshot.dayId).toBe(gap);
    expect(snapshot.day).toBeNull();
    expect(snapshot.previous).toEqual({ status: 'ready', previous: { dayId: '2026-10-12', countedCash: 870, postCloseNet: 0 } });
    expect(snapshot.align).toBeNull();
  });

  it('finds the nearest opened day for a backfilling open day that has its opening cash', async () => {
    setup({
      days: [[gap, dayDoc({ openingCash: 870 })], ['2026-10-16', dayDoc({ openingCash: 950 })]],
      backfill: [[gap, marker(gap)]],
    });
    const snapshot = await subject().loadSnapshot(gap);
    expect(snapshot.backfill).toMatchObject({ dayId: gap, reason: '那天斷線' });
    expect(snapshot.align).toEqual({ status: 'ready', next: { dayId: '2026-10-16', openingCash: 950 } });
    expect(snapshot.previous).toBeNull();
  });

  it('rejects a legitimate concurrent change by seq at any point of the composition', async () => {
    const stable = setup({ days: [[today, dayDoc()]] });
    await subject().loadSnapshot();
    const reads = stable.headReads();
    expect(reads).toBeGreaterThan(4);
    for (const changedAt of [1, Math.floor(reads / 2), reads - 1]) {
      setup({ days: [[today, dayDoc()]], heads: index => head({ seq: index >= changedAt ? 11 : 10 }) });
      await expect(subject().loadSnapshot()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    }
  });

  it('rejects a dataset replacement even when the seq stays the same', async () => {
    const stable = setup({ days: [[today, dayDoc()]] });
    await subject().loadSnapshot();
    const reads = stable.headReads();
    setup({ days: [[today, dayDoc()]], heads: index => head({ datasetId: index >= reads - 1 ? 'dataset-b' : 'dataset-a' }) });
    await expect(subject().loadSnapshot()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('keeps an optional lookup failure bounded to its own state and rejects an authority failure', async () => {
    const lookupFailure = (code: string) => (request: { collectionRef: { path: string }; constraints: Constraint[] }) => (
      request.collectionRef.path === 'days' && request.constraints.some(item => item.type === 'where' && item.field === '__name__' && item.op === '<')
        ? Object.assign(new Error(code), { code })
        : null
    );
    setup({ days: [[gap, dayDoc({ openingCash: null, totals: totals(0) })]], failDayQueries: lookupFailure('unavailable') });
    const snapshot = await subject().loadSnapshot(gap);
    expect(snapshot.day).toMatchObject({ dayId: gap });
    expect(snapshot.previous).toMatchObject({ status: 'error' });
    expect(snapshot.overview.selectionDate).toBe(today);

    setup({ days: [[gap, dayDoc({ openingCash: null, totals: totals(0) })]], failDayQueries: lookupFailure('permission-denied') });
    await expect(subject().loadSnapshot(gap)).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  it('rejects the whole snapshot instead of a lookup error state when the lookup itself saw the head move', async () => {
    const stable = setup({ days: [[gap, dayDoc({ openingCash: null, totals: totals(0) })]] });
    await subject().loadSnapshot(gap);
    const reads = stable.headReads();
    setup({
      days: [[gap, dayDoc({ openingCash: null, totals: totals(0) })]],
      heads: index => head({ seq: index >= reads - 3 ? 12 : 10 }),
    });
    await expect(subject().loadSnapshot(gap)).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('rejects when the signed-in user changes while the composition awaits', async () => {
    setup({ days: [[today, dayDoc()]] });
    firestoreMocks.getDocsFromServer.mockImplementationOnce(async () => {
      currentUid = 'uid-b';
      return { size: 0, docs: [], metadata: { fromCache: false, hasPendingWrites: false } };
    });
    await expect(subject().loadSnapshot()).rejects.toMatchObject({ code: expect.stringMatching(/LEASE_LOST|UNAUTHORIZED/) });
  });

  it('refuses a day outside the business-date format without reading', async () => {
    setup({ days: [] });
    await expect(subject().loadSnapshot('2026-13-45')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
