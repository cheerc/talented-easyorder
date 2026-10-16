// @ts-expect-error Node-only path utility used by the emulator test.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path utility used by the emulator test.
import path from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import {
  Timestamp,
  deleteDoc,
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
import { listCloudStudents } from '../cloudStudentRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_STUDENTS === 'true';
if (required && !emulatorHost) throw new Error('P06 student-list Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const operatorA = { uid: 'p06-list-operator-a', email: 'p06-list-a@example.test', displayName: 'Synthetic List A', active: true };
const operatorB = { uid: 'p06-list-operator-b', email: 'p06-list-b@example.test', displayName: 'Synthetic List B', active: true };
const syntheticTimestamp = Timestamp.fromDate(new Date('2026-10-13T00:00:00.000Z'));

let env: RulesTestEnvironment;

function makeUuid(index: number): string {
  return `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
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

function studentDocument(id: string, index: number) {
  const commandId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
  const studentCode = index < 1000 ? index.toString().padStart(3, '0') : index.toString();
  return {
    studentId: id,
    studentCode,
    displayName: `Synthetic Student ${index}`,
    aliases: [],
    status: 'active',
    openingBalance: { amount: 0, asOfDate: today, note: '', createdAt: syntheticTimestamp },
    currentBalance: 0,
    createdAt: syntheticTimestamp,
    revision: 1,
    lastCommandId: commandId,
    updatedAt: syntheticTimestamp,
  };
}

async function seedHolder() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `operators/${operatorA.uid}`), {
      ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `operators/${operatorB.uid}`), {
      ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'system/accessLease'), {
      holderUid: operatorA.uid, epoch: 1, updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1,
      datasetId: 'p06-synthetic-list-dataset',
      seq: 0,
      lastCommandId: null,
      maintenance: false,
      goLiveDate: today,
      updatedAt: serverTimestamp(),
    });
  });
}

async function seedStudents(count: number): Promise<void> {
  await withAdmin(async db => {
    for (let offset = 0; offset < count; offset += 450) {
      const batch = writeBatch(db);
      const end = Math.min(offset + 450, count);
      for (let index = offset; index < end; index += 1) {
        const id = makeUuid(index);
        batch.set(doc(db, `students/${id}`), studentDocument(id, index + 1));
      }
      await batch.commit();
    }
  });
}

describeWithEmulator('P06 server-only student-list repository and production Rules', () => {
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

  it('returns an authorized, confirmed empty dataset with current metadata', async () => {
    const result = await listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) });
    expect(result).toEqual({
      students: [],
      seq: 0,
      datasetId: 'p06-synthetic-list-dataset',
      goLiveDate: today,
    });
  });

  it('loads all 500 records across server pages and preserves sorted string IDs and codes', async () => {
    await seedStudents(500);
    const result = await listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) });
    expect(result.students).toHaveLength(500);
    expect(result.students[0]?.studentId).toBe(makeUuid(0));
    expect(result.students[499]?.studentId).toBe(makeUuid(499));
    expect(result.students[0]?.studentCode).toBe('001');
    expect(result.students[499]?.studentCode).toBe('500');
    expect(result.students[0]?.createdAt).toBe('2026-10-13T00:00:00.000Z');
  });

  it('rejects 501 records instead of publishing an incomplete first-page list', async () => {
    await seedStudents(501);
    await expect(listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) }))
      .rejects.toMatchObject({ name: 'CloudStudentRepositoryError', code: 'INCOMPLETE_SNAPSHOT' });
  });

  it('rejects a malformed student in any page without returning a partial list', async () => {
    await seedStudents(201);
    await withAdmin(async db => setDoc(doc(db, `students/${makeUuid(200)}`), {
      ...studentDocument(makeUuid(200), 201), currentBalance: 1.25,
    }));
    await expect(listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) }))
      .rejects.toMatchObject({ name: 'CloudStudentRepositoryError', code: 'UNSUPPORTED_SCHEMA' });
  });

  it.each([
    ['mismatched studentId', makeUuid(1), studentDocument(makeUuid(2), 1)],
    ['invalid studentId format', 'not-a-uuid', studentDocument('not-a-uuid', 1)],
    ['invalid studentCode format', makeUuid(1), { ...studentDocument(makeUuid(1), 1), studentCode: '000' }],
    ['empty aliases', makeUuid(1), { ...studentDocument(makeUuid(1), 1), aliases: [''] }],
    ['malformed server timestamp', makeUuid(1), { ...studentDocument(makeUuid(1), 1), updatedAt: null }],
  ])('fails closed on %s', async (_label, id, data) => {
    await withAdmin(async db => setDoc(doc(db, `students/${id}`), data));
    await expect(listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) }))
      .rejects.toMatchObject({ name: 'CloudStudentRepositoryError', code: 'UNSUPPORTED_SCHEMA' });
  });

  it('distinguishes missing, malformed, and maintenance dataHead states', async () => {
    await withAdmin(db => deleteDoc(doc(db, 'system/dataHead')));
    await expect(listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    await seedHolder();
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), { schemaVersion: 2 }));
    await expect(listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    await seedHolder();
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), { maintenance: true }));
    await expect(listCloudStudents(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) }))
      .rejects.toMatchObject({ code: 'MAINTENANCE' });
  });

  it('rejects a nonholder, an unverified user, and an offline server read with distinct errors', async () => {
    await expect(listCloudStudents(authedDb(operatorB), { currentUser: () => fakeCurrentUser(operatorB) }))
      .rejects.toMatchObject({ code: 'LEASE_LOST' });
    await expect(listCloudStudents(authedDb(operatorA), {
      currentUser: () => fakeCurrentUser(operatorA, { emailVerified: false }),
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const db = authedDb(operatorA);
    await disableNetwork(db);
    try {
      await expect(listCloudStudents(db, { currentUser: () => fakeCurrentUser(operatorA) }))
        .rejects.toMatchObject({ name: 'CloudStudentRepositoryError', code: 'OFFLINE' });
    } finally {
      await enableNetwork(db);
    }
  });

  it('denies raw nonholder reads at the production Rules boundary', async () => {
    await seedStudents(1);
    const db = authedDb(operatorB);
    await assertFails(getDoc(doc(db, `students/${makeUuid(0)}`)));
  });
});
