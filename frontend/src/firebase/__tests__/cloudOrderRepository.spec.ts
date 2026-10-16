// @ts-expect-error Node-only path utility used by the Emulator test.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path utility used by the Emulator test.
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCloudOrderRepository, type CreateCloudOrderInput } from '../cloudOrderRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_ORDERS === 'true';
if (required && !emulatorHost) throw new Error('P08 cloud order Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p08-order-a', email: 'p08-order-a@example.test', displayName: 'Synthetic Order A', active: true };
const operatorB = { uid: 'p08-order-b', email: 'p08-order-b@example.test', displayName: 'Synthetic Order B', active: true };
const strangerUid = 'p08-order-stranger';
const studentA = '11111111-1111-4111-8111-111111111111';
const studentB = '22222222-2222-4222-8222-222222222222';
const seedCommandId = '00000000-0000-4000-8000-000000000008';

let env: RulesTestEnvironment;
let today = '';

function taipeiDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
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

function fakeCurrentUser(operator: typeof operatorA) {
  return {
    uid: operator.uid,
    email: operator.email,
    emailVerified: true,
    providerData: [{ providerId: 'google.com' }],
  } as unknown as User;
}

function authedDb(operator: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(operator.uid, {
    email: operator.email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

function repository(operator: typeof operatorA, pageSize?: number) {
  return createCloudOrderRepository(authedDb(operator), {
    currentUser: () => fakeCurrentUser(operator),
    ...(pageSize === undefined ? {} : { pageSize }),
  });
}

function menu(price = 90, revision = 1) {
  return {
    businessDate: today, itemName: 'Synthetic Meal', price, vendorId: 'p08-vendor',
    vendorNameSnapshot: 'Synthetic Vendor', updatedAt: serverTimestamp(), revision, inheritedFromDate: null,
  };
}

function student(studentId: string, code: string, opening: number, status: 'active' | 'inactive' = 'active') {
  return {
    studentId, studentCode: code, displayName: `Synthetic ${code}`, aliases: [], status,
    openingBalance: { amount: opening, asOfDate: shiftDate(today, -1), note: '', createdAt: serverTimestamp() },
    currentBalance: opening, createdAt: serverTimestamp(), revision: 1,
    lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

async function seed(options: { withMenu?: boolean } = {}) {
  today = taipeiDate(new Date());
  await withAdmin(async db => {
    await setDoc(doc(db, `operators/${operatorA.uid}`), { ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, `operators/${operatorB.uid}`), { ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: operatorA.uid, epoch: 1, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p08-order-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: shiftDate(today, -30), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `students/${studentA}`), student(studentA, '001', 100));
    await setDoc(doc(db, 'studentCodes/001'), { studentId: studentA, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `students/${studentB}`), student(studentB, '002', 0));
    await setDoc(doc(db, 'studentCodes/002'), { studentId: studentB, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `days/${today}`), {
      status: 'open', revision: 1, menu: options.withMenu === false ? null : menu(),
      openingCash: null, openedBy: null, openedAt: null,
      totals: {
        activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
        retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
      },
      lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
    });
  });
}

let idCounter = 0;
function uuid(): string {
  idCounter += 1;
  return `${crypto.randomUUID().slice(0, 24)}${idCounter.toString(16).padStart(12, '0')}`;
}

async function orderInput(
  studentId: string,
  overrides: Partial<CreateCloudOrderInput> = {},
): Promise<CreateCloudOrderInput> {
  const snapshot = await repository(operatorA).loadSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  const bento = (overrides.mealKind ?? 'bento') === 'bento';
  return {
    commandId: uuid(),
    transactionId: uuid(),
    leaseEpoch: 1,
    studentId,
    dayId: snapshot.today,
    expectedStudentRevision: target.revision,
    expectedDayRevision: snapshot.day!.revision,
    mealKind: bento ? 'bento' : 'other',
    mealPrice: bento ? snapshot.day!.menu!.price : 70,
    paidAmount: 0,
    menuRevision: bento ? snapshot.day!.menu!.revision : null,
    otherItemName: bento ? null : 'Synthetic Noodles',
    note: '',
    ...overrides,
  };
}

async function countTransactions(): Promise<number> {
  return withAdmin(async db => (await getDocs(collection(db, 'transactions'))).size);
}

async function headSeq(): Promise<number> {
  return withAdmin(async db => Number((await getDoc(doc(db, 'system/dataHead'))).data()?.seq));
}

describeWithEmulator('P08 cloud order repository reads, retries and transactions list Rules', () => {
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
    await seed();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('P08.R1: only the current lease holder can list transactions; non-holders, strangers, expired leases and writes are denied', async () => {
    const result = await repository(operatorA).createOrder(await orderInput(studentA));
    expect(result.ok).toBe(true);
    const todayQuery = (db: Firestore) => getDocs(query(collection(db, 'transactions'), where('businessDate', '==', today)));

    await assertSucceeds(todayQuery(authedDb(operatorA)));
    await assertFails(todayQuery(authedDb(operatorB)));
    await assertFails(todayQuery(authedDb({ uid: strangerUid, email: 'stranger@example.test' })));
    await assertFails(todayQuery(env.unauthenticatedContext().firestore() as unknown as Firestore));

    const [transactionDoc] = (await withAdmin(async db => (await getDocs(collection(db, 'transactions'))).docs.map(item => item.id)));
    await assertFails(updateDoc(doc(authedDb(operatorA), `transactions/${transactionDoc}`), { note: 'tampered' }));

    await withAdmin(async db => {
      await setDoc(doc(db, 'system/accessLease'), {
        holderUid: operatorA.uid, epoch: 1, updatedAt: Timestamp.fromMillis(Date.now() - 6 * 60 * 1000),
      });
    });
    await assertFails(todayQuery(authedDb(operatorA)));
    await expect(repository(operatorA).loadSnapshot()).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  it('P08.R2: L01 order part, other-meal classification and zero-receipt debt reload from the server consistently', async () => {
    const repo = repository(operatorA);
    expect((await repo.createOrder(await orderInput(studentA))).ok).toBe(true);
    expect((await repo.createOrder(await orderInput(studentB, { mealKind: 'other', paidAmount: 0 }))).ok).toBe(true);
    expect((await repo.createOrder(await orderInput(studentB, { mealKind: 'other', mealPrice: 50, paidAmount: 100 }))).ok).toBe(true);

    // A fresh repository instance stands in for a page reload: all values come from Firestore, not memory.
    const snapshot = await repository(operatorA).loadSnapshot();
    expect(snapshot.today).toBe(today);
    expect(snapshot.seq).toBe(3);
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(10);
    expect(snapshot.students.find(item => item.studentId === studentB)?.currentBalance).toBe(-20);
    expect(snapshot.day?.totals).toEqual({
      activeTransactionCount: 3, bentoCount: 1, otherMealCount: 2, mealTotal: 210,
      retainedReceipts: 100, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
    });
    expect(snapshot.transactions.map(tx => [tx.mealKind, tx.mealPrice, tx.paidAmount, tx.createdSeq])).toEqual([
      ['bento', 90, 0, 1], ['other', 70, 0, 2], ['other', 50, 100, 3],
    ]);
    expect(snapshot.transactions[0].menuNameSnapshot).toBe('Synthetic Meal');
    expect(snapshot.transactions[1].otherItemName).toBe('Synthetic Noodles');
  });

  it('P08.R3: L08 ten sequential and ten concurrent retries of one command, plus a reload replay, create one transaction', async () => {
    const input = await orderInput(studentA, { paidAmount: 100 });
    const first = await repository(operatorA).createOrder(input);
    expect(first.ok).toBe(true);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const retry = await repository(operatorA).createOrder(input);
      expect(retry).toEqual(first);
    }
    const concurrent = await Promise.all(Array.from({ length: 10 }, () => repository(operatorA).createOrder(input)));
    for (const retry of concurrent) expect(retry).toEqual(first);
    const receipt = await repository(operatorA).readCommand(input.commandId);
    expect(receipt?.seq).toBe(1);

    expect(await countTransactions()).toBe(1);
    expect(await headSeq()).toBe(1);
    const snapshot = await repository(operatorA).loadSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(110);
    expect(snapshot.day?.totals.retainedReceipts).toBe(100);
  });

  it('P08.R4: a same-ID retry with a different transactionId is refused instead of creating a second row', async () => {
    const input = await orderInput(studentA);
    expect((await repository(operatorA).createOrder(input)).ok).toBe(true);
    const changed = await repository(operatorA).createOrder({ ...input, transactionId: uuid() });
    expect(changed).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await countTransactions()).toBe(1);
  });

  it('P08.R5: a menu revision change between reading and ordering is a REVISION_CONFLICT; the re-read snapshot succeeds', async () => {
    const stale = await orderInput(studentA);
    await withAdmin(async db => {
      await updateDoc(doc(db, `days/${today}`), { menu: menu(95, 2), revision: 2 });
    });
    const rejected = await repository(operatorA).createOrder(stale);
    expect(rejected).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await countTransactions()).toBe(0);

    const fresh = await orderInput(studentA);
    expect(fresh).toMatchObject({ mealPrice: 95, menuRevision: 2, expectedDayRevision: 2 });
    expect((await repository(operatorA).createOrder(fresh)).ok).toBe(true);
    const snapshot = await repository(operatorA).loadSnapshot();
    expect(snapshot.transactions.map(tx => tx.menuPriceSnapshot)).toEqual([95]);
  });

  it('P08.R6: inactive students cannot order and nothing is written', async () => {
    await withAdmin(async db => {
      await updateDoc(doc(db, `students/${studentB}`), { status: 'inactive' });
    });
    const result = await repository(operatorA).createOrder(await orderInput(studentB, { mealKind: 'other' }));
    expect(result.ok).toBe(false);
    expect(await countTransactions()).toBe(0);
    expect(await headSeq()).toBe(0);
  });

  it('P08.R7: paged reads return every transaction in (createdAt, transactionId) order', async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await repository(operatorA).createOrder(await orderInput(index % 2 ? studentB : studentA))).ok).toBe(true);
    }
    const snapshot = await repository(operatorA, 2).loadSnapshot();
    expect(snapshot.transactions.map(tx => tx.createdSeq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('P08.R8: day totals that disagree with the transactions fail closed instead of showing counts', async () => {
    expect((await repository(operatorA).createOrder(await orderInput(studentA))).ok).toBe(true);
    await withAdmin(async db => {
      await updateDoc(doc(db, `days/${today}`), { 'totals.bentoCount': 2 });
    });
    await expect(repository(operatorA).loadSnapshot()).rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
  });

  it('P08.R9: a transaction row outside the strict schema fails closed', async () => {
    expect((await repository(operatorA).createOrder(await orderInput(studentA))).ok).toBe(true);
    await withAdmin(async db => {
      const [row] = (await getDocs(collection(db, 'transactions'))).docs;
      await updateDoc(row.ref, { menuNameSnapshot: '' });
    });
    await expect(repository(operatorA).loadSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  it('P08.R10: an empty day before any order loads with zero counts and no transactions', async () => {
    const snapshot = await repository(operatorA).loadSnapshot();
    expect(snapshot.transactions).toEqual([]);
    expect(snapshot.day?.totals.bentoCount).toBe(0);
    expect(snapshot.students).toHaveLength(2);
  });
});
