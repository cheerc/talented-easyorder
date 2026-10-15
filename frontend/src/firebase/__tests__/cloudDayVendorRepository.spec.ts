// @ts-expect-error Node-only path utility used by the Emulator test.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path utility used by the Emulator test.
import path from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import {
  Timestamp,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createCloudDayVendorRepository,
} from '../cloudDayVendorRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_DAY_VENDORS === 'true';
if (required && !emulatorHost) throw new Error('P07 day/vendor read Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), '../firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p07-read-operator-a', email: 'p07-read-a@example.test', displayName: 'Synthetic Read A', active: true };
const operatorB = { uid: 'p07-read-operator-b', email: 'p07-read-b@example.test', displayName: 'Synthetic Read B', active: true };
const syntheticTimestamp = Timestamp.fromDate(new Date('2026-10-13T00:00:00.000Z'));

let env: RulesTestEnvironment;
let selectionDate = '';
let targetDate = '';

function taipeiDate(value: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value.toDate());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function shiftDate(date: string, offset: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

async function withAdmin<T>(callback: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async context => {
    result = await callback(context.firestore() as unknown as Firestore);
  });
  return result;
}

function fakeCurrentUser(operator: typeof operatorA, overrides: Partial<User> = {}) {
  return {
    uid: operator.uid,
    email: operator.email,
    emailVerified: true,
    providerData: [{ providerId: 'google.com' }],
    ...overrides,
  } as unknown as User;
}

function authedDb(operator: typeof operatorA): Firestore {
  return env.authenticatedContext(operator.uid, {
    email: operator.email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

function repository(operator: typeof operatorA, pageSize?: number) {
  return createCloudDayVendorRepository(authedDb(operator), {
    currentUser: () => fakeCurrentUser(operator),
    ...(pageSize === undefined ? {} : { pageSize }),
  });
}

function vendorDocument(id: string, index: number, options: { deleted?: boolean; status?: 'active' | 'inactive'; name?: string } = {}) {
  return {
    vendorId: id,
    name: options.name ?? `Synthetic Vendor ${index}`,
    phone: '',
    note: '',
    status: options.status ?? 'active',
    deleted: options.deleted ?? false,
    createdAt: syntheticTimestamp,
    revision: 1,
    lastCommandId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    updatedAt: syntheticTimestamp,
  };
}

function dayDocument(index: number, menu: Record<string, unknown> | null = null) {
  return {
    status: 'open',
    revision: 1,
    menu,
    openingCash: null,
    openedBy: null,
    openedAt: null,
    totals: {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0,
      mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    updatedAt: syntheticTimestamp,
  };
}

function menuDocument(dayId: string, options: {
  vendorId: string; vendorNameSnapshot: string; itemName?: string; price?: number;
}) {
  return {
    businessDate: dayId,
    itemName: options.itemName ?? `Menu ${dayId}`,
    price: options.price ?? 100,
    vendorId: options.vendorId,
    vendorNameSnapshot: options.vendorNameSnapshot,
    updatedAt: syntheticTimestamp,
    revision: 1,
    inheritedFromDate: null,
  };
}

async function seedHolder(options: { leaseUpdatedAt?: Timestamp } = {}) {
  const leaseUpdatedAt = options.leaseUpdatedAt ?? Timestamp.now();
  selectionDate = taipeiDate(leaseUpdatedAt);
  targetDate = shiftDate(selectionDate, 1);
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `operators/${operatorA.uid}`), {
      ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `operators/${operatorB.uid}`), {
      ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'system/accessLease'), {
      holderUid: operatorA.uid, epoch: 1, updatedAt: leaseUpdatedAt,
    });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1,
      datasetId: 'p07-synthetic-day-vendor-dataset',
      seq: 0,
      lastCommandId: null,
      maintenance: false,
      goLiveDate: shiftDate(selectionDate, -30),
      updatedAt: serverTimestamp(),
    });
  });
}

async function seedVendors(count: number, options: { tombstones?: boolean } = {}) {
  await withAdmin(async db => {
    for (let offset = 0; offset < count; offset += 450) {
      const batch = writeBatch(db);
      const end = Math.min(offset + 450, count);
      for (let index = offset; index < end; index += 1) {
        const id = `synthetic-vendor-${index.toString().padStart(4, '0')}`;
        batch.set(doc(db, `vendors/${id}`), vendorDocument(id, index + 1, {
          deleted: options.tombstones === true || index % 2 === 1,
        }));
      }
      await batch.commit();
    }
  });
}

