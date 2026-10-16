// @ts-expect-error This node-only test utility is intentionally outside the browser type surface.
import { readFileSync } from 'node:fs';
// @ts-expect-error This node-only test utility is intentionally outside the browser type surface.
import path from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { createCloudCommandRepository } from '../cloudCommandRepository';

type ServerRead = typeof import('firebase/firestore').getDocFromServer;
type RunTransaction = typeof import('firebase/firestore').runTransaction;
const firestoreMock = vi.hoisted(() => ({
  serverRead: vi.fn(),
  realServerRead: undefined as unknown as ServerRead,
  runTransaction: vi.fn(),
  realRunTransaction: undefined as unknown as RunTransaction,
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  firestoreMock.realServerRead = actual.getDocFromServer;
  firestoreMock.serverRead.mockImplementation(actual.getDocFromServer);
  firestoreMock.realRunTransaction = actual.runTransaction;
  firestoreMock.runTransaction.mockImplementation(actual.runTransaction);
  return {
    ...actual,
    getDocFromServer: firestoreMock.serverRead,
    runTransaction: firestoreMock.runTransaction,
  };
});

declare const process: { env: Record<string, string | undefined>; cwd: () => string };
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_COMMANDS === 'true';
if (required && !emulatorHost) throw new Error('P05 command Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const operatorA = { uid: 'p05-failure-a', email: 'p05-failure-a@example.test', displayName: 'Synthetic A', active: true };
const operatorB = { uid: 'p05-failure-b', email: 'p05-failure-b@example.test', displayName: 'Synthetic B', active: true };
const studentId = '22222222-2222-4222-8222-222222222222';
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

function dbFor(operator: typeof operatorA) {
  return env.authenticatedContext(operator.uid, {
    email: operator.email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

function repository(operator: typeof operatorA) {
  return createCloudCommandRepository(dbFor(operator), { currentUser: () => fakeCurrentUser(operator) });
}

async function seedBase() {
  await withAdmin(async db => {
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
      schemaVersion: 1, datasetId: 'p05-failure-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: today, updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `students/${studentId}`), {
      studentId, studentCode: '001', displayName: 'Synthetic Student', aliases: [], status: 'active',
      openingBalance: { amount: 0, asOfDate: today, note: '', createdAt: serverTimestamp() },
      currentBalance: 0, createdAt: serverTimestamp(), revision: 1,
      lastCommandId: 'p05-failure-seed-student', updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'studentCodes/001'), {
      studentId, lastCommandId: 'p05-failure-seed-student', updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `days/${today}`), {
      status: 'open', revision: 1,
      menu: {
        businessDate: today, itemName: 'Synthetic Bento', price: 100, vendorId: 'p05-vendor',
        vendorNameSnapshot: 'Synthetic Vendor', updatedAt: serverTimestamp(), revision: 1, inheritedFromDate: null,
      },
      openingCash: 1000, openedBy: operatorA.uid, openedAt: serverTimestamp(),
      totals: {
        activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
        retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
      },
      lastSettlementRevision: 0, lastCommandId: 'p05-failure-seed-day', updatedAt: serverTimestamp(),
    });
  });
}

function permissionDenied() {
  return Object.assign(new Error('synthetic Firestore Rules denial before any write'), { code: 'permission-denied' });
}

describeWithEmulator('P05 post-commit receipt read failures', () => {
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
    firestoreMock.serverRead.mockClear();
    firestoreMock.runTransaction.mockImplementation(firestoreMock.realRunTransaction);
    firestoreMock.runTransaction.mockClear();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it.each(['unavailable', 'permission-denied'] as const)(
    'P05.28: %s after a real commit is UNKNOWN_RESULT and same-ID retry recovers its receipt',
    async failure => {
      await seedBase();
      const transactionId = `p05-failure-${failure}`;
      const commandId = failure === 'unavailable'
        ? 'e6666666-6666-4666-8666-666666666666'
        : 'e7777777-7777-4777-8777-777777777777';
      const input = {
        commandId,
        kind: 'CreateOrder' as const,
        leaseEpoch: 1,
        targets: { transactionId, studentId, dayId: today },
        expectedRevisions: { transaction: 0 as const, student: 1, day: 1 },
        payload: { mealPrice: 100, paidAmount: 110, mealKind: 'bento' as const, menuRevision: 1 },
      };

      firestoreMock.serverRead.mockImplementationOnce(async reference => {
        if (failure === 'unavailable') {
          throw Object.assign(new Error('synthetic post-commit receipt read outage'), { code: 'unavailable' });
        }
        await withAdmin(async db => updateDoc(doc(db, 'system/accessLease'), {
          holderUid: operatorB.uid, epoch: 2, updatedAt: serverTimestamp(),
        }));
        try {
          return await firestoreMock.realServerRead(reference as Parameters<ServerRead>[0]);
        } catch (error) {
          expect(error).toMatchObject({ code: 'permission-denied' });
          throw error;
        }
      });

      const first = await repository(operatorA).commitCommand(input);
      expect(first).toMatchObject({ ok: false, error: { code: 'UNKNOWN_RESULT' } });
      expect(firestoreMock.serverRead).toHaveBeenCalledTimes(1);

      const committed = await withAdmin(async db => {
        const [head, student, day, transaction, receipt, lease] = await Promise.all([
          getDoc(doc(db, 'system/dataHead')),
          getDoc(doc(db, `students/${studentId}`)),
          getDoc(doc(db, `days/${today}`)),
          getDoc(doc(db, `transactions/${transactionId}`)),
          getDoc(doc(db, `commands/${commandId}`)),
          getDoc(doc(db, 'system/accessLease')),
        ]);
        return {
          head: head.data(), student: student.data(), day: day.data(),
          transaction: transaction.data(), receipt: receipt.data(), lease: lease.data(),
        };
      });
      expect(committed.head).toMatchObject({ seq: 1, lastCommandId: commandId });
      expect(committed.student).toMatchObject({ currentBalance: 10, revision: 2, lastCommandId: commandId });
      expect(committed.day).toMatchObject({ revision: 2, lastCommandId: commandId });
      expect(committed.transaction).toMatchObject({ transactionId, createdSeq: 1, lastCommandId: commandId });
      expect(committed.receipt).toMatchObject({ commandId, seq: 1, kind: 'CreateOrder', leaseEpoch: 1 });
      expect(committed.lease?.epoch).toBe(failure === 'permission-denied' ? 2 : 1);

      const retryInput = { ...input, leaseEpoch: failure === 'permission-denied' ? 2 : 1 };
      const retryOperator = failure === 'permission-denied' ? operatorB : operatorA;
      const retry = await repository(retryOperator).commitCommand(retryInput);
      expect(retry).toMatchObject({ ok: true, receipt: { commandId, seq: 1 } });
      const finalHead = await withAdmin(db => getDoc(doc(db, 'system/dataHead')));
      expect(finalHead.data()?.seq).toBe(1);
    },
  );

  it('P07.22: current-holder server diagnosis classifies all four P07 kinds after a denied write', async () => {
    await seedBase();
    await withAdmin(async db => {
      await setDoc(doc(db, 'vendors/p07-diagnosis-vendor'), {
        vendorId: 'p07-diagnosis-vendor', name: 'Synthetic Vendor', phone: '', note: '',
        status: 'inactive', deleted: false, createdAt: serverTimestamp(), revision: 1,
        lastCommandId: 'e8999999-9999-4999-8999-999999999999', updatedAt: serverTimestamp(),
      });
    });

    const cases = [
      {
        commandId: 'e8111111-1111-4111-8111-111111111111',
        kind: 'SaveVendor' as const,
        leaseEpoch: 1,
        targets: { vendorId: 'p07-diagnosis-vendor' },
        expectedRevisions: { vendor: 1 },
        payload: {
          vendorId: 'p07-diagnosis-vendor', name: 'Synthetic Vendor',
          phone: '', note: '', status: 'inactive' as const,
        },
      },
      {
        commandId: 'e8222222-2222-4222-8222-222222222222',
        kind: 'RemoveVendor' as const,
        leaseEpoch: 1,
        targets: { vendorId: 'p07-diagnosis-vendor' },
        expectedRevisions: { vendor: 1 },
        payload: { reason: 'Synthetic retirement' },
      },
      {
        commandId: 'e8333333-3333-4333-8333-333333333333',
        kind: 'SetDayMenu' as const,
        leaseEpoch: 1,
        targets: { dayId: today },
        expectedRevisions: { day: 1, headSeq: 0 },
        payload: {
          selectionDate: today, itemName: 'Synthetic Menu', price: 125,
          vendorId: 'p05-vendor', vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null,
        },
      },
      {
        commandId: 'e8444444-4444-4444-8444-444444444444',
        kind: 'SetOpeningCash' as const,
        leaseEpoch: 1,
        targets: { dayId: today },
        expectedRevisions: { day: 1 },
        payload: { openingCash: 125 },
      },
    ];

    for (const input of cases) {
      firestoreMock.runTransaction.mockRejectedValueOnce(permissionDenied());
      const result = await repository(operatorA).commitCommand(input);
      expect(result, input.kind).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(firestoreMock.runTransaction).toHaveBeenCalledTimes(4);
  });

  it('P07.23: current-holder head and day revision diagnoses return REVISION_CONFLICT', async () => {
    await seedBase();
    const repo = repository(operatorA);

    firestoreMock.runTransaction.mockRejectedValueOnce(permissionDenied());
    const staleHead = await repo.commitCommand({
      commandId: 'e8555555-5555-4555-8555-555555555555',
      kind: 'SetDayMenu', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: 1, headSeq: 1 },
      payload: {
        selectionDate: today, itemName: 'Synthetic Menu', price: 125,
        vendorId: 'p05-vendor', vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null,
      },
    });
    expect(staleHead).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });

    await withAdmin(db => updateDoc(doc(db, `days/${today}`), { revision: 2 }));
    firestoreMock.runTransaction.mockRejectedValueOnce(permissionDenied());
    const staleDay = await repo.commitCommand({
      commandId: 'e8666666-6666-4666-8666-666666666666',
      kind: 'SetOpeningCash', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: 1 }, payload: { openingCash: 125 },
    });
    expect(staleDay).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('P07.24: a current-holder server diagnosis classifies a closed business day as DAY_CLOSED', async () => {
    await seedBase();
    await withAdmin(db => updateDoc(doc(db, `days/${today}`), { status: 'closed' }));
    firestoreMock.runTransaction.mockRejectedValueOnce(permissionDenied());

    const result = await repository(operatorA).commitCommand({
      commandId: 'e8777777-7777-4777-8777-777777777777',
      kind: 'SetOpeningCash', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: 1 }, payload: { openingCash: 125 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
  });

  it('P07.25: denied diagnosis reads from a nonholder remain LEASE_LOST', async () => {
    await seedBase();
    firestoreMock.runTransaction.mockRejectedValueOnce(permissionDenied());

    const result = await repository(operatorB).commitCommand({
      commandId: 'e8888888-8888-4888-8888-888888888888',
      kind: 'SetOpeningCash', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: 1 }, payload: { openingCash: 125 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'LEASE_LOST' } });
  });
});
