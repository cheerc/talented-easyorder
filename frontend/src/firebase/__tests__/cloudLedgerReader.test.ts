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

import { createCloudLedgerReader } from '../cloudDayCloseRepository';

const uid = 'synthetic-operator';
let db: Firestore;
const user = {
  uid, email: 'operator@example.test', emailVerified: true, providerData: [{ providerId: 'google.com' }],
} as unknown as User;

type Data = Record<string, unknown>;
type Constraint = { type: string; field?: unknown; op?: string; value?: unknown; direction?: string; count?: number };

const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const totals = (count = 0) => ({
  activeTransactionCount: count, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
  retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
});

function head(change: Data = {}) {
  return {
    schemaVersion: 1, datasetId: 'ledger-dataset', seq: 10, lastCommandId: null, maintenance: false,
    goLiveDate: '2026-10-01', updatedAt: ts('2026-10-01T00:00:00.000Z'), ...change,
  };
}

function dayDoc(change: Data = {}) {
  return {
    status: 'open', revision: 3, menu: null, openingCash: null, openedBy: null, openedAt: null,
    totals: totals(), lastSettlementRevision: 0, lastCommandId: 'c', updatedAt: ts('2026-10-01T00:00:00.000Z'), ...change,
  };
}

function settlementDoc(dayId: string, revision: number, change: Data = {}) {
  return {
    dayId, revision, status: 'closed', totals: totals(), openingCash: 100, expectedCash: 100,
    countedCash: 100, difference: 0, note: '', actorUid: uid, actorEmail: 'operator@example.test', sourceSeq: 5,
    committedAt: ts('2026-10-02T10:00:00.000Z'), previousRevision: revision - 1, lastCommandId: 'c', ...change,
  };
}

interface Setup {
  days?: Array<[string, Data]>;
  /** `postCloseEntries/{entryId}` documents (contract §15). */
  entries?: Array<[string, Data]>;
  settlements?: Record<string, Data | undefined>;
  heads?: Data[];
  leaseUpdatedAt?: Timestamp;
  fromCache?: boolean;
  hasPendingWrites?: boolean;
}

type FakeSnapshot = {
  id: string;
  data: () => Data;
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
};

function setup({
  days = [], entries = [], settlements = {}, heads = [head()], leaseUpdatedAt = ts('2026-10-05T02:00:00.000Z'),
  fromCache = false, hasPendingWrites = false,
}: Setup = {}) {
  const metadata = { fromCache, hasPendingWrites };
  let headReads = 0;
  firestoreMocks.documentId.mockReturnValue('__name__');
  firestoreMocks.doc.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.collection.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.where.mockImplementation((field: unknown, op: string, value: unknown) => ({ type: 'where', field, op, value }));
  firestoreMocks.orderBy.mockImplementation((field: unknown, direction?: string) => ({ type: 'orderBy', field, direction }));
  firestoreMocks.startAfter.mockImplementation((snapshot: FakeSnapshot) => ({ type: 'startAfter', snapshot }));
  firestoreMocks.limit.mockImplementation((count: number) => ({ type: 'limit', count }));
  firestoreMocks.query.mockImplementation((collectionRef: { path: string }, ...constraints: Constraint[]) => ({ collectionRef, constraints }));
  firestoreMocks.getDocFromServer.mockImplementation(async (ref: { path: string }) => {
    let value: Data | undefined;
    if (ref.path === 'system/dataHead') value = heads[Math.min(headReads++, heads.length - 1)];
    else if (ref.path === 'system/accessLease') value = { holderUid: uid, epoch: 1, updatedAt: leaseUpdatedAt };
    else value = settlements[ref.path];
    return { id: ref.path.split('/').at(-1), exists: () => value !== undefined, data: () => value, metadata };
  });
  // A small query evaluator: where on the document ID, ascending order, startAfter and limit.
  firestoreMocks.getDocsFromServer.mockImplementation(async (request: { collectionRef: { path: string }; constraints: Constraint[] }) => {
    let selected = [...(request.collectionRef.path === 'postCloseEntries' ? entries : days)].sort(([left], [right]) => left.localeCompare(right));
    for (const item of request.constraints) {
      if (item.type === 'where' && item.op === '==') {
        selected = selected.filter(([, data]) => data[String(item.field)] === item.value);
      } else if (item.type === 'where') {
        const value = String(item.value);
        selected = selected.filter(([id]) => (item.op === '>=' ? id >= value : item.op === '<=' ? id <= value : item.op === '<' ? id < value : item.op === '>' ? id > value : false));
      }
    }
    const after = request.constraints.find(item => item.type === 'startAfter') as unknown as { snapshot: FakeSnapshot } | undefined;
    if (after) selected = selected.filter(([id]) => id > after.snapshot.id);
    const bound = request.constraints.find(item => item.type === 'limit')?.count ?? Infinity;
    const docs: FakeSnapshot[] = selected.slice(0, bound).map(([id, value]) => ({ id, data: () => value, metadata }));
    return { size: docs.length, docs, metadata };
  });
}

