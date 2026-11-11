import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

const firestoreMocks = vi.hoisted(() => ({
  doc: vi.fn(),
  collection: vi.fn(),
  documentId: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  startAfter: vi.fn(),
  where: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: firestoreMocks.doc,
    collection: firestoreMocks.collection,
    documentId: firestoreMocks.documentId,
    getDocFromServer: firestoreMocks.getDocFromServer,
    getDocsFromServer: firestoreMocks.getDocsFromServer,
    getDoc: firestoreMocks.getDoc,
    getDocs: firestoreMocks.getDocs,
    limit: firestoreMocks.limit,
    orderBy: firestoreMocks.orderBy,
    query: firestoreMocks.query,
    startAfter: firestoreMocks.startAfter,
    where: firestoreMocks.where,
  };
});

import { createCloudDayVendorRepository } from '../cloudDayVendorRepository';
import { plainMessage } from './helpers/plainMessage';

const uid = 'synthetic-operator';
const commandId = '11111111-1111-4111-8111-111111111111';
const previousCommandId = '22222222-2222-4222-8222-222222222222';
const db = {} as Firestore;
const user = {
  uid,
  email: 'operator@example.test',
  emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
} as unknown as User;

type MockDocument = { id: string; data: () => Record<string, unknown> };
type QueryConstraint =
  | { type: 'limit'; count: number }
  | { type: 'startAfter'; cursor: MockDocument }
  | { type: 'where'; field: string; op: string; value: unknown }
  | { type: 'orderBy'; field: string; direction?: string };
type MockQuery = { collection: { path: string }; constraints: QueryConstraint[] };

function ts(iso: string) {
  return Timestamp.fromDate(new Date(iso));
}

function snapshot(id: string, data: Record<string, unknown> | undefined) {
  return {
    id,
    exists: () => data !== undefined,
    data: () => data,
  };
}

function document(id: string, value: Record<string, unknown>): MockDocument {
  return { id, data: () => value };
}

function head(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    datasetId: 'synthetic-read-dataset',
    seq: 10,
    lastCommandId: null,
    maintenance: false,
    goLiveDate: '2020-01-01',
    updatedAt: ts('2026-10-15T16:00:00.000Z'),
    ...overrides,
  };
}

function lease(overrides: Record<string, unknown> = {}) {
  return {
    holderUid: uid,
    epoch: 3,
    updatedAt: ts('2026-10-15T16:30:00.000Z'),
    ...overrides,
  };
}

