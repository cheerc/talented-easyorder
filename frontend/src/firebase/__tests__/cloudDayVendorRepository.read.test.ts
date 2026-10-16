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

function makeDateBefore(dayId: string, daysAgo: number): string {
  return new Date(Date.parse(`${dayId}T00:00:00.000Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
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

    await expect(repo().loadSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
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

    await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
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

      await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    },
  );

  it('scans across null-menu pages and reports the newest blocked vendor source without falling back', async () => {
    const sourceDays = [
      sourceDay('2026-10-15'),
      sourceDay('2026-10-14'),
      sourceDay('2026-10-13', validMenu('2026-10-13', 'vendor-inactive', 'Vendor vendor-inactive')),
      sourceDay('2026-10-12', validMenu('2026-10-12', 'vendor-active', 'Vendor vendor-active')),
    ];
    setupReadMocks({
      vendors: [
        document('vendor-active', validVendor('vendor-active')),
        document('vendor-inactive', validVendor('vendor-inactive', { status: 'inactive' })),
      ],
      sourceDays,
    });

    const result = await repo(2).loadSnapshot('2026-10-16');

    expect(result.latestEarlierMenu).toMatchObject({
      sourceDayId: '2026-10-13',
      blocked: 'vendor-inactive',
      sourceVendor: { vendorId: 'vendor-inactive', status: 'inactive' },
    });
    const sourceReads = firestoreMocks.getDocsFromServer.mock.calls
      .filter(([request]) => (request as MockQuery).collection.path === 'days');
    expect(sourceReads).toHaveLength(3);
  });

  it('walks older calendar windows to the newest sparse source without a descending key scan', async () => {
    const sourceDays = [
      sourceDay('2026-10-01'),
      sourceDay('2026-08-20'),
      sourceDay('2024-03-05', validMenu('2024-03-05', 'vendor-active', 'Vendor vendor-active')),
      sourceDay('2023-01-01', validMenu('2023-01-01', 'vendor-active', 'Vendor vendor-active')),
    ];
    setupReadMocks({ vendors: [document('vendor-active', validVendor('vendor-active'))], sourceDays });

    const result = await repo().loadSnapshot('2026-10-16');

    expect(result.latestEarlierMenu).toMatchObject({ sourceDayId: '2024-03-05', blocked: null });
    const sourceReads = firestoreMocks.getDocsFromServer.mock.calls
      .map(([request]) => request as MockQuery)
      .filter(request => request.collection.path === 'days');
    expect(sourceReads.every(request => request.constraints.every(item => item.type !== 'orderBy' || item.direction === undefined)))
      .toBe(true);
  });

  it('fails closed on a malformed source-day row that is newer than the first menu', async () => {
    setupReadMocks({
      vendors: [document('vendor-active', validVendor('vendor-active'))],
      sourceDays: [
        document('2026-10-14', { ...validDay('2026-10-14'), totals: null }),
        sourceDay('2026-10-13', validMenu('2026-10-13', 'vendor-active', 'Vendor vendor-active')),
      ],
    });

    await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('probes beyond exactly 2,000 null-menu day documents to confirm exhaustion', async () => {
    const sourceDays = Array.from({ length: 2_000 }, (_, index) => {
      const id = makeDateBefore('2026-10-16', index + 1);
      return sourceDay(id);
    });
    setupReadMocks({ sourceDays });

    const result = await repo().loadSnapshot('2026-10-16');

    expect(result.latestEarlierMenu).toBeNull();
    const sourceReads = firestoreMocks.getDocsFromServer.mock.calls
      .map(([request]) => request as MockQuery)
      .filter(request => request.collection.path === 'days');
    expect(sourceReads).toHaveLength(20);
    expect(sourceReads.at(-1)?.constraints).toContainEqual({ type: 'limit', count: 1 });
  });

  it('returns INCOMPLETE_SNAPSHOT when a 2,001st source-day probe finds more null-menu documents', async () => {
    const sourceDays = Array.from({ length: 2_001 }, (_, index) => {
      const id = makeDateBefore('2026-10-16', index + 1);
      return sourceDay(id);
    });
    setupReadMocks({ sourceDays });

    await expect(repo().loadSnapshot('2026-10-16')).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
    const sourceReads = firestoreMocks.getDocsFromServer.mock.calls
      .filter(([request]) => (request as MockQuery).collection.path === 'days');
    expect(sourceReads).toHaveLength(20);
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