async function seedDays(count: number, options: { menuAt?: number; menu?: Record<string, unknown> } = {}) {
  await withAdmin(async db => {
    for (let offset = 0; offset < count; offset += 450) {
      const batch = writeBatch(db);
      const end = Math.min(offset + 450, count);
      for (let index = offset; index < end; index += 1) {
        const dayId = shiftDate(selectionDate, -index - 1);
        const menu = index === options.menuAt ? { ...options.menu } : null;
        batch.set(doc(db, `days/${dayId}`), dayDocument(index + 1, menu));
      }
      await batch.commit();
    }
  });
}

describeWithEmulator('P07 server-only day/vendor repository reads and production Rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: {
        rules: readFileSync(rulesPath, 'utf8'),
        host: emulatorHost!.split(':')[0],
        port: Number(emulatorHost!.split(':')[1] || '8080'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedHolder();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('loads an authorized empty snapshot from the server and defaults its day from the server lease date', async () => {
    const result = await repository(operatorA).loadSnapshot();
    expect(result).toEqual({
      dayId: selectionDate,
      selectionDate,
      day: null,
      vendors: [],
      latestEarlierMenu: null,
      seq: 0,
      datasetId: 'p07-synthetic-day-vendor-dataset',
      goLiveDate: shiftDate(selectionDate, -30),
    });
  });

  it('loads an explicit target day and hides tombstones after decoding all physical vendors', async () => {
    await withAdmin(async db => {
      await setDoc(doc(db, `days/${targetDate}`), dayDocument(1));
      await setDoc(doc(db, 'vendors/visible-vendor'), vendorDocument('visible-vendor', 1));
      await setDoc(doc(db, 'vendors/tombstone-vendor'), vendorDocument('tombstone-vendor', 2, { deleted: true }));
    });
    const result = await repository(operatorA).loadSnapshot(targetDate);
    expect(result.dayId).toBe(targetDate);
    expect(result.day).toMatchObject({ dayId: targetDate, status: 'open', openingCash: null });
    expect(result.vendors.map(item => item.vendorId)).toEqual(['visible-vendor']);
  });

  it('fails closed when a physical tombstone is missing its deleted field', async () => {
    await withAdmin(async db => {
      const malformed = vendorDocument('malformed-vendor', 1, { deleted: true }) as Record<string, unknown>;
      delete malformed.deleted;
      await setDoc(doc(db, 'vendors/malformed-vendor'), malformed);
    });
    await expect(repository(operatorA).loadSnapshot()).rejects.toMatchObject({
      name: 'CloudDayVendorRepositoryError', code: 'UNSUPPORTED_SCHEMA',
    });
  });

  it('returns all 500 physical vendor rows across pages and filters tombstones only after complete decoding', async () => {
    await seedVendors(500);
    const result = await repository(operatorA).loadSnapshot();
    expect(result.vendors).toHaveLength(250);
    expect(result.vendors[0]?.vendorId).toBe('synthetic-vendor-0000');
    expect(result.vendors[249]?.vendorId).toBe('synthetic-vendor-0498');
  });

  it('probes past 500 physical vendor records and rejects 501 tombstones as incomplete', async () => {
    await seedVendors(501, { tombstones: true });
    await expect(repository(operatorA).loadSnapshot()).rejects.toMatchObject({
      name: 'CloudDayVendorRepositoryError', code: 'INCOMPLETE_SNAPSHOT',
    });
  });

  it('pages across null menus and reports the immediate newest source as blocked without falling back', async () => {
    const olderMenuDay = shiftDate(selectionDate, -8);
    const newestMenuDay = shiftDate(selectionDate, -5);
    await withAdmin(async db => {
      await setDoc(doc(db, 'vendors/active-source-vendor'), vendorDocument('active-source-vendor', 1, { name: 'Active Source' }));
      await setDoc(doc(db, 'vendors/inactive-source-vendor'), vendorDocument('inactive-source-vendor', 2, { name: 'Inactive Source', status: 'inactive' }));
      for (let index = 0; index < 8; index += 1) {
        const dayId = shiftDate(selectionDate, -index - 1);
        const menu = dayId === olderMenuDay
          ? menuDocument(dayId, { vendorId: 'active-source-vendor', vendorNameSnapshot: 'Active Source' })
          : dayId === newestMenuDay
            ? menuDocument(dayId, { vendorId: 'inactive-source-vendor', vendorNameSnapshot: 'Inactive Source' })
            : null;
        await setDoc(doc(db, `days/${dayId}`), dayDocument(index + 1, menu));
      }
    });
    const result = await repository(operatorA, 2).loadSnapshot(targetDate);
    expect(result.latestEarlierMenu).toMatchObject({
      sourceDayId: newestMenuDay,
      menu: { vendorId: 'inactive-source-vendor', vendorNameSnapshot: 'Inactive Source' },
      sourceVendor: { status: 'inactive', deleted: false },
      blocked: 'vendor-inactive',
    });
    expect(result.latestEarlierMenu?.sourceDayId).not.toBe(olderMenuDay);
  });

  it('finds a sparse source across empty calendar gaps and ignores an older menu', async () => {
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), {
      goLiveDate: shiftDate(selectionDate, -3_000),
    }));
    const nullDay = shiftDate(selectionDate, -3);
    const sparseSource = shiftDate(selectionDate, -900);
    const olderSource = shiftDate(selectionDate, -1_500);
    await withAdmin(async db => {
      await setDoc(doc(db, 'vendors/active-source-vendor'), vendorDocument('active-source-vendor', 1, { name: 'Active Source' }));
      await setDoc(doc(db, `days/${nullDay}`), dayDocument(1));
      await setDoc(doc(db, `days/${sparseSource}`), dayDocument(2, menuDocument(sparseSource, {
        vendorId: 'active-source-vendor', vendorNameSnapshot: 'Active Source', itemName: 'Sparse Source',
      })));
      await setDoc(doc(db, `days/${olderSource}`), dayDocument(3, menuDocument(olderSource, {
        vendorId: 'active-source-vendor', vendorNameSnapshot: 'Active Source', itemName: 'Older Source',
      })));
    });
    const result = await repository(operatorA, 2).loadSnapshot(targetDate);
    expect(result.latestEarlierMenu).toMatchObject({
      sourceDayId: sparseSource,
      menu: { itemName: 'Sparse Source' },
      blocked: null,
    });
  });

  it('probes beyond exactly 2,000 empty source days and rejects an additional physical day', async () => {
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), {
      goLiveDate: shiftDate(selectionDate, -3_000),
    }));
    await seedDays(2_000);
    const exact = await repository(operatorA, 200).loadSnapshot(targetDate);
    expect(exact.latestEarlierMenu).toBeNull();

    await withAdmin(async db => {
      const extraDate = shiftDate(selectionDate, -2_001);
      await setDoc(doc(db, `days/${extraDate}`), dayDocument(2_001));
    });
    await expect(repository(operatorA, 200).loadSnapshot(targetDate)).rejects.toMatchObject({
      name: 'CloudDayVendorRepositoryError', code: 'INCOMPLETE_SNAPSHOT',
    });
    // Seeding 2,001 physical days plus two complete scans exceeds the 5s default on cold runners.
  }, 60_000);

  it('uses server reads and distinguishes an offline state from a successful empty result', async () => {
    const db = authedDb(operatorA);
    await disableNetwork(db);
    try {
      await expect(createCloudDayVendorRepository(db, { currentUser: () => fakeCurrentUser(operatorA) }).loadSnapshot())
        .rejects.toMatchObject({ name: 'CloudDayVendorRepositoryError', code: 'OFFLINE' });
    } finally {
      await enableNetwork(db);
    }
  });

  it('rejects a nonholder repository read and denies raw vendor/day reads under production Rules', async () => {
    await withAdmin(async db => {
      await setDoc(doc(db, 'vendors/private-vendor'), vendorDocument('private-vendor', 1));
      await setDoc(doc(db, `days/${selectionDate}`), dayDocument(2));
    });
    await expect(repository(operatorB).loadSnapshot()).rejects.toMatchObject({
      name: 'CloudDayVendorRepositoryError', code: 'LEASE_LOST',
    });
    const db = authedDb(operatorB);
    await assertFails(getDoc(doc(db, 'vendors/private-vendor')));
    await assertFails(getDoc(doc(db, `days/${selectionDate}`)));
  });
});