function validVendor(id: string, overrides: Record<string, unknown> = {}) {
  return {
    vendorId: id,
    name: `Vendor ${id}`,
    phone: '',
    note: '',
    status: 'active',
    deleted: false,
    createdAt: ts('2026-01-01T00:00:00.000Z'),
    revision: 1,
    lastCommandId: commandId,
    updatedAt: ts('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function validMenu(dayId: string, vendorId: string, vendorNameSnapshot: string) {
  return {
    businessDate: dayId,
    itemName: 'Synthetic Bento',
    price: 100,
    vendorId,
    vendorNameSnapshot,
    updatedAt: ts('2026-01-01T00:00:00.000Z'),
    revision: 1,
    inheritedFromDate: null,
  };
}

function validDay(id: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'open',
    revision: 1,
    menu: null,
    openingCash: null,
    openedBy: null,
    openedAt: null,
    totals: {
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0, accountRefunds: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: previousCommandId,
    updatedAt: ts(`${id}T08:00:00.000Z`),
    ...overrides,
  };
}

function userOptions(pageSize = 200) {
  return { currentUser: () => user, pageSize };
}

function repo(pageSize = 200) {
  return createCloudDayVendorRepository(db, userOptions(pageSize));
}

function setupReadMocks(options: {
  heads?: Record<string, unknown>[];
  leases?: Record<string, unknown>[];
  targetDays?: Record<string, Record<string, unknown>>;
  vendors?: MockDocument[];
  sourceDays?: MockDocument[];
} = {}) {
  const heads = options.heads ?? [head()];
  const leases = options.leases ?? [lease()];
  const targetDays = options.targetDays ?? {};
  const vendors = options.vendors ?? [];
  const sourceDays = options.sourceDays ?? [];
  let headReads = 0;
  let leaseReads = 0;

  firestoreMocks.doc.mockImplementation((_db: Firestore, path: string) => ({ type: 'document', path }));
  firestoreMocks.collection.mockImplementation((_db: Firestore, path: string) => ({ type: 'collection', path }));
  firestoreMocks.documentId.mockReturnValue('__document_id__');
  firestoreMocks.limit.mockImplementation((count: number) => ({ type: 'limit', count }));
  firestoreMocks.orderBy.mockImplementation((field: string, direction?: string) => ({ type: 'orderBy', field, direction }));
  firestoreMocks.startAfter.mockImplementation((cursor: MockDocument) => ({ type: 'startAfter', cursor }));
  firestoreMocks.where.mockImplementation((field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }));
  firestoreMocks.query.mockImplementation((collection: { path: string }, ...constraints: QueryConstraint[]) => ({
    collection,
    constraints,
  }));

  firestoreMocks.getDocFromServer.mockImplementation(async (reference: { path: string }) => {
    if (reference.path === 'system/dataHead') {
      const value = heads[Math.min(headReads, heads.length - 1)];
      headReads += 1;
      return snapshot('dataHead', value);
    }
    if (reference.path === 'system/accessLease') {
      const value = leases[Math.min(leaseReads, leases.length - 1)];
      leaseReads += 1;
      return snapshot('accessLease', value);
    }
    if (reference.path.startsWith('days/')) {
      const dayId = reference.path.slice('days/'.length);
      return snapshot(dayId, targetDays[dayId]);
    }
    throw new Error(`Unexpected server document read: ${reference.path}`);
  });

  firestoreMocks.getDocsFromServer.mockImplementation(async (request: MockQuery) => {
    const count = request.constraints.find(item => item.type === 'limit')?.count ?? 200;
    const cursor = request.constraints.find(item => item.type === 'startAfter');
    const ordering = request.constraints.find(item => item.type === 'orderBy');
    if (ordering?.field === '__document_id__' && ordering.direction === 'desc') {
      // Mirrors Firestore Emulator: descending document-ID (key) scans are rejected.
      throw Object.assign(new Error('Firestore does not support descending key scans'), { code: 'failed-precondition' });
    }
    const filters = request.constraints
      .filter((item): item is Extract<QueryConstraint, { type: 'where' }> => item.type === 'where');
    const matches = (id: string) => filters.every(filter => {
      const value = String(filter.value);
      if (filter.op === '<') return id < value;
      if (filter.op === '<=') return id <= value;
      if (filter.op === '>=') return id >= value;
      if (filter.op === '>') return id > value;
      throw new Error(`Unexpected filter operator: ${filter.op}`);
    });
    const ascending = (left: MockDocument, right: MockDocument) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    const source = request.collection.path === 'vendors'
      ? [...vendors].sort(ascending)
      : request.collection.path === 'days'
        ? [...sourceDays].filter(item => matches(item.id)).sort(ascending)
        : (() => { throw new Error(`Unexpected server collection read: ${request.collection.path}`); })();
    const startIndex = cursor ? source.findIndex(item => item.id === cursor.cursor.id) + 1 : 0;
    const docs = source.slice(startIndex, startIndex + count);
    return { docs, empty: docs.length === 0 };
  });
}

function beforeEachSetup() {
  vi.clearAllMocks();
  firestoreMocks.getDoc.mockImplementation(() => { throw new Error('cache-capable getDoc must not be used'); });
  firestoreMocks.getDocs.mockImplementation(() => { throw new Error('cache-capable getDocs must not be used'); });
  setupReadMocks();
}

function sourceDay(id: string, menu: Record<string, unknown> | null = null) {
  return document(id, validDay(id, { menu }));
}

describe('cloud day/vendor repository mocked server reads', () => {
  beforeEach(beforeEachSetup);
  afterEach(() => vi.clearAllMocks());

  it('uses only server read APIs, scans tombstones before filtering, and derives the default date from lease.updatedAt', async () => {
    const staleLeaseDate = ts('2021-01-01T16:30:00.000Z');
    setupReadMocks({
      heads: [head({ goLiveDate: '2020-01-01' })],
      leases: [lease({ updatedAt: staleLeaseDate })],
      vendors: [
        document('vendor-active', validVendor('vendor-active')),
        document('vendor-tombstone', validVendor('vendor-tombstone', { deleted: true, status: 'inactive' })),
      ],
    });

    const result = await repo(1).loadSnapshot();

    expect(result).toMatchObject({ dayId: '2021-01-02', selectionDate: '2021-01-02' });
    expect(result.vendors.map(item => item.vendorId)).toEqual(['vendor-active']);
    const vendorPageReads = firestoreMocks.getDocsFromServer.mock.calls
      .filter(([request]) => (request as MockQuery).collection.path === 'vendors');
    expect(vendorPageReads).toHaveLength(3);
    expect(firestoreMocks.getDocFromServer.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(firestoreMocks.getDocsFromServer).toHaveBeenCalled();
    expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
  });

  it('rejects a malformed physical tombstone before applying the visible-vendor filter', async () => {
    const { deleted: _deleted, ...malformedTombstone } = validVendor('vendor-tombstone', { status: 'inactive' });
    void _deleted;
    setupReadMocks({ vendors: [document('vendor-tombstone', malformedTombstone)] });

    await expect(repo().loadSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA', message: plainMessage() });
  });

  it('distinguishes an exhausted 500-vendor collection from a 501-document overflow probe', async () => {
    const vendors = Array.from({ length: 500 }, (_, index) => {
      const id = `vendor-${String(index).padStart(3, '0')}`;
      return document(id, validVendor(id));
    });
    setupReadMocks({ vendors });

    const result = await repo().loadSnapshot();

    expect(result.vendors).toHaveLength(500);
    const vendorPages = firestoreMocks.getDocsFromServer.mock.calls
      .map(([request]) => request as MockQuery)
      .filter(request => request.collection.path === 'vendors');
    expect(vendorPages).toHaveLength(4);
    expect(vendorPages.at(-1)?.constraints).toContainEqual({ type: 'limit', count: 1 });

    const overflow = [...vendors, document('vendor-500', validVendor('vendor-500'))];
    setupReadMocks({ vendors: overflow });
    await expect(repo().loadSnapshot()).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
  });

  it.each([
    ['cash amount missing actor/time', { openingCash: null, openedBy: 'operator', openedAt: ts('2026-10-15T08:00:00.000Z') }],
    ['actor missing cash amount', { openingCash: 0, openedBy: null, openedAt: ts('2026-10-15T08:00:00.000Z') }],
    ['time missing cash amount', { openingCash: 0, openedBy: 'operator', openedAt: null }],
  ])('rejects day schema with inconsistent opening cash nullity: %s', async (_label, fields) => {
    setupReadMocks({ targetDays: { '2026-10-16': validDay('2026-10-16', fields) } });

    await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA', message: plainMessage() });
  });

  it.each(['mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense', 'accountRefunds'] as const)(
    'rejects day money total %s above 1,000,000,000', async field => {
      setupReadMocks({
        targetDays: {
          '2026-10-16': validDay('2026-10-16', {
            totals: { ...validDay('2026-10-16').totals, [field]: 1_000_000_001 },
          }),
        },
      });

      await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA', message: plainMessage() });
    },
  );

  it('does not scan earlier days when a snapshot loads: only the target day document and the vendors are read', async () => {
    setupReadMocks({
      vendors: [document('vendor-active', validVendor('vendor-active'))],
      sourceDays: [sourceDay('2026-10-14', validMenu('2026-10-14', 'vendor-active', 'Vendor vendor-active'))],
    });

    const result = await repo().loadSnapshot('2026-10-16');

    expect(result).not.toHaveProperty('latestEarlierMenu');
    const dayCollectionReads = firestoreMocks.getDocsFromServer.mock.calls
      .filter(([request]) => (request as MockQuery).collection.path === 'days');
    expect(dayCollectionReads).toHaveLength(0);
  });

  describe('readLastWeekMenus (#686): the previous calendar week Monday to Friday, read on demand', () => {
    const vendors = [
      { vendorId: 'vendor-a', name: '供應商A', status: 'active', deleted: false },
      { vendorId: 'vendor-off', name: '停用供應商', status: 'inactive', deleted: false },
      { vendorId: 'vendor-gone', name: '已移除供應商', status: 'active', deleted: true },
    ] as Parameters<ReturnType<typeof repo>['readLastWeekMenus']>[1];
    const menuOf = (dayId: string, vendorId: string, itemName: string, price = 90) => ({
      ...validMenu(dayId, vendorId, 'snapshot name'), itemName, price,
    });
    const weekDays = () => [
      sourceDay('2026-11-02', menuOf('2026-11-02', 'vendor-a', '雞腿便當')),
      sourceDay('2026-11-03', menuOf('2026-11-03', 'vendor-a', '雞腿便當')),
      sourceDay('2026-11-04', menuOf('2026-11-04', 'vendor-off', '停用便當')),
      sourceDay('2026-11-05', menuOf('2026-11-05', 'vendor-gone', '已移除便當')),
      sourceDay('2026-11-06', null),
      sourceDay('2026-10-30', menuOf('2026-10-30', 'vendor-a', '更早便當')),
      sourceDay('2026-11-09', menuOf('2026-11-09', 'vendor-a', '同一週便當')),
    ];
    const dayQueries = () => firestoreMocks.getDocsFromServer.mock.calls
      .map(([request]) => request as MockQuery)
      .filter(request => request.collection.path === 'days');

    it.each([
      ['a Thursday', '2026-11-12'],
      ['the Monday itself', '2026-11-09'],
      ['a Friday', '2026-11-13'],
      ['a Sunday (the week still starts on Monday 11-09)', '2026-11-15'],
    ])('reads 11-02 to 11-06 for %s, with limit 5 and an ascending document-ID range', async (_label, target) => {
      setupReadMocks({ sourceDays: weekDays() });

      const items = await repo().readLastWeekMenus(target, vendors);

      const queries = dayQueries();
      expect(queries).toHaveLength(1);
      expect(queries[0]!.constraints).toEqual(expect.arrayContaining([
        { type: 'where', field: '__document_id__', op: '>=', value: '2026-11-02' },
        { type: 'where', field: '__document_id__', op: '<=', value: '2026-11-06' },
        { type: 'orderBy', field: '__document_id__', direction: undefined },
        { type: 'limit', count: 5 },
      ]));
      expect(items.map(item => item.dayId)).toEqual(['2026-11-02', '2026-11-03']);
    });

    it('lists each day separately without merging identical menus, and skips inactive, removed or menu-less days', async () => {
      setupReadMocks({ sourceDays: weekDays() });

      const items = await repo().readLastWeekMenus('2026-11-12', vendors);

      expect(items).toEqual([
        { dayId: '2026-11-02', itemName: '雞腿便當', price: 90, vendorId: 'vendor-a', vendorName: '供應商A' },
        { dayId: '2026-11-03', itemName: '雞腿便當', price: 90, vendorId: 'vendor-a', vendorName: '供應商A' },
      ]);
    });

    it('returns an empty list when last week has no usable menu and never looks further back', async () => {
      setupReadMocks({ sourceDays: [sourceDay('2026-10-30', menuOf('2026-10-30', 'vendor-a', '更早便當'))] });

      expect(await repo().readLastWeekMenus('2026-11-12', vendors)).toEqual([]);
      expect(dayQueries()).toHaveLength(1);
    });

    it('computes the week from the date string, not from the browser clock or time zone', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      try {
        setupReadMocks({ sourceDays: weekDays() });
        const items = await repo().readLastWeekMenus('2026-11-12', vendors);
        expect(items).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails closed on a malformed day row in the range', async () => {
      setupReadMocks({
        sourceDays: [document('2026-11-03', { ...validDay('2026-11-03'), totals: null })],
      });

      await expect(repo().readLastWeekMenus('2026-11-12', vendors)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    });

    it('rejects an invalid date before reading anything', async () => {
      setupReadMocks();
      await expect(repo().readLastWeekMenus('2026-13-45', vendors)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
      expect(dayQueries()).toHaveLength(0);
    });
  });

  it.each([
    ['seq', { seq: 11 }],
    ['datasetId', { datasetId: 'changed-dataset' }],
    ['goLiveDate', { goLiveDate: '2020-01-02' }],
  ])('rejects a head that changes %s during the read', async (_label, change) => {
    setupReadMocks({ heads: [head(), head(change)] });

    await expect(repo().loadSnapshot()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('rejects a lease whose Taipei date crosses midnight while the snapshot is being read', async () => {
    setupReadMocks({
      leases: [
        lease({ updatedAt: ts('2026-10-15T15:59:00.000Z') }),
        lease({ updatedAt: ts('2026-10-15T16:01:00.000Z') }),
      ],
    });

    await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it.each([
    ['another holder', { holderUid: 'someone-else' }],
    ['unexpected lease field', { maintenance: false }],
    ['negative epoch', { epoch: -1 }],
    ['non-Timestamp update time', { updatedAt: '2026-10-15T16:30:00.000Z' }],
  ])('fails closed for lease schema or UID mismatch: %s', async (_label, change) => {
    setupReadMocks({ leases: [lease(change)] });

    await expect(repo().loadSnapshot()).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });
});
