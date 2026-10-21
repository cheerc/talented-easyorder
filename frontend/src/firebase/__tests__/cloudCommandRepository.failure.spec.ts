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
import { createCloudReportActionRepository } from '../cloudReportActionRepository';
import { SAFE_DIAGNOSTICS_STORAGE_KEY } from '../../errors/errorLogger';

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

function reportActions(operator: typeof operatorA) {
  return createCloudReportActionRepository(dbFor(operator), { currentUser: () => fakeCurrentUser(operator) });
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
    localStorage.clear();
    firestoreMock.serverRead.mockClear();
    firestoreMock.runTransaction.mockImplementation(firestoreMock.realRunTransaction);
    firestoreMock.runTransaction.mockClear();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('P13b1 logs one safe final diagnostic for a rejected command input', async () => {
    const commandId = 'f1111111-1111-4111-8111-111111111111';
    const marker = 'P13B1-COMMAND-PII-王小明-amount-87654321';
    const result = await repository(operatorA).commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { studentId: marker, dayId: marker, transactionId: marker },
      expectedRevisions: { student: 1, day: 1, transaction: 0 },
      payload: { message: marker, nested: { payload: marker } },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const raw = localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!);
    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]).toMatchObject({
      type: 'command-failure', commandId, kind: 'CreateOrder', errorCode: 'INVALID_INPUT',
      occurredAt: expect.any(String),
    });
    expect(raw).not.toContain(marker);
    expect(raw).not.toContain('王小明');
    expect(raw).not.toContain('87654321');
    expect(Object.keys(envelope.entries[0]).sort()).toEqual(['commandId', 'errorCode', 'kind', 'occurredAt', 'type']);
  });

  it('P13b1 does not read a mutating commandId accessor before normalization', async () => {
    let reads = 0;
    const commandId = 'f5555555-5555-4555-8555-555555555555';
    const input = {
      get commandId() {
        reads += 1;
        if (reads > 2) throw new Error('extra commandId access marker');
        return commandId;
      },
      kind: 'CreateOrder',
      leaseEpoch: -1,
      targets: {},
      expectedRevisions: {},
      payload: {},
    };

    const result = await repository(operatorA).commitCommand(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(reads).toBe(2);
  });

  it('P13b1 does not read a mutating command kind accessor before normalization', async () => {
    let reads = 0;
    const input = {
      commandId: 'f6666666-6666-4666-8666-666666666666',
      get kind() {
        reads += 1;
        if (reads > 3) throw new Error('extra kind access marker');
        return 'CreateOrder';
      },
      leaseEpoch: -1,
      targets: {},
      expectedRevisions: {},
      payload: {},
    };

    const result = await repository(operatorA).commitCommand(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(reads).toBe(3);
  });

  it('P13b1 contains a throwing prototype proxy trap inside the existing validation result boundary', async () => {
    let prototypeReads = 0;
    const input = new Proxy({}, {
      getPrototypeOf() {
        prototypeReads += 1;
        throw new Error('prototype trap marker');
      },
    });

    const result = await repository(operatorA).commitCommand(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_SCHEMA' } });
    expect(prototypeReads).toBe(1);
  });

  it('P13b1 records one diagnostic after five transaction callback attempts', async () => {
    await seedBase();
    const commandId = 'f2222222-2222-4222-8222-222222222222';
    const transactionId = 'f3333333-3333-4333-8333-333333333333';
    const input = {
      commandId, kind: 'CreateOrder' as const, leaseEpoch: 1,
      targets: { transactionId, studentId, dayId: today },
      expectedRevisions: { transaction: 0 as const, student: 1, day: 1 },
      payload: { mealPrice: 100, paidAmount: 100, mealKind: 'bento' as const, menuRevision: 1 },
    };
    let callbackAttempts = 0;
    const fakeTransaction = {
      get: (reference: unknown) => firestoreMock.realServerRead(reference as Parameters<ServerRead>[0]),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    firestoreMock.runTransaction.mockImplementationOnce(async (_db, updateFunction, options) => {
      expect(options).toEqual({ maxAttempts: 5 });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        callbackAttempts += 1;
        await updateFunction(fakeTransaction as never);
      }
      throw Object.assign(new Error('synthetic exhausted transaction retries'), { code: 'unavailable' });
    });

    const result = await repository(operatorA).commitCommand(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_RESULT' } });
    expect(callbackAttempts).toBe(5);
    expect(firestoreMock.runTransaction).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)!);
    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]).toMatchObject({ commandId, kind: 'CreateOrder', errorCode: 'UNKNOWN_RESULT' });
  });

  it('P13b1 records the canonical command identity after a committed command loses receipt readback', async () => {
    await seedBase();
    const observedId = 'a1111111-1111-4111-8111-111111111111';
    const canonicalId = 'b2222222-2222-4222-8222-222222222222';
    const transactionId = 'b3333333-3333-4333-8333-333333333333';
    let commandIdReads = 0;
    const input = {
      get commandId() {
        commandIdReads += 1;
        return commandIdReads <= 2 ? observedId : canonicalId;
      },
      kind: 'CreateOrder' as const,
      leaseEpoch: 1,
      targets: { transactionId, studentId, dayId: today },
      expectedRevisions: { transaction: 0 as const, student: 1, day: 1 },
      payload: { mealPrice: 100, paidAmount: 110, mealKind: 'bento' as const, menuRevision: 1 },
    };
    let receiptReadPath: string | undefined;
    firestoreMock.serverRead.mockImplementationOnce(async reference => {
      receiptReadPath = (reference as { path?: string }).path;
      throw Object.assign(new Error('synthetic post-commit receipt readback loss'), { code: 'unavailable' });
    });

    const result = await repository(operatorA).commitCommand(input);

    expect(result).toMatchObject({ ok: false, error: { code: 'UNKNOWN_RESULT' } });
    expect(commandIdReads).toBe(3);
    expect(receiptReadPath).toBe(`commands/${canonicalId}`);
    const committed = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `commands/${observedId}`)),
      getDoc(doc(db, `commands/${canonicalId}`)),
      getDoc(doc(db, `transactions/${transactionId}`)),
    ]));
    expect(committed[0].data()).toMatchObject({ seq: 1, lastCommandId: canonicalId });
    expect(committed[1].exists()).toBe(false);
    expect(committed[2].data()).toMatchObject({ commandId: canonicalId, kind: 'CreateOrder', seq: 1 });
    expect(committed[3].data()).toMatchObject({ transactionId, lastCommandId: canonicalId });
    const envelope = JSON.parse(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)!);
    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]).toMatchObject({
      commandId: canonicalId, kind: 'CreateOrder', errorCode: 'UNKNOWN_RESULT',
    });
  });

  it('P13b1 diagnostic storage failure does not change the command outcome, and reads do not log', async () => {
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage marker'); });
    const commandId = 'f4444444-4444-4444-8444-444444444444';
    const result = await repository(operatorA).commitCommand({ commandId, kind: 'CreateOrder' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const diagnosticWriteCount = setItem.mock.calls.length;
    expect(diagnosticWriteCount).toBeGreaterThan(0);
    await expect(repository(operatorA).readCommand('not-a-uuid')).rejects.toThrow('commandId 必須是 UUID');
    expect(setItem).toHaveBeenCalledTimes(diagnosticWriteCount);
  });

  it('P13b2 RED: denied localStorage access prevents the real command transaction', async () => {
    await seedBase();
    const commandId = 'f8888888-8888-4888-8888-888888888888';
    const transactionId = 'f9999999-9999-4999-8999-999999999999';
    const input = {
      commandId, kind: 'CreateOrder' as const, leaseEpoch: 1,
      targets: { transactionId, studentId, dayId: today },
      expectedRevisions: { transaction: 0 as const, student: 1, day: 1 },
      payload: { mealPrice: 100, paidAmount: 110, mealKind: 'bento' as const, menuRevision: 1 },
    };
    const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('synthetic localStorage property denial'); },
    });
    let result: Awaited<ReturnType<ReturnType<typeof repository>['commitCommand']>>;
    try {
      result = await repository(operatorA).commitCommand(input);
    } finally {
      if (storageDescriptor) Object.defineProperty(window, 'localStorage', storageDescriptor);
    }

    expect(result!).toMatchObject({ ok: false, error: { code: 'LOCAL_STORAGE_UNAVAILABLE' } });
    expect(firestoreMock.runTransaction).not.toHaveBeenCalled();
    const committed = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `commands/${commandId}`)),
      getDoc(doc(db, `transactions/${transactionId}`)),
    ]));
    expect(committed[0].data()).toMatchObject({ seq: 0 });
    expect(committed[1].exists()).toBe(false);
    expect(committed[2].exists()).toBe(false);
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

  it('P12b.5: report action UNKNOWN_RESULT recovers its receipt by ID and rejects changed intent', async () => {
    await seedBase();
    const commandId = 'e8888888-8888-4888-8888-888888888888';
    const input = {
      commandId, leaseEpoch: 1, exportType: 'transactions-original' as const,
      range: { kind: 'custom' as const, startDate: today, endDate: today },
      scope: { studentId: null }, sourceSeq: 0,
    };
    firestoreMock.serverRead.mockImplementationOnce(async () => {
      throw Object.assign(new Error('synthetic post-commit report receipt read outage'), { code: 'unavailable' });
    });

    const actions = reportActions(operatorA);
    const first = await actions.recordExport(input);
    expect(first).toMatchObject({ ok: false, error: { code: 'UNKNOWN_RESULT' } });
    const committed = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `commands/${commandId}`)),
    ]));
    expect(committed[0].data()).toMatchObject({ seq: 1, lastCommandId: commandId });
    expect(committed[1].data()).toMatchObject({ commandId, kind: 'RecordExport', seq: 1 });

    const retry = await actions.recordExport(input);
    expect(retry).toMatchObject({ ok: true, receipt: { commandId, kind: 'RecordExport', seq: 1 } });
    const changedInputs = [
      { ...input, range: { kind: 'custom' as const, startDate: '2026-10-18', endDate: today } },
      { ...input, sourceSeq: 1 },
      { ...input, scope: { studentId } },
    ];
    for (const changed of changedInputs) {
      expect(await actions.recordExport(changed)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    const headAfterRetries = await withAdmin(db => getDoc(doc(db, 'system/dataHead')));
    expect(headAfterRetries.data()).toMatchObject({ seq: 1, lastCommandId: commandId });
  });

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