const reader = (tuning?: { pageSize?: number; segmentDays?: number }) => createCloudLedgerReader(db, { currentUser: () => user }, tuning);
const settlementReads = () => firestoreMocks.getDocFromServer.mock.calls.filter(([ref]) => String(ref.path).includes('/settlements/'));
const headReads = () => firestoreMocks.getDocFromServer.mock.calls.filter(([ref]) => ref.path === 'system/dataHead');
const dayQueries = () => firestoreMocks.query.mock.calls
  .filter(call => (call[0] as { path: string }).path === 'days').map(call => (call.slice(1) as Constraint[]));
const entryQueries = () => firestoreMocks.query.mock.calls
  .filter(call => (call[0] as { path: string }).path === 'postCloseEntries').map(call => (call.slice(1) as Constraint[]));
const dateAt = (index: number, start = Date.UTC(2026, 0, 1)) => new Date(start + index * 86_400_000).toISOString().slice(0, 10);

describe('createCloudLedgerReader.read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = {} as Firestore;
  });

  it('reads goLiveDate..lease date in ascending document-ID order with no extra index, and reports anomalies', async () => {
    setup({
      days: [
        ['2026-10-01', dayDoc({ status: 'closed', openingCash: 100, lastSettlementRevision: 2, totals: totals(2) })],
        ['2026-10-03', dayDoc({ openingCash: 150, totals: totals(1) })],
      ],
      settlements: { 'days/2026-10-01/settlements/2': settlementDoc('2026-10-01', 2, { countedCash: 120 }) },
    });
    const snapshot = await reader().read();
    expect(snapshot).toMatchObject({ today: '2026-10-05', goLiveDate: '2026-10-01', seq: 10 });
    expect(snapshot.closedDays).toEqual([{ dayId: '2026-10-01', countedCash: 120, postCloseNet: 0 }]);
    expect(snapshot.anomalies.map(item => [item.kind, item.dayId])).toEqual([
      ['unclosed-past-day', '2026-10-03'], ['opening-mismatch', '2026-10-03'],
    ]);
    expect(dayQueries()).toEqual([[
      { type: 'where', field: '__name__', op: '>=', value: '2026-10-01' },
      { type: 'where', field: '__name__', op: '<=', value: '2026-10-05' },
      { type: 'orderBy', field: '__name__', direction: undefined },
      { type: 'limit', count: 200 },
    ]]);
    // Only the latest settlement version of a closed day is read.
    expect(settlementReads().map(([ref]) => ref.path)).toEqual(['days/2026-10-01/settlements/2']);
  });

  it('fails closed when a day snapshot reports cached data', async () => {
    setup({ days: [['2026-10-01', dayDoc()]], fromCache: true });
    await expect(reader().read()).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
  });

  it('keeps immutable settlement versions in memory per Firestore instance', async () => {
    setup({
      days: [['2026-10-01', dayDoc({ status: 'closed', openingCash: 100, lastSettlementRevision: 1 })]],
      settlements: { 'days/2026-10-01/settlements/1': settlementDoc('2026-10-01', 1) },
    });
    await reader().read();
    await reader().read();
    expect(settlementReads()).toHaveLength(1);
    db = {} as Firestore;
    await reader().read();
    expect(settlementReads()).toHaveLength(2);
  });

  it('reads every page with startAfter instead of truncating, and compares the head after each page', async () => {
    const days: Array<[string, Data]> = Array.from({ length: 450 }, (_, index) => [dateAt(index), dayDoc()]);
    setup({ days, heads: [head({ goLiveDate: '2026-01-01' })], leaseUpdatedAt: ts('2027-06-01T02:00:00.000Z') });
    const snapshot = await reader().read();
    // 450 open days before today: every one is an unclosed past day with a missing opening and no
    // transactions, so none is reported; the scan still has to see all of them without a cap.
    expect(snapshot.anomalies).toEqual([]);
    const queries = dayQueries();
    expect(queries).toHaveLength(3);
    expect(queries.map(constraints => constraints.some(item => item.type === 'startAfter'))).toEqual([false, true, true]);
    expect(queries.map(constraints => constraints.find(item => item.type === 'limit')?.count)).toEqual([200, 200, 200]);
    // One head read before the scan, one after the (empty) post-close entries page and one after every day page.
    expect(headReads()).toHaveLength(1 + 1 + 3);
  });

  it('reports an anomaly found beyond the 400th business day', async () => {
    const days: Array<[string, Data]> = Array.from({ length: 450 }, (_, index) => [dateAt(index), dayDoc()]);
    days[430] = [dateAt(430), dayDoc({ openingCash: 80, totals: totals(2) })];
    setup({ days, heads: [head({ goLiveDate: '2026-01-01' })], leaseUpdatedAt: ts('2027-06-01T02:00:00.000Z') });
    const snapshot = await reader().read();
    expect(snapshot.anomalies.map(item => [item.kind, item.dayId])).toEqual([['unclosed-past-day', dateAt(430)]]);
  });

  it('stops when the last page is exactly full and the next page is empty', async () => {
    const days: Array<[string, Data]> = Array.from({ length: 6 }, (_, index) => [dateAt(index, Date.UTC(2026, 9, 1)), dayDoc()]);
    setup({ days, leaseUpdatedAt: ts('2026-10-20T02:00:00.000Z') });
    await reader({ pageSize: 3 }).read();
    expect(dayQueries()).toHaveLength(3);
  });

  it.each([
    ['seq', { seq: 11 }],
    ['datasetId', { datasetId: 'other-dataset' }],
  ])('returns STALE_SNAPSHOT when the head %s changes during the read', async (_label, change) => {
    setup({ heads: [head(), head(change)] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('returns STALE_SNAPSHOT when the head changes between two pages', async () => {
    const days: Array<[string, Data]> = Array.from({ length: 7 }, (_, index) => [dateAt(index, Date.UTC(2026, 9, 1)), dayDoc()]);
    // initial head, after the post-close entries page, after day page 1 (unchanged), after day page 2 (changed).
    setup({ days, heads: [head(), head(), head(), head({ seq: 12 })], leaseUpdatedAt: ts('2026-10-20T02:00:00.000Z') });
    await expect(reader({ pageSize: 3 }).read()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(dayQueries()).toHaveLength(2);
  });

  it('fails closed when a closed day has no latest settlement, or it is not a closing version', async () => {
    const closed: Array<[string, Data]> = [['2026-10-01', dayDoc({ status: 'closed', openingCash: 100, lastSettlementRevision: 2 })]];
    setup({ days: closed, settlements: {} });
    await expect(reader().read()).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
    setup({
      days: closed,
      settlements: { 'days/2026-10-01/settlements/2': settlementDoc('2026-10-01', 2, { status: 'reopened', countedCash: null, difference: null, note: '重開' }) },
    });
    await expect(reader().read()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    setup({ days: [['2026-10-01', dayDoc({ status: 'closed', openingCash: 100, lastSettlementRevision: 0 })]] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('uses the Taipei date of the server lease time, not the browser clock', async () => {
    setup({ leaseUpdatedAt: ts('2026-10-05T16:30:00.000Z') });
    expect((await reader().read()).today).toBe('2026-10-06');
  });

  it('refuses a head with a malformed day path', async () => {
    setup({ days: [['2026-10-02x', dayDoc()]] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
});

describe('createCloudLedgerReader.findPreviousClosed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = {} as Firestore;
  });

  const closedDay = () => dayDoc({ status: 'closed', openingCash: 100, lastSettlementRevision: 1, totals: totals(1) });
  const closedSettlements = (dayId: string, counted: number) => ({ [`days/${dayId}/settlements/1`]: settlementDoc(dayId, 1, { countedCash: counted }) });

  it('finds the latest closed day dated before the asked day inside the first segment and reads only its settlement', async () => {
    setup({
      days: [['2026-10-02', closedDay()], ['2026-10-04', dayDoc({ status: 'reopened', lastSettlementRevision: 2 })], ['2026-10-05', closedDay()]],
      settlements: { ...closedSettlements('2026-10-02', 90), ...closedSettlements('2026-10-05', 130) },
    });
    const result = await reader().findPreviousClosed('2026-10-06');
    expect(result).toEqual({ previous: { dayId: '2026-10-05', countedCash: 130, postCloseNet: 0 }, seq: 10 });
    expect(settlementReads().map(([ref]) => ref.path)).toEqual(['days/2026-10-05/settlements/1']);
    expect(dayQueries()).toEqual([[
      { type: 'where', field: '__name__', op: '>=', value: '2026-10-01' },
      { type: 'where', field: '__name__', op: '<', value: '2026-10-06' },
      { type: 'orderBy', field: '__name__', direction: undefined },
      { type: 'limit', count: 31 },
    ]]);
  });

  it('does not count the asked day or later days, nor open and reopened days', async () => {
    setup({
      days: [['2026-10-02', closedDay()], ['2026-10-03', dayDoc()], ['2026-10-04', closedDay()], ['2026-10-05', dayDoc({ status: 'reopened', lastSettlementRevision: 1 })]],
      settlements: { ...closedSettlements('2026-10-02', 90), ...closedSettlements('2026-10-04', 70) },
    });
    expect((await reader().findPreviousClosed('2026-10-04')).previous).toEqual({ dayId: '2026-10-02', countedCash: 90, postCloseNet: 0 });
  });

  it('walks back segment by segment until it finds a closed day, beyond any fixed day limit', async () => {
    setup({
      days: [['2026-01-03', closedDay()]],
      settlements: closedSettlements('2026-01-03', 55),
      heads: [head({ goLiveDate: '2026-01-01' })],
    });
    const result = await reader({ segmentDays: 5 }).findPreviousClosed('2026-10-20');
    expect(result.previous).toEqual({ dayId: '2026-01-03', countedCash: 55, postCloseNet: 0 });
    // Every 5-day segment from 2026-10-15 back to the one that holds 2026-01-03 was queried, newest first.
    const queries = dayQueries();
    expect(queries.length).toBeGreaterThan(40);
    expect(queries[0]).toContainEqual({ type: 'where', field: '__name__', op: '>=', value: '2026-10-15' });
    expect(queries[0]).toContainEqual({ type: 'where', field: '__name__', op: '<', value: '2026-10-20' });
    expect(queries.at(-1)).toContainEqual({ type: 'where', field: '__name__', op: '>=', value: '2026-01-03' });
    // One head read before the walk and one after every segment.
    expect(headReads()).toHaveLength(1 + queries.length);
  });

  it('returns null after walking back to goLiveDate without finding a closed day', async () => {
    setup({ days: [['2026-10-02', dayDoc()]] });
    const result = await reader({ segmentDays: 4 }).findPreviousClosed('2026-10-12');
    expect(result.previous).toBeNull();
    expect(dayQueries().at(-1)).toContainEqual({ type: 'where', field: '__name__', op: '>=', value: '2026-10-01' });
  });

  it('does not query when the asked day is the go-live date or earlier', async () => {
    setup({ days: [['2026-10-01', closedDay()]] });
    expect((await reader().findPreviousClosed('2026-10-01')).previous).toBeNull();
    expect((await reader().findPreviousClosed('2026-09-20')).previous).toBeNull();
    expect(dayQueries()).toHaveLength(0);
  });

  it('shares the settlement cache with read() on the same Firestore instance', async () => {
    setup({ days: [['2026-10-02', closedDay()]], settlements: closedSettlements('2026-10-02', 90) });
    await reader().read();
    await reader().findPreviousClosed('2026-10-04');
    expect(settlementReads()).toHaveLength(1);
  });

  it.each([
    ['seq', { seq: 11 }],
    ['datasetId', { datasetId: 'other-dataset' }],
  ])('returns STALE_SNAPSHOT when the head %s changes between segments', async (_label, change) => {
    setup({ days: [['2026-10-02', dayDoc()]], heads: [head(), head(change)] });
    await expect(reader({ segmentDays: 4 }).findPreviousClosed('2026-10-12')).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('fails closed on a malformed day path, a missing settlement, and a bad date', async () => {
    setup({ days: [['2026-10-02x', dayDoc()]] });
    await expect(reader().findPreviousClosed('2026-10-06')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    setup({ days: [['2026-10-02', closedDay()]], settlements: {} });
    await expect(reader().findPreviousClosed('2026-10-06')).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
    await expect(reader().findPreviousClosed('2026-13-40')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('createCloudLedgerReader.findNextOpened (contract §14.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = {} as Firestore;
  });

  it('returns the nearest day after the asked day that has a confirmed opening cash, skipping unopened days', async () => {
    setup({
      days: [
        ['2026-10-01', dayDoc({ openingCash: 100 })],
        ['2026-10-02', dayDoc({ openingCash: 999 })],
        ['2026-10-03', dayDoc()],
        ['2026-10-04', dayDoc({ openingCash: 950 })],
        ['2026-10-05', dayDoc({ openingCash: 700 })],
      ],
    });
    const result = await reader().findNextOpened('2026-10-02');
    expect(result).toEqual({ next: { dayId: '2026-10-04', openingCash: 950 }, seq: 10 });
    expect(dayQueries()).toEqual([[
      { type: 'where', field: '__name__', op: '>', value: '2026-10-02' },
      { type: 'where', field: '__name__', op: '<=', value: '2026-10-05' },
      { type: 'orderBy', field: '__name__', direction: undefined },
      { type: 'limit', count: 31 },
    ]]);
  });

  it('counts a closed or reopened day as opened, and does not count the asked day itself', async () => {
    setup({ days: [['2026-10-02', dayDoc({ openingCash: 800 })], ['2026-10-03', dayDoc({ status: 'closed', openingCash: 640, lastSettlementRevision: 1 })]] });
    expect((await reader().findNextOpened('2026-10-02')).next).toEqual({ dayId: '2026-10-03', openingCash: 640 });
  });

  it('returns null when no later day up to the lease date is opened', async () => {
    setup({ days: [['2026-10-02', dayDoc({ openingCash: 800 })], ['2026-10-04', dayDoc()]] });
    expect((await reader().findNextOpened('2026-10-02')).next).toBeNull();
  });

  it('walks forward segment by segment until it finds an opened day, bounded by the lease date', async () => {
    setup({
      days: [['2026-10-20', dayDoc({ openingCash: 500 })]],
      heads: [head({ goLiveDate: '2026-10-01' })],
      leaseUpdatedAt: ts('2026-10-25T02:00:00.000Z'),
    });
    const result = await reader({ segmentDays: 5 }).findNextOpened('2026-10-02');
    expect(result.next).toEqual({ dayId: '2026-10-20', openingCash: 500 });
    const queries = dayQueries();
    expect(queries[0]).toContainEqual({ type: 'where', field: '__name__', op: '>', value: '2026-10-02' });
    expect(queries[0]).toContainEqual({ type: 'where', field: '__name__', op: '<=', value: '2026-10-07' });
    expect(queries.at(-1)).toContainEqual({ type: 'where', field: '__name__', op: '<=', value: '2026-10-22' });
    // One head read before the walk and one after every segment.
    expect(headReads()).toHaveLength(1 + queries.length);
  });

  it('does not query when the asked day is the lease date or later', async () => {
    setup({ days: [['2026-10-05', dayDoc({ openingCash: 100 })]] });
    expect((await reader().findNextOpened('2026-10-05')).next).toBeNull();
    expect(dayQueries()).toHaveLength(0);
  });

  it.each([
    ['seq', { seq: 11 }],
    ['datasetId', { datasetId: 'other-dataset' }],
  ])('returns STALE_SNAPSHOT when the head %s changes between segments', async (_label, change) => {
    setup({ days: [['2026-10-04', dayDoc()]], heads: [head(), head(change)] });
    await expect(reader({ segmentDays: 2 }).findNextOpened('2026-10-01')).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('fails closed on a malformed day path and a bad date', async () => {
    setup({ days: [['2026-10-04x', dayDoc()]] });
    await expect(reader().findNextOpened('2026-10-01')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    await expect(reader().findNextOpened('2026-13-40')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('createCloudLedgerReader: post-close entries (contract §15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = {} as Firestore;
  });

  const entry = (id: string, dayId: string, change: Data = {}): [string, Data] => [id, {
    entryId: id, dayId, settlementRevision: 1, direction: 'expense', amount: 50, reason: '關帳後發現漏記',
    createdBy: uid, createdAt: ts('2026-10-03T10:00:00.000Z'), commandId: id, ...change,
  }];
  const uuidOf = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  // Monday closed at 1,000; Wednesday opens at 950 (the Q2 example).
  const q2Days: Array<[string, Data]> = [
    ['2026-10-01', dayDoc({ status: 'closed', openingCash: 830, lastSettlementRevision: 1, totals: totals(1) })],
    ['2026-10-03', dayDoc({ openingCash: 950, totals: totals(1) })],
  ];
  const q2Settlements = { 'days/2026-10-01/settlements/1': settlementDoc('2026-10-01', 1, { countedCash: 1000, openingCash: 830, expectedCash: 1000 }) };

  it('counts the current settlement version\'s entries in the closed day\'s effective cash, so the Q2 mismatch disappears', async () => {
    setup({ days: q2Days, settlements: q2Settlements });
    const without = await reader().read();
    const mismatches = (anomalies: Array<{ kind: string; dayId: string }>) => anomalies.filter(item => item.kind === 'opening-mismatch').map(item => item.dayId);
    expect(mismatches(without.anomalies)).toEqual(['2026-10-03']);

    setup({ days: q2Days, settlements: q2Settlements, entries: [entry(uuidOf(1), '2026-10-01')] });
    const withEntry = await reader().read();
    expect(withEntry.closedDays).toEqual([{ dayId: '2026-10-01', countedCash: 1000, postCloseNet: -50 }]);
    expect(mismatches(withEntry.anomalies)).toEqual([]);
  });

  it('adds income and subtracts expense, and ignores entries of an older settlement version', async () => {
    const days: Array<[string, Data]> = [['2026-10-01', dayDoc({ status: 'closed', openingCash: 830, lastSettlementRevision: 3, totals: totals(1) })]];
    setup({
      days,
      settlements: { 'days/2026-10-01/settlements/3': settlementDoc('2026-10-01', 3, { countedCash: 1000 }) },
      entries: [
        entry(uuidOf(1), '2026-10-01', { settlementRevision: 1, amount: 900 }),
        entry(uuidOf(2), '2026-10-01', { settlementRevision: 3, direction: 'income', amount: 70 }),
        entry(uuidOf(3), '2026-10-01', { settlementRevision: 3, amount: 20 }),
        entry(uuidOf(4), '2026-10-02', { settlementRevision: 1, amount: 5 }),
      ],
    });
    expect((await reader().read()).closedDays).toEqual([{ dayId: '2026-10-01', countedCash: 1000, postCloseNet: 50 }]);
  });

  it('reads the whole collection once with startAfter, compares the head after each page, and fails closed on a change', async () => {
    const entries = Array.from({ length: 5 }, (_, index) => entry(uuidOf(index + 1), '2026-10-01'));
    setup({ days: q2Days, settlements: q2Settlements, entries });
    await reader({ pageSize: 2 }).read();
    const queries = entryQueries();
    expect(queries).toHaveLength(3);
    expect(queries.map(constraints => constraints.some(item => item.type === 'startAfter'))).toEqual([false, true, true]);
    expect(queries.every(constraints => constraints.some(item => item.type === 'orderBy') && !constraints.some(item => item.type === 'where'))).toBe(true);
    vi.clearAllMocks();
    // initial head, then a changed head after the first entries page.
    setup({ days: q2Days, settlements: q2Settlements, entries, heads: [head(), head({ seq: 12 })] });
    await expect(reader({ pageSize: 2 }).read()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(dayQueries()).toHaveLength(0);
  });

  it('fails closed on an entry the schema does not know', async () => {
    setup({ days: q2Days, settlements: q2Settlements, entries: [entry(uuidOf(1), '2026-10-01', { amount: 0 })] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    setup({ days: q2Days, settlements: q2Settlements, entries: [entry(uuidOf(1), '2026-10-01', { extra: true })] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('findPreviousClosed returns the entries\' net of just the closed day it found, by an equality query on dayId', async () => {
    setup({
      days: q2Days, settlements: q2Settlements,
      entries: [entry(uuidOf(1), '2026-10-01', { direction: 'income', amount: 30 }), entry(uuidOf(2), '2026-10-02')],
    });
    const result = await reader().findPreviousClosed('2026-10-03');
    expect(result.previous).toEqual({ dayId: '2026-10-01', countedCash: 1000, postCloseNet: 30 });
    const queries = entryQueries();
    expect(queries).toHaveLength(1);
    expect(queries[0]!.find(item => item.type === 'where')).toMatchObject({ field: 'dayId', op: '==', value: '2026-10-01' });
  });
});
