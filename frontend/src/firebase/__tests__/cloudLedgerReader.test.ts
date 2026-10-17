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
  where: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, ...firestoreMocks };
});

import { createCloudLedgerReader } from '../cloudDayCloseRepository';

const uid = 'synthetic-operator';
const db = {} as Firestore;
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
  settlements?: Record<string, Data | undefined>;
  heads?: Data[];
  leaseUpdatedAt?: Timestamp;
}

function setup({ days = [], settlements = {}, heads = [head()], leaseUpdatedAt = ts('2026-10-05T02:00:00.000Z') }: Setup = {}) {
  let headReads = 0;
  firestoreMocks.documentId.mockReturnValue('__name__');
  firestoreMocks.doc.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.collection.mockImplementation((_db: unknown, path: string) => ({ path }));
  firestoreMocks.where.mockImplementation((field: unknown, op: string, value: unknown) => ({ type: 'where', field, op, value }));
  firestoreMocks.orderBy.mockImplementation((field: unknown, direction?: string) => ({ type: 'orderBy', field, direction }));
  firestoreMocks.limit.mockImplementation((count: number) => ({ type: 'limit', count }));
  firestoreMocks.query.mockImplementation((collectionRef: { path: string }, ...constraints: Constraint[]) => ({ collectionRef, constraints }));
  firestoreMocks.getDocFromServer.mockImplementation(async (ref: { path: string }) => {
    let value: Data | undefined;
    if (ref.path === 'system/dataHead') value = heads[Math.min(headReads++, heads.length - 1)];
    else if (ref.path === 'system/accessLease') value = { holderUid: uid, epoch: 1, updatedAt: leaseUpdatedAt };
    else value = settlements[ref.path];
    return { id: ref.path.split('/').at(-1), exists: () => value !== undefined, data: () => value };
  });
  firestoreMocks.getDocsFromServer.mockImplementation(async (request: { constraints: Constraint[] }) => {
    const bound = request.constraints.find(item => item.type === 'limit')?.count ?? Infinity;
    const docs = days.slice(0, bound).map(([id, value]) => ({ id, data: () => value }));
    return { size: docs.length, docs };
  });
}

const reader = () => createCloudLedgerReader(db, { currentUser: () => user });
const settlementReads = () => firestoreMocks.getDocFromServer.mock.calls.filter(([ref]) => String(ref.path).includes('/settlements/'));

describe('createCloudLedgerReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(snapshot.closedDays).toEqual([{ dayId: '2026-10-01', countedCash: 120 }]);
    expect(snapshot.anomalies.map(item => [item.kind, item.dayId])).toEqual([
      ['unclosed-past-day', '2026-10-03'], ['opening-mismatch', '2026-10-03'],
    ]);
    const constraints = firestoreMocks.query.mock.calls[0].slice(1) as Constraint[];
    expect(constraints).toEqual([
      { type: 'where', field: '__name__', op: '>=', value: '2026-10-01' },
      { type: 'where', field: '__name__', op: '<=', value: '2026-10-05' },
      { type: 'orderBy', field: '__name__', direction: undefined },
      { type: 'limit', count: 401 },
    ]);
    // Only the latest settlement version of a closed day is read.
    expect(settlementReads().map(([ref]) => ref.path)).toEqual(['days/2026-10-01/settlements/2']);
  });

  it('keeps immutable settlement versions in memory per reader', async () => {
    setup({
      days: [['2026-10-01', dayDoc({ status: 'closed', openingCash: 100, lastSettlementRevision: 1 })]],
      settlements: { 'days/2026-10-01/settlements/1': settlementDoc('2026-10-01', 1) },
    });
    const instance = reader();
    await instance.read();
    await instance.read();
    expect(settlementReads()).toHaveLength(1);
    await reader().read();
    expect(settlementReads()).toHaveLength(2);
  });

  it('fails closed with INCOMPLETE_SNAPSHOT above 400 business-day documents but accepts exactly 400', async () => {
    const make = (count: number): Array<[string, Data]> => Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
      return [date, dayDoc()];
    });
    setup({ days: make(400), heads: [head({ goLiveDate: '2026-01-01' })] });
    expect((await reader().read()).anomalies).toEqual([]);
    setup({ days: make(401), heads: [head({ goLiveDate: '2026-01-01' })] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
  });

  it.each([
    ['seq', { seq: 11 }],
    ['datasetId', { datasetId: 'other-dataset' }],
  ])('returns STALE_SNAPSHOT when the head %s changes during the read', async (_label, change) => {
    setup({ heads: [head(), head(change)] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
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
    setup({ days: [['not-a-date', dayDoc()]] });
    await expect(reader().read()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
});
