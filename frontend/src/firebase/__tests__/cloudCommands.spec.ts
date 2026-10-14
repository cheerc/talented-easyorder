// @ts-expect-error This node-only test utility is intentionally outside the browser type surface.
import { readFileSync } from 'node:fs';
// @ts-expect-error This node-only test utility is intentionally outside the browser type surface.
import path from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { ALL_COMMAND_KINDS } from '../../domain/cloudCommands';
import { createCloudCommandRepository } from '../cloudCommandRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_COMMANDS === 'true';
if (required && !emulatorHost) throw new Error('P05 command Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), '../firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function shiftDate(date: string, offset: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

const operatorA = { uid: 'p05-operator-a', email: 'p05-a@example.test', displayName: 'Synthetic A', active: true };
const operatorB = { uid: 'p05-operator-b', email: 'p05-b@example.test', displayName: 'Synthetic B', active: true };
const studentId = 'p05-student-001';
const dayId = today;
const menu = {
  businessDate: dayId,
  itemName: 'Synthetic Bento',
  price: 100,
  vendorId: 'p05-vendor',
  vendorNameSnapshot: 'Synthetic Vendor',
  updatedAt: new Date('2026-10-13T00:00:00.000Z'),
  revision: 1,
  inheritedFromDate: null,
};

let env: RulesTestEnvironment;

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

function authedDb(operator: typeof operatorA) {
  return env.authenticatedContext(operator.uid, {
    email: operator.email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

function repository(operator: typeof operatorA) {
  return createCloudCommandRepository(authedDb(operator), { currentUser: () => fakeCurrentUser(operator) });
}

async function seedBase(options: { maintenance?: boolean; withBusinessDocs?: boolean } = {}) {
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
      datasetId: 'p05-synthetic-dataset',
      seq: 0,
      lastCommandId: null,
      maintenance: options.maintenance ?? false,
      goLiveDate: today,
      updatedAt: serverTimestamp(),
    });
    if (options.withBusinessDocs) {
      await setDoc(doc(db, `students/${studentId}`), {
        studentId,
        displayName: 'Synthetic Student',
        aliases: [],
        status: 'active',
        openingBalance: { amount: 0, asOfDate: today, note: '', createdAt: serverTimestamp() },
        currentBalance: 0,
        createdAt: serverTimestamp(),
        revision: 1,
        lastCommandId: 'p05-synthetic-student-seed',
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, `days/${dayId}`), {
        status: 'open',
        revision: 1,
        menu,
        openingCash: 1000,
        openedBy: operatorA.uid,
        openedAt: serverTimestamp(),
        totals: {
          activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0,
          mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0,
        },
        lastSettlementRevision: 0,
        lastCommandId: 'p05-synthetic-day-seed',
        updatedAt: serverTimestamp(),
      });
    }
  });
}

function orderInput(commandId: string, transactionId: string, expectedStudentRevision = 1, expectedDayRevision = 1) {
  return {
    commandId,
    kind: 'CreateOrder' as const,
    leaseEpoch: 1,
    targets: { transactionId, studentId, dayId },
    expectedRevisions: { transaction: 0 as const, student: expectedStudentRevision, day: expectedDayRevision },
    payload: { mealPrice: 100, paidAmount: 110, mealKind: 'bento' as const, menuRevision: 1 },
  };
}

function paymentInput(commandId: string, transactionId: string, paidAmount = 200) {
  return {
    commandId,
    kind: 'CreatePayment' as const,
    leaseEpoch: 1,
    targets: { transactionId, studentId, dayId },
    expectedRevisions: { transaction: 0 as const, student: 1, day: 1 },
    payload: { paidAmount, note: 'Synthetic deposit' },
  };
}

describeWithEmulator('P05 production command repository and Rules', () => {
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
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('P05.1: EnsureDay commits a new typed day and receipt atomically', async () => {
    await seedBase();
    const futureDay = shiftDate(today, 1);
    const commandId = '11111111-1111-4111-8111-111111111111';
    const result = await repository(operatorA).commitCommand({
      commandId,
      kind: 'EnsureDay',
      leaseEpoch: 1,
      targets: { dayId: futureDay },
      expectedRevisions: { day: 0 },
      payload: { businessDate: futureDay },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({ commandId, seq: 1, kind: 'EnsureDay' });
    const stored = await withAdmin(async db => {
      const [head, day, command] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `days/${futureDay}`)),
        getDoc(doc(db, `commands/${commandId}`)),
      ]);
      return { head: head.data(), day: day.data(), command: command.data() };
    });
    expect(stored.head).toMatchObject({ seq: 1, lastCommandId: commandId, maintenance: false });
    expect(stored.day).toMatchObject({ status: 'open', revision: 1, menu: null, openingCash: null, lastCommandId: commandId });
    expect(stored.command).toMatchObject({ kind: 'EnsureDay', seq: 1, actor: { uid: operatorA.uid }, leaseEpoch: 1 });
    expect((await repository(operatorA).readCommand(commandId))?.seq).toBe(1);
  });

  it('P05.2: CreateOrder creates receipt, transaction, student and day as one commit', async () => {
    await seedBase({ withBusinessDocs: true });
    const commandId = '22222222-2222-4222-8222-222222222222';
    const result = await repository(operatorA).commitCommand(orderInput(commandId, 'p05-order-001'));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.receipt).toMatchObject({ commandId, seq: 1, kind: 'CreateOrder' });
    const state = await withAdmin(async db => {
      const [head, student, day, tx, command] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, 'transactions/p05-order-001')),
        getDoc(doc(db, `commands/${commandId}`)),
      ]);
      return { head: head.data(), student: student.data(), day: day.data(), tx: tx.data(), command: command.data() };
    });
    expect(state.head).toMatchObject({ seq: 1, lastCommandId: commandId });
    expect(state.student).toMatchObject({ currentBalance: 10, revision: 2, lastCommandId: commandId });
    expect(state.day).toMatchObject({ revision: 2, totals: { activeTransactionCount: 1, bentoCount: 1, mealTotal: 100, retainedReceipts: 110 } });
    expect(state.tx).toMatchObject({ transactionId: 'p05-order-001', type: 'order', amount: 10, createdSeq: 1, otherItemName: null });
    expect(state.command).toMatchObject({ kind: 'CreateOrder', targets: { transactionId: 'p05-order-001', studentId, dayId }, before: { transaction: null } });
  });

  it('P05.3: CreatePayment commits a student payment and day cash receipt atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const commandId = '33333333-3333-4333-8333-333333333333';
    const result = await repository(operatorA).commitCommand(paymentInput(commandId, 'p05-payment-001'));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const state = await withAdmin(async db => {
      const [head, student, day, tx] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, 'transactions/p05-payment-001')),
      ]);
      return { head: head.data(), student: student.data(), day: day.data(), tx: tx.data() };
    });
    expect(state.head).toMatchObject({ seq: 1, lastCommandId: commandId });
    expect(state.student).toMatchObject({ currentBalance: 200, revision: 2 });
    expect(state.day).toMatchObject({ revision: 2, totals: { activeTransactionCount: 1, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 200 } });
    expect(state.tx).toMatchObject({ type: 'payment', mealPrice: 0, paidAmount: 200, amount: 200, mealKind: null });
  });

  it('P05.4: same command ID and semantic input returns the stored receipt without a second seq', async () => {
    await seedBase({ withBusinessDocs: true });
    const input = orderInput('44444444-4444-4444-8444-444444444444', 'p05-order-replay');
    const repo = repository(operatorA);
    const first = await repo.commitCommand(input);
    const replay = await repo.commitCommand(input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(replay).toEqual(first);
    const head = await withAdmin(db => getDoc(doc(db, 'system/dataHead')));
    expect(head.data()?.seq).toBe(1);
  });

  it('P05.5: same ID with different payload is rejected and leaves every projection unchanged', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const original = orderInput('55555555-5555-4555-8555-555555555555', 'p05-order-collision');
    const first = await repo.commitCommand(original);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const altered = { ...original, payload: { ...original.payload, paidAmount: 210 } };
    const rejected = await repo.commitCommand(altered);
    expect(rejected).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const state = await withAdmin(async db => {
      const [head, student, day, tx] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, 'transactions/p05-order-collision')),
      ]);
      return { head: head.data(), student: student.data(), day: day.data(), tx: tx.data() };
    });
    expect(state.head?.seq).toBe(1);
    expect(state.student?.currentBalance).toBe(10);
    expect(state.day?.revision).toBe(2);
    expect(state.tx?.paidAmount).toBe(110);
  });

  it('P05.6: an active new holder can read a receipt from a prior actor and lease epoch', async () => {
    await seedBase({ withBusinessDocs: true });
    const commandId = '66666666-6666-4666-8666-666666666666';
    const result = await repository(operatorA).commitCommand(orderInput(commandId, 'p05-order-history'));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    await withAdmin(async db => {
      await updateDoc(doc(db, 'system/accessLease'), {
        holderUid: operatorB.uid, epoch: 2, updatedAt: serverTimestamp(),
      });
    });
    const history = await repository(operatorB).readCommand(commandId);
    expect(history).toMatchObject({ commandId, seq: 1, kind: 'CreateOrder' });
  });

  it('P05.7: EnsureDay with a new ID never resets an existing day', async () => {
    await seedBase({ withBusinessDocs: true });
    const result = await repository(operatorA).commitCommand({
      commandId: '77777777-7777-4777-8777-777777777777',
      kind: 'EnsureDay', leaseEpoch: 1,
      targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const [head, day] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${dayId}`)),
    ]));
    expect(head.data()?.seq).toBe(0);
    expect(day.data()).toMatchObject({ revision: 1, status: 'open', openingCash: 1000, lastCommandId: 'p05-synthetic-day-seed' });
  });

  it('P05.8: stale revisions stop a second command without replacing the first projection', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const first = await repo.commitCommand(orderInput('88888888-8888-4888-8888-888888888888', 'p05-order-revision-a'));
    expect(first.ok, JSON.stringify(first)).toBe(true);
    const stale = await repo.commitCommand(orderInput('99999999-9999-4999-8999-999999999999', 'p05-order-revision-b'));
    expect(stale).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    const head = await withAdmin(db => getDoc(doc(db, 'system/dataHead')));
    expect(head.data()?.seq).toBe(1);
  });

  it('P05.9: direct old writers, disabled kinds and forged dataHead writes are denied atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const db = authedDb(operatorA);
    const before = await withAdmin(async admin => {
      const [head, student, day] = await Promise.all([
        getDoc(doc(admin, 'system/dataHead')),
        getDoc(doc(admin, `students/${studentId}`)),
        getDoc(doc(admin, `days/${dayId}`)),
      ]);
      return { head: head.data(), student: student.data(), day: day.data() };
    });
    await assertFails(updateDoc(doc(db, `students/${studentId}`), { currentBalance: 500 }));
    await assertFails(updateDoc(doc(db, 'system/dataHead'), { seq: 9, lastCommandId: 'forged' }));
    await assertFails(setDoc(doc(db, 'commands/p05-disabled-kind'), { commandId: 'p05-disabled-kind', kind: 'CreateStudent' }));
    await assertFails(setDoc(doc(db, 'daily_settlements/2026-10-14/close_attempts/legacy'), { status: 'pending' }));
    await env.withSecurityRulesDisabled(async context => {
      const admin = context.firestore();
      const [head, student, day] = await Promise.all([
        getDoc(doc(admin, 'system/dataHead')),
        getDoc(doc(admin, `students/${studentId}`)),
        getDoc(doc(admin, `days/${dayId}`)),
      ]);
      expect(head.data()).toEqual(before.head);
      expect(student.data()).toEqual(before.student);
      expect(day.data()).toEqual(before.day);
      expect((await getDocs(collection(admin, 'commands'))).size).toBe(0);
    });
  });

  it('P05.10: maintenance blocks commands before any business projection changes', async () => {
    await seedBase({ maintenance: true, withBusinessDocs: true });
    const result = await repository(operatorA).commitCommand(orderInput('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'p05-maintenance'));
    expect(result).toMatchObject({ ok: false, error: { code: 'MAINTENANCE' } });
    const [head, student, day] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `students/${studentId}`)),
      getDoc(doc(db, `days/${dayId}`)),
    ]));
    expect(head.data()?.seq).toBe(0);
    expect(student.data()?.revision).toBe(1);
    expect(day.data()?.revision).toBe(1);
  });

  it('P05.11: only the three enabled kinds pass runtime validation', async () => {
    await seedBase();
    expect(ALL_COMMAND_KINDS).toHaveLength(22);
    const disabled = await repository(operatorA).commitCommand({
      commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'CreateStudent', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 0 }, payload: { displayName: 'Disabled' },
    });
    expect(disabled).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
