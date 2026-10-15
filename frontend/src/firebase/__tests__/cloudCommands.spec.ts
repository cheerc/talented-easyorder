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
  Timestamp,
  collection,
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from 'firebase/auth';
import { ALL_COMMAND_KINDS } from '../../domain/cloudCommands';
import { fingerprintCommandInput, normalizeEnabledCommandInput } from '../../domain/cloudCommandSchema';
import { CloudCommandReadError, createCloudCommandRepository } from '../cloudCommandRepository';
import { listCloudStudents } from '../cloudStudentRepository';

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

function studentInput(
  commandId: string,
  targetStudentId: string,
  amount: number,
  asOfDate = today,
  displayName = 'Synthetic Student',
  aliases: string[] = [],
) {
  return {
    commandId,
    kind: 'CreateStudent' as const,
    leaseEpoch: 1,
    targets: { studentId: targetStudentId },
    expectedRevisions: { student: 0 as const },
    payload: {
      displayName,
      aliases,
      openingBalance: { amount, asOfDate, note: 'Synthetic opening' },
    },
  };
}

type RawOrderArtifacts = {
  commandId: string;
  transactionId: string;
  command: RawMap;
  headAfter: RawMap;
  studentAfter: RawMap;
  dayAfter: RawMap;
  transactionAfter: RawMap;
};

type RawStudentArtifacts = {
  commandId: string;
  studentId: string;
  command: RawMap;
  headAfter: RawMap;
  studentAfter: RawMap;
};

type RawStudentMutationInput = {
  commandId: string;
  kind: 'EditStudent' | 'SetStudentStatus';
  leaseEpoch: number;
  targets: { studentId: string };
  expectedRevisions: { student: number };
  payload: Record<string, unknown>;
};

// Emulator fixtures deliberately mutate nested Firestore maps to model raw SDK clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- map fields vary by command and attack case
type RawMap = Record<string, any>;

async function rawOrderArtifacts(input = orderInput('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'p05-raw-order')): Promise<RawOrderArtifacts> {
  const canonical = normalizeEnabledCommandInput(input);
  const fingerprint = await fingerprintCommandInput(canonical);
  const [headSnapshot, daySnapshot, studentSnapshot] = await withAdmin(async admin => Promise.all([
    getDoc(doc(admin, 'system/dataHead')),
    getDoc(doc(admin, `days/${input.targets.dayId}`)),
    getDoc(doc(admin, `students/${input.targets.studentId}`)),
  ]));
  if (!headSnapshot.exists() || !daySnapshot.exists() || !studentSnapshot.exists()) {
    throw new Error('Raw SDK order fixture requires head, day, and student documents');
  }
  const headBefore = headSnapshot.data() as RawMap;
  const dayBefore = daySnapshot.data() as RawMap;
  const studentBefore = studentSnapshot.data() as RawMap;
  const seq = headBefore.seq + 1;
  const now = serverTimestamp();
  const commandId = input.commandId;
  const transactionId = input.targets.transactionId;
  const payload = canonical.payload as { mealPrice: number; paidAmount: number; mealKind: 'bento' | 'other'; menuRevision: number | null; otherItemName: string | null; note: string };
  const menu = dayBefore.menu as RawMap | null;
  const bento = payload.mealKind === 'bento';
  const mealPrice = payload.mealPrice;
  const headAfter = { ...headBefore, seq, lastCommandId: commandId, updatedAt: now };
  const studentAfter = {
    ...studentBefore,
    currentBalance: studentBefore.currentBalance + payload.paidAmount - mealPrice,
    revision: studentBefore.revision + 1,
    lastCommandId: commandId,
    updatedAt: now,
  };
  const totals = dayBefore.totals as Record<string, number>;
  const dayAfter = {
    ...dayBefore,
    revision: dayBefore.revision + 1,
    totals: {
      ...totals,
      activeTransactionCount: totals.activeTransactionCount + 1,
      bentoCount: totals.bentoCount + (bento ? 1 : 0),
      otherMealCount: totals.otherMealCount + (payload.mealKind === 'other' ? 1 : 0),
      mealTotal: totals.mealTotal + mealPrice,
      retainedReceipts: totals.retainedReceipts + payload.paidAmount,
    },
    lastCommandId: commandId,
    updatedAt: now,
  };
  const transactionAfter = {
    transactionId,
    studentId: input.targets.studentId,
    businessDate: input.targets.dayId,
    type: 'order',
    mealKind: payload.mealKind,
    mealPrice,
    paidAmount: payload.paidAmount,
    amount: payload.paidAmount - mealPrice,
    studentNameSnapshot: studentBefore.displayName,
    menuNameSnapshot: bento ? menu?.itemName : '',
    menuPriceSnapshot: bento ? menu?.price : 0,
    vendorIdSnapshot: bento ? menu?.vendorId : '',
    vendorNameSnapshot: bento ? menu?.vendorNameSnapshot : '',
    otherItemName: payload.otherItemName,
    status: 'active',
    revision: 1,
    createdAt: now,
    createdSeq: seq,
    operatorUid: operatorA.uid,
    operatorEmail: operatorA.email,
    sourceDevice: 'pc',
    note: payload.note,
    lastCommandId: commandId,
    updatedAt: now,
  };
  const command = {
    commandId,
    kind: 'CreateOrder',
    seq,
    leaseEpoch: input.leaseEpoch,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: now,
    businessDate: input.targets.dayId,
    studentId: input.targets.studentId,
    targets: canonical.targets,
    expectedRevisions: canonical.expectedRevisions,
    before: { head: headBefore, student: studentBefore, day: dayBefore, transaction: null },
    after: { head: headAfter, student: studentAfter, day: dayAfter, transaction: transactionAfter },
    reason: null,
    cashEffect: { before: 0, after: payload.paidAmount, delta: payload.paidAmount, reasonKind: 'collection', refundAmount: 0 },
    payload,
    inputFingerprint: fingerprint,
  };
  return { commandId, transactionId, command, headAfter, studentAfter, dayAfter, transactionAfter };
}

async function rawStudentCreateArtifacts(
  input = studentInput('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '001', 0),
  allowExisting = false,
): Promise<RawStudentArtifacts> {
  const canonical = normalizeEnabledCommandInput(input);
  if (canonical.kind !== 'CreateStudent') throw new Error('Expected CreateStudent input');
  const fingerprint = await fingerprintCommandInput(canonical);
  const [headSnapshot, studentSnapshot] = await withAdmin(async admin => Promise.all([
    getDoc(doc(admin, 'system/dataHead')),
    getDoc(doc(admin, `students/${input.targets.studentId}`)),
  ]));
  if (!headSnapshot.exists()) throw new Error('Raw SDK student fixture requires dataHead');
  if (studentSnapshot.exists() && !allowExisting) throw new Error('Raw SDK student fixture requires an unused student ID');
  const headBefore = headSnapshot.data() as RawMap;
  const seq = headBefore.seq + 1;
  const now = serverTimestamp();
  const headAfter = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: now };
  const studentAfter = {
    studentId: input.targets.studentId,
    displayName: canonical.payload.displayName,
    aliases: canonical.payload.aliases,
    status: 'active',
    openingBalance: { ...canonical.payload.openingBalance, createdAt: now },
    currentBalance: canonical.payload.openingBalance.amount,
    createdAt: now,
    revision: 1,
    lastCommandId: input.commandId,
    updatedAt: now,
  };
  const command = {
    commandId: input.commandId,
    kind: 'CreateStudent',
    seq,
    leaseEpoch: input.leaseEpoch,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: now,
    businessDate: null,
    studentId: input.targets.studentId,
    targets: canonical.targets,
    expectedRevisions: canonical.expectedRevisions,
    before: { head: headBefore, student: null },
    after: { head: headAfter, student: studentAfter },
    reason: null,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: canonical.payload,
    inputFingerprint: fingerprint,
  };
  return { commandId: input.commandId, studentId: input.targets.studentId, command, headAfter, studentAfter };
}

async function rawStudentMutationArtifacts(input: RawStudentMutationInput): Promise<RawStudentArtifacts> {
  const canonical = normalizeEnabledCommandInput(input);
  if (canonical.kind !== 'EditStudent' && canonical.kind !== 'SetStudentStatus') {
    throw new Error('Expected EditStudent or SetStudentStatus input');
  }
  const fingerprint = await fingerprintCommandInput(canonical);
  const [headSnapshot, studentSnapshot] = await withAdmin(async admin => Promise.all([
    getDoc(doc(admin, 'system/dataHead')),
    getDoc(doc(admin, `students/${canonical.targets.studentId}`)),
  ]));
  if (!headSnapshot.exists() || !studentSnapshot.exists()) throw new Error('Raw SDK mutation fixture requires dataHead and student');
  const headBefore = headSnapshot.data() as RawMap;
  const studentBefore = studentSnapshot.data() as RawMap;
  const seq = headBefore.seq + 1;
  const now = serverTimestamp();
  const headAfter = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: now };
  const payload = canonical.payload as RawMap;
  const studentAfter = {
    ...studentBefore,
    ...(canonical.kind === 'EditStudent' && payload.displayName === undefined ? {} : canonical.kind === 'EditStudent' ? { displayName: payload.displayName } : {}),
    ...(canonical.kind === 'EditStudent' && payload.aliases === undefined ? {} : canonical.kind === 'EditStudent' ? { aliases: payload.aliases } : {}),
    ...(canonical.kind === 'SetStudentStatus' ? { status: payload.status } : {}),
    revision: studentBefore.revision + 1,
    lastCommandId: input.commandId,
    updatedAt: now,
  };
  const reason = canonical.kind === 'SetStudentStatus' ? (String(payload.reason ?? '') || null) : null;
  const command = {
    commandId: input.commandId,
    kind: canonical.kind,
    seq,
    leaseEpoch: input.leaseEpoch,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: now,
    businessDate: null,
    studentId: canonical.targets.studentId,
    targets: canonical.targets,
    expectedRevisions: canonical.expectedRevisions,
    before: { head: headBefore, student: studentBefore },
    after: { head: headAfter, student: studentAfter },
    reason,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: canonical.payload,
    inputFingerprint: fingerprint,
  };
  return { commandId: input.commandId, studentId: canonical.targets.studentId, command, headAfter, studentAfter };
}

function rawStudentCreateBatch(
  db: Firestore,
  artifacts: RawStudentArtifacts,
  options: { omit?: Array<'head' | 'student'> } = {},
) {
  const omitted = new Set(options.omit ?? []);
  const batch = writeBatch(db);
  if (!omitted.has('head')) batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!omitted.has('student')) batch.set(doc(db, `students/${artifacts.studentId}`), artifacts.studentAfter);
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  return batch;
}

function rawStudentMutationBatch(
  db: Firestore,
  artifacts: RawStudentArtifacts,
  options: { omit?: Array<'head' | 'student'> } = {},
) {
  const omitted = new Set(options.omit ?? []);
  const batch = writeBatch(db);
  if (!omitted.has('head')) batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!omitted.has('student')) batch.update(doc(db, `students/${artifacts.studentId}`), artifacts.studentAfter);
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  return batch;
}

async function expectRawStudentMutationDeniedUnchanged(
  artifacts: RawStudentArtifacts,
  options: Parameters<typeof rawStudentMutationBatch>[2] = {},
) {
  const paths = ['system/dataHead', `students/${artifacts.studentId}`, `commands/${artifacts.commandId}`];
  const before = await capturePaths(paths);
  await assertFails(rawStudentMutationBatch(authedDb(operatorA), artifacts, options).commit());
  expect(await capturePaths(paths)).toEqual(before);
}

async function expectRawStudentCreateDeniedUnchanged(artifacts: RawStudentArtifacts) {
  const paths = ['system/dataHead', `students/${artifacts.studentId}`, `commands/${artifacts.commandId}`];
  const before = await capturePaths(paths);
  await assertFails(rawStudentCreateBatch(authedDb(operatorA), artifacts).commit());
  expect(await capturePaths(paths)).toEqual(before);
}

function rawOrderBatch(
  db: Firestore,
  artifacts: RawOrderArtifacts,
  options: { omit?: Array<'head' | 'student' | 'day' | 'transaction'>; extraTransaction?: boolean; secondCommand?: RawMap } = {},
) {
  const omitted = new Set(options.omit ?? []);
  const batch = writeBatch(db);
  if (!omitted.has('head')) batch.set(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!omitted.has('student')) batch.set(doc(db, `students/${studentId}`), artifacts.studentAfter);
  if (!omitted.has('day')) batch.set(doc(db, `days/${dayId}`), artifacts.dayAfter);
  if (!omitted.has('transaction')) batch.set(doc(db, `transactions/${artifacts.transactionId}`), artifacts.transactionAfter);
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  if (options.extraTransaction) {
    batch.set(doc(db, 'transactions/p05-unlisted-extra'), {
      ...artifacts.transactionAfter,
      transactionId: 'p05-unlisted-extra',
    });
  }
  if (options.secondCommand) {
    batch.set(doc(db, 'commands/dddddddd-dddd-4ddd-8ddd-dddddddddddd'), options.secondCommand);
  }
  return batch;
}

async function capturePaths(paths: string[]): Promise<Record<string, { exists: boolean; data: unknown }>> {
  return withAdmin(async db => {
    const snapshots = await Promise.all(paths.map(relativePath => getDoc(doc(db, relativePath))));
    return Object.fromEntries(paths.map((relativePath, index) => [relativePath, {
      exists: snapshots[index].exists(),
      data: snapshots[index].data() ?? null,
    }]));
  });
}

function rawPaths(artifacts: RawOrderArtifacts, extra: string[] = []): string[] {
  return [
    'system/dataHead',
    `students/${studentId}`,
    `days/${dayId}`,
    `transactions/${artifacts.transactionId}`,
    `commands/${artifacts.commandId}`,
    ...extra,
  ];
}

async function expectRawBatchDeniedUnchanged(
  db: Firestore,
  artifacts: RawOrderArtifacts,
  options: Parameters<typeof rawOrderBatch>[2] = {},
  extraPaths: string[] = [],
) {
  const paths = rawPaths(artifacts, extraPaths);
  const before = await capturePaths(paths);
  await assertFails(rawOrderBatch(db, artifacts, options).commit());
  expect(await capturePaths(paths)).toEqual(before);
}

async function expectMalformedReceiptRejected(
  commandId: string,
  mutate: (receipt: RawMap) => void,
): Promise<void> {
  const result = await repository(operatorA).commitCommand(orderInput(commandId, `receipt-${commandId}`));
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const path = `commands/${commandId}`;
  const original = await withAdmin(async db => {
    const snapshot = await getDoc(doc(db, path));
    if (!snapshot.exists()) throw new Error(`Expected committed receipt ${commandId}`);
    return snapshot.data() as RawMap;
  });
  expect(original.committedAt).toBeInstanceOf(Timestamp);
  expect((original.after as RawMap).head.updatedAt).toBeInstanceOf(Timestamp);
  expect(await repository(operatorA).readCommand(commandId)).toMatchObject({ commandId, kind: 'CreateOrder' });

  // Read a separate SDK snapshot so the saved original and its Timestamp instances remain intact.
  const malformed = await withAdmin(async db => {
    const snapshot = await getDoc(doc(db, path));
    if (!snapshot.exists()) throw new Error(`Expected committed receipt ${commandId}`);
    return snapshot.data() as RawMap;
  });
  mutate(malformed);
  await withAdmin(db => setDoc(doc(db, path), malformed));
  await expect(repository(operatorA).readCommand(commandId)).rejects.toMatchObject({
    name: 'CloudCommandReadError', code: 'UNSUPPORTED_SCHEMA',
  } satisfies Partial<CloudCommandReadError>);

  await withAdmin(db => setDoc(doc(db, path), original));
  expect(await repository(operatorA).readCommand(commandId)).toMatchObject({ commandId, kind: 'CreateOrder' });
}

function replaceRawCommandId(artifacts: RawOrderArtifacts, commandId: string): void {
  artifacts.commandId = commandId;
  artifacts.command.commandId = commandId;
  artifacts.headAfter.lastCommandId = commandId;
  artifacts.studentAfter.lastCommandId = commandId;
  artifacts.dayAfter.lastCommandId = commandId;
  artifacts.transactionAfter.lastCommandId = commandId;
  artifacts.command.after.head = artifacts.headAfter;
  artifacts.command.after.student = artifacts.studentAfter;
  artifacts.command.after.day = artifacts.dayAfter;
  artifacts.command.after.transaction = artifacts.transactionAfter;
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

  it('P05.6: an active new holder can read and replay a receipt from a prior actor and lease epoch', async () => {
    await seedBase({ withBusinessDocs: true });
    const input = orderInput('66666666-6666-4666-8666-666666666666', 'p05-order-history');
    const commandId = input.commandId;
    const result = await repository(operatorA).commitCommand(input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    await withAdmin(async db => {
      await updateDoc(doc(db, 'system/accessLease'), {
        holderUid: operatorB.uid, epoch: 2, updatedAt: serverTimestamp(),
      });
    });
    const history = await repository(operatorB).readCommand(commandId);
    expect(history).toMatchObject({ commandId, seq: 1, kind: 'CreateOrder' });
    const replay = await repository(operatorB).commitCommand({ ...input, leaseEpoch: 2 });
    expect(replay).toEqual(result);
    const head = await withAdmin(db => getDoc(doc(db, 'system/dataHead')));
    expect(head.data()?.seq).toBe(1);
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

  it('P05.24: concurrent commands retain their original expected revisions and only one advances the head', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const [left, right] = await Promise.all([
      repo.commitCommand(orderInput('e4444444-4444-4444-8444-444444444444', 'p05-concurrent-left')),
      repo.commitCommand(orderInput('e5555555-5555-4555-8555-555555555555', 'p05-concurrent-right')),
    ]);
    const results = [left, right];
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toMatchObject([
      { ok: false, error: { code: 'REVISION_CONFLICT' } },
    ]);
    const state = await withAdmin(async db => {
      const [head, student, day, transactions, commands] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'commands')),
      ]);
      return { head: head.data(), student: student.data(), day: day.data(), transactionCount: transactions.size, commandCount: commands.size };
    });
    expect(state).toMatchObject({ head: { seq: 1 }, student: { revision: 2 }, day: { revision: 2 }, transactionCount: 1, commandCount: 1 });
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

  it('P05.12: raw SDK with a complete command closure can commit the same typed contract', async () => {
    await seedBase({ withBusinessDocs: true });
    const db = authedDb(operatorA);
    const artifacts = await rawOrderArtifacts();
    const before = await capturePaths(rawPaths(artifacts));
    await rawOrderBatch(db, artifacts).commit();
    const after = await capturePaths(rawPaths(artifacts));
    expect(after['system/dataHead'].exists).toBe(true);
    expect(after[`commands/${artifacts.commandId}`].exists).toBe(true);
    expect(after['system/dataHead'].data).not.toEqual(before['system/dataHead'].data);
    expect(after[`transactions/${artifacts.transactionId}`].data).toMatchObject({ createdSeq: 1, lastCommandId: artifacts.commandId });
  });

  it.each([
    ['head', 'd1111111-1111-4111-8111-111111111111'],
    ['student', 'd1212121-1212-4121-8121-121212121212'],
    ['day', 'd1313131-1313-4131-8131-131313131313'],
    ['transaction', 'd1414141-1414-4141-8141-141414141414'],
  ] as const)('P05.13: raw SDK omitting the %s writer is rejected with every projection unchanged', async (writer, commandId) => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput(commandId, `p05-raw-missing-${writer}`));
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts, { omit: [writer] });
  });

  it.each(['head', 'student', 'day', 'transaction'] as const)(
    'P05.34: omitting the %s writer while matching its unchanged server snapshot is still denied atomically',
    async writer => {
      await seedBase({ withBusinessDocs: true });
      const artifacts = await rawOrderArtifacts(orderInput('d1212121-1212-4121-8121-121212121212', `p05-unchanged-${writer}`));
      const current = await capturePaths(rawPaths(artifacts));
      const after = artifacts.command.after as RawMap;
      after[writer] = writer === 'transaction' ? null : current[writer === 'head' ? 'system/dataHead'
        : writer === 'student' ? `students/${studentId}`
          : writer === 'day' ? `days/${dayId}` : `transactions/${artifacts.transactionId}`]?.data;
      await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts, { omit: [writer] });
    },
  );

  it('P05.14: raw SDK extra transaction writer is rejected atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('d2222222-2222-4222-8222-222222222222', 'p05-raw-extra'));
    await expectRawBatchDeniedUnchanged(
      authedDb(operatorA), artifacts, { extraTransaction: true }, ['transactions/p05-unlisted-extra'],
    );
  });

  it('P05.15: two raw commands cannot share one five-document transaction', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('d3333333-3333-4333-8333-333333333333', 'p05-raw-double'));
    const secondId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const secondCommand = { ...artifacts.command, commandId: secondId };
    await expectRawBatchDeniedUnchanged(
      authedDb(operatorA), artifacts, { secondCommand }, [`commands/${secondId}`],
    );
  });

  it('P05.16: raw SDK replay of an already committed immutable command is rejected unchanged', async () => {
    await seedBase({ withBusinessDocs: true });
    const db = authedDb(operatorA);
    const artifacts = await rawOrderArtifacts(orderInput('d4444444-4444-4444-8444-444444444444', 'p05-raw-replay'));
    await rawOrderBatch(db, artifacts).commit();
    const beforeReplay = await capturePaths(rawPaths(artifacts));
    await assertFails(rawOrderBatch(db, artifacts).commit());
    expect(await capturePaths(rawPaths(artifacts))).toEqual(beforeReplay);
  });

  it('P05.17: raw SDK forged before snapshot is rejected unchanged', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('d5555555-5555-4555-8555-555555555555', 'p05-raw-before'));
    artifacts.command.before.student.displayName = '偽造前值';
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it('P05.18: raw SDK forged after snapshot is rejected unchanged', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('d6666666-6666-4666-8666-666666666666', 'p05-raw-after'));
    artifacts.command.after.student.currentBalance += 1;
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it('P05.19: malformed raw SDK command ID is rejected atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('d7777777-7777-4777-8777-777777777777', 'p05-raw-bad-id'));
    replaceRawCommandId(artifacts, 'not-a-uuid');
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it.each([
    ['actor UID', (artifacts: RawOrderArtifacts) => { artifacts.command.actor.uid = operatorB.uid; }],
    ['server commit time', (artifacts: RawOrderArtifacts) => { artifacts.command.committedAt = Timestamp.fromMillis(0); }],
    ['head sequence', (artifacts: RawOrderArtifacts) => { artifacts.command.seq += 1; }],
    ['lease epoch', (artifacts: RawOrderArtifacts) => { artifacts.command.leaseEpoch += 1; }],
  ])('P05.28: raw SDK forged %s is denied with the full command closure unchanged', async (_field, mutate) => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'p05-forged-envelope'));
    mutate(artifacts);
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it('P05.29: raw SDK command under an expired server lease is denied atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(db => updateDoc(doc(db, 'system/accessLease'), { updatedAt: Timestamp.fromMillis(0) }));
    const artifacts = await rawOrderArtifacts(orderInput('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'p05-expired-lease'));
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts, {}, ['system/accessLease']);
  });

  it('P05.30: raw SDK command against a closed business day is denied atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { status: 'closed' }));
    const artifacts = await rawOrderArtifacts(orderInput('dccccccc-cccc-4ccc-8ccc-cccccccccccc', 'p05-closed-day'));
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it('P05.35: an approved non-holder cannot write a raw command closure', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('dcdddddd-dddd-4ddd-8ddd-dddddddddddd', 'p05-non-holder'));
    await expectRawBatchDeniedUnchanged(authedDb(operatorB), artifacts);
  });

  it.each([
    ['negative payment amount', -1],
    ['fractional payment amount', 110.5],
    ['payment amount above the Rules ceiling', 1_000_001],
  ])('P05.31: raw SDK %s is denied atomically', async (_case, paidAmount) => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawOrderArtifacts(orderInput('deeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'p05-invalid-amount'));
    artifacts.command.payload.paidAmount = paidAmount;
    if (paidAmount === 1_000_001) {
      const nextBalance = artifacts.studentAfter.currentBalance + paidAmount - artifacts.transactionAfter.mealPrice;
      const mealDelta = artifacts.transactionAfter.mealPrice;
      artifacts.studentAfter.currentBalance = nextBalance;
      artifacts.dayAfter.totals.retainedReceipts = paidAmount;
      artifacts.transactionAfter.paidAmount = paidAmount;
      artifacts.transactionAfter.amount = paidAmount - mealDelta;
      artifacts.command.cashEffect.after = paidAmount;
      artifacts.command.cashEffect.delta = paidAmount;
    }
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it.each([
    ['opening balance upper bound', async () => withAdmin(db => updateDoc(doc(db, `students/${studentId}`), { 'openingBalance.amount': 1_000_000_001 }))],
    ['opening balance note length', async () => withAdmin(db => updateDoc(doc(db, `students/${studentId}`), { 'openingBalance.note': 'n'.repeat(501) }))],
    ['day total upper bound', async () => withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { 'totals.mealTotal': 1_000_000_000 }))],
    ['menu price upper bound', async () => withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { 'menu.price': 1_000_001 }))],
    ['menu vendor ID with a slash', async () => withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { 'menu.vendorId': 'invalid/vendor' }))],
    ['menu vendor ID over 64 characters', async () => withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { 'menu.vendorId': 'v'.repeat(65) }))],
    ['menu vendor name over 100 characters', async () => withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { 'menu.vendorNameSnapshot': 'v'.repeat(101) }))],
  ])('P05.32: raw SDK cannot advance a projection with an invalid %s', async (_case, seedInvalidValue) => {
    await seedBase({ withBusinessDocs: true });
    await seedInvalidValue();
    const artifacts = await rawOrderArtifacts(orderInput('dfffffff-ffff-4fff-8fff-ffffffffffff', 'p05-invalid-projection-bound'));
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it('P05.20: inactive students can pay, while inactive students cannot receive new orders', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(async db => updateDoc(doc(db, `students/${studentId}`), { status: 'inactive' }));
    const payment = await repository(operatorA).commitCommand(paymentInput('d8888888-8888-4888-8888-888888888888', 'p05-inactive-payment'));
    expect(payment.ok, JSON.stringify(payment)).toBe(true);
    const paidState = await withAdmin(async db => {
      const [head, student, day, tx] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, 'transactions/p05-inactive-payment')),
      ]);
      return { head: head.data(), student: student.data(), day: day.data(), tx: tx.data() };
    });
    expect(paidState.student).toMatchObject({ status: 'inactive', currentBalance: 200, revision: 2 });
    expect(paidState.day).toMatchObject({ revision: 2, totals: { activeTransactionCount: 1, retainedReceipts: 200 } });
    expect(paidState.head).toMatchObject({ seq: 1, lastCommandId: 'd8888888-8888-4888-8888-888888888888' });
    expect(paidState.tx).toMatchObject({ type: 'payment', studentId, lastCommandId: 'd8888888-8888-4888-8888-888888888888' });
    expect(await repository(operatorA).readCommand('d8888888-8888-4888-8888-888888888888'))
      .toMatchObject({ commandId: 'd8888888-8888-4888-8888-888888888888', kind: 'CreatePayment', seq: 1 });
  });

  it('P05.21: inactive student order is atomically denied by production Rules', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(async db => updateDoc(doc(db, `students/${studentId}`), { status: 'inactive' }));
    const artifacts = await rawOrderArtifacts(orderInput('d9999999-9999-4999-8999-999999999999', 'p05-inactive-order'));
    await expectRawBatchDeniedUnchanged(authedDb(operatorA), artifacts);
  });

  it('P05.22: only the current server-confirmed holder can read receipts, and absence is explicit', async () => {
    await seedBase();
    const commandId = 'e1111111-1111-4111-8111-111111111111';
    expect(await repository(operatorA).readCommand(commandId)).toBeNull();
    const holderDb = authedDb(operatorA);
    const holderRepository = createCloudCommandRepository(holderDb, { currentUser: () => fakeCurrentUser(operatorA) });
    await disableNetwork(holderDb);
    try {
      await expect(holderRepository.readCommand(commandId)).rejects.toMatchObject({
        name: 'CloudCommandReadError', code: 'UNKNOWN_RESULT',
      });
    } finally {
      await enableNetwork(holderDb);
    }
    await expect(repository(operatorB).readCommand(commandId)).rejects.toMatchObject({
      name: 'CloudCommandReadError', code: 'LEASE_LOST',
    });
  });

  it('P05.23: malformed or tampered server receipts fail closed as unsupported schema', async () => {
    await seedBase({ withBusinessDocs: true });
    const commandId = 'e2222222-2222-4222-8222-222222222222';
    const result = await repository(operatorA).commitCommand(orderInput(commandId, 'p05-malformed-receipt'));
    expect(result.ok, JSON.stringify(result)).toBe(true);
    await withAdmin(async db => updateDoc(doc(db, `commands/${commandId}`), { after: null }));
    await expect(repository(operatorA).readCommand(commandId)).rejects.toMatchObject({
      name: 'CloudCommandReadError', code: 'UNSUPPORTED_SCHEMA',
    } satisfies Partial<CloudCommandReadError>);

    const fingerprintId = 'e3333333-3333-4333-8333-333333333333';
    const second = await repository(operatorA).commitCommand(orderInput(fingerprintId, 'p05-tampered-fingerprint', 2, 2));
    expect(second.ok, JSON.stringify(second)).toBe(true);
    await withAdmin(async db => updateDoc(doc(db, `commands/${fingerprintId}`), { inputFingerprint: '0'.repeat(64) }));
    await expect(repository(operatorA).readCommand(fingerprintId)).rejects.toMatchObject({
      name: 'CloudCommandReadError', code: 'UNSUPPORTED_SCHEMA',
    });

    const pathId = 'e4444444-4444-4444-8444-444444444444';
    const third = await repository(operatorA).commitCommand(orderInput(pathId, 'p05-path-mismatch', 3, 3));
    expect(third.ok, JSON.stringify(third)).toBe(true);
    await withAdmin(async db => updateDoc(doc(db, `commands/${pathId}`), { commandId: 'e5555555-5555-4555-8555-555555555555' }));
    await expect(repository(operatorA).readCommand(pathId)).rejects.toMatchObject({
      name: 'CloudCommandReadError', code: 'UNSUPPORTED_SCHEMA',
    });
  });

  it.each([
    ['opening balance outside Rules bounds', 'e6666666-6666-4666-8666-666666666666', (receipt: RawMap) => {
      (receipt.before as RawMap).student.openingBalance.amount = 2_000_000_000;
      (receipt.after as RawMap).student.openingBalance.amount = 2_000_000_000;
    }],
    ['opening balance note above the schema length', 'eddddddd-dddd-4ddd-8ddd-dddddddddddd', (receipt: RawMap) => {
      (receipt.before as RawMap).student.openingBalance.note = 'n'.repeat(501);
      (receipt.after as RawMap).student.openingBalance.note = 'n'.repeat(501);
    }],
    ['day totals outside Rules bounds', 'e7777777-7777-4777-8777-777777777777', (receipt: RawMap) => {
      const before = (receipt.before as RawMap).day.totals;
      const after = (receipt.after as RawMap).day.totals;
      before.bentoCount = 2_000_000_000;
      after.bentoCount = 2_000_000_001;
    }],
    ['menu price outside Rules bounds', 'e8888888-8888-4888-8888-888888888888', (receipt: RawMap) => {
      (receipt.before as RawMap).day.menu.price = 1_000_001;
      (receipt.after as RawMap).day.menu.price = 1_000_001;
    }],
    ['menu vendor ID with forbidden path syntax', 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (receipt: RawMap) => {
      (receipt.before as RawMap).day.menu.vendorId = 'invalid/vendor';
      (receipt.after as RawMap).day.menu.vendorId = 'invalid/vendor';
    }],
    ['menu vendor name above the Rules length', 'ec3ccccc-cccc-4ccc-8ccc-cccccccccccc', (receipt: RawMap) => {
      (receipt.before as RawMap).day.menu.vendorNameSnapshot = 'v'.repeat(101);
      (receipt.after as RawMap).day.menu.vendorNameSnapshot = 'v'.repeat(101);
    }],
    ['non-null enabled-command reason', 'e9999999-9999-4999-8999-999999999999', (receipt: RawMap) => {
      receipt.reason = 'not permitted for enabled commands';
    }],
    ['inactive student on an order receipt', 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (receipt: RawMap) => {
      (receipt.before as RawMap).student.status = 'inactive';
      (receipt.after as RawMap).student.status = 'inactive';
    }],
  ] as const)('P05.33: readCommand rejects malformed receipt invariant: %s', async (_label, commandId, mutate) => {
    await seedBase({ withBusinessDocs: true });
    await expectMalformedReceiptRejected(commandId, mutate);
  });

  it('P05.36: readCommand rejects an EnsureDay receipt dated before dataHead.goLiveDate', async () => {
    await seedBase();
    const commandId = 'eeeeeaaa-eeee-4eee-8eee-eeeeeeeeeeee';
    const businessDate = shiftDate(dayId, 1);
    const input = {
      commandId,
      kind: 'EnsureDay' as const,
      leaseEpoch: 1,
      targets: { dayId: businessDate },
      expectedRevisions: { day: 0 },
      payload: { businessDate },
    };
    const result = await repository(operatorA).commitCommand(input);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const path = `commands/${commandId}`;
    const original = await withAdmin(async db => (await getDoc(doc(db, path))).data() as RawMap);
    expect(original.committedAt).toBeInstanceOf(Timestamp);

    const malformed = await withAdmin(async db => (await getDoc(doc(db, path))).data() as RawMap);
    const invalidDate = shiftDate(dayId, -1);
    const invalidInput = normalizeEnabledCommandInput({
      commandId,
      kind: 'EnsureDay',
      leaseEpoch: 1,
      targets: { dayId: invalidDate },
      expectedRevisions: { day: 0 },
      payload: { businessDate: invalidDate },
    });
    malformed.businessDate = invalidDate;
    malformed.targets = invalidInput.targets;
    malformed.payload = invalidInput.payload;
    malformed.inputFingerprint = await fingerprintCommandInput(invalidInput);
    await withAdmin(db => setDoc(doc(db, path), malformed));
    await expect(repository(operatorA).readCommand(commandId)).rejects.toMatchObject({
      name: 'CloudCommandReadError', code: 'UNSUPPORTED_SCHEMA',
    } satisfies Partial<CloudCommandReadError>);

    await withAdmin(db => setDoc(doc(db, path), original));
    expect(await repository(operatorA).readCommand(commandId)).toMatchObject({ commandId, kind: 'EnsureDay' });
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

  it('P06.1: only the six P05/P06 enabled kinds pass runtime validation', async () => {
    await seedBase();
    expect(ALL_COMMAND_KINDS).toHaveLength(22);
    const enabledKinds = ['EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'EditStudent', 'SetStudentStatus'];
    const disabledKinds = ALL_COMMAND_KINDS.filter(kind => !enabledKinds.includes(kind));
    expect(enabledKinds).toHaveLength(6);
    expect(disabledKinds).toHaveLength(16);
    for (const [index, kind] of disabledKinds.entries()) {
      const commandId = `f0000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      const disabled = await repository(operatorA).commitCommand({
        commandId, kind, leaseEpoch: 1, targets: {}, expectedRevisions: {}, payload: {},
      });
      expect(disabled).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
  });

  it.each([
    ['missing', { status: 'inactive' }],
    ['empty', { status: 'inactive', reason: '' }],
  ])('P06.3a: rejects a %s status reason before Rules and leaves all state unchanged', async (_label, payload) => {
    await seedBase();
    const commandId = _label === 'missing'
      ? 'f0a11111-1111-4111-8111-111111111111'
      : 'f0a22222-2222-4222-8222-222222222222';
    const result = await repository(operatorA).commitCommand({
      commandId, kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 1 }, payload,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const [head, command] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `commands/${commandId}`)),
    ]));
    expect(head.data()).toMatchObject({ seq: 0, lastCommandId: null });
    expect(command.exists()).toBe(false);
  });

  it.each(ALL_COMMAND_KINDS.filter(kind => !['EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'EditStudent', 'SetStudentStatus'].includes(kind)))(
    'P06.2: production Rules directly deny unsupported raw SDK kind %s atomically', async kind => {
      await seedBase();
      const index = ALL_COMMAND_KINDS.indexOf(kind);
      const commandId = `f1111111-1111-4111-8111-${index.toString(16).padStart(12, '0')}`;
      const db = authedDb(operatorA);
      await assertFails(setDoc(doc(db, `commands/${commandId}`), { commandId, kind }));
      const [head, command] = await withAdmin(async admin => Promise.all([
        getDoc(doc(admin, 'system/dataHead')),
        getDoc(doc(admin, `commands/${commandId}`)),
      ]));
      expect(head.data()?.seq).toBe(0);
      expect(command.exists()).toBe(false);
    },
  );

  it('P06.3: creates string IDs with baseline/current opening dates, signed boundaries, and no financial side effects', async () => {
    await seedBase();
    const goLiveDate = shiftDate(today, -20);
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), { goLiveDate }));
    const aliases = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(2, '0')}${'a'.repeat(98)}`);
    const inputs = [
      studentInput('f2111111-1111-4111-8111-111111111111', '001', 0, goLiveDate, 'Same Name', aliases),
      studentInput('f2222222-2222-4222-8222-222222222222', '002', -1_000_000_000, today, 'Same Name'),
      studentInput('f2333333-3333-4333-8333-333333333333', '003', 1_000_000_000, goLiveDate, 'Same Name'),
    ];
    const results = [];
    for (const input of inputs) results.push(await repository(operatorA).commitCommand(input));
    expect(results.map(result => result.ok)).toEqual([true, true, true]);
    const state = await withAdmin(async db => {
      const [head, students, commands, transactions, days] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        Promise.all(['001', '002', '003'].map(id => getDoc(doc(db, `students/${id}`)))),
        getDocs(collection(db, 'commands')),
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'days')),
      ]);
      return { head: head.data(), students: students.map(snapshot => snapshot.data()), commands, transactions, days };
    });
    expect(state.head).toMatchObject({ seq: 3, lastCommandId: inputs[2].commandId });
    expect(state.students.map(student => student?.studentId)).toEqual(['001', '002', '003']);
    expect(state.students.map(student => student?.displayName)).toEqual(['Same Name', 'Same Name', 'Same Name']);
    expect(state.students.map(student => student?.currentBalance)).toEqual([0, -1_000_000_000, 1_000_000_000]);
    expect(state.students[0]?.aliases).toEqual(aliases);
    for (const [index, student] of state.students.entries()) {
      expect(student?.status).toBe('active');
      expect(student?.openingBalance).toMatchObject({ amount: student?.currentBalance, asOfDate: inputs[index].payload.openingBalance.asOfDate });
      expect(student?.createdAt).toBeInstanceOf(Timestamp);
      expect(student?.updatedAt).toBeInstanceOf(Timestamp);
      expect((student?.openingBalance as RawMap).createdAt).toBeInstanceOf(Timestamp);
      expect(await repository(operatorA).readCommand(inputs[index].commandId)).toMatchObject({
        commandId: inputs[index].commandId,
        seq: index + 1,
        kind: 'CreateStudent',
        targets: { studentId: inputs[index].targets.studentId },
      });
    }
    expect(state.commands.size).toBe(3);
    expect(state.transactions.size).toBe(0);
    expect(state.days.size).toBe(0);
  });

  it('P06.4: semantic replay returns the original receipt; ID collision and duplicate student ID do not advance state', async () => {
    await seedBase();
    const repo = repository(operatorA);
    const input = studentInput('f3111111-1111-4111-8111-111111111111', '001', -25);
    const first = await repo.commitCommand(input);
    const replay = await repo.commitCommand(input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(replay).toEqual(first);
    const collision = await repo.commitCommand({ ...input, payload: { ...input.payload, openingBalance: { ...input.payload.openingBalance, amount: 20 } } });
    expect(collision).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const duplicateId = await repo.commitCommand(studentInput('f3222222-2222-4222-8222-222222222222', '001', 0));
    expect(duplicateId).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const state = await withAdmin(async db => {
      const [head, student, commands] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, 'students/001')),
        getDocs(collection(db, 'commands')),
      ]);
      return { head: head.data(), student: student.data(), commandCount: commands.size };
    });
    expect(state).toMatchObject({ head: { seq: 1, lastCommandId: input.commandId }, student: { studentId: '001', currentBalance: -25, revision: 1 }, commandCount: 1 });
  });

  it('P06.5: only EditStudent fields and explicit status changes advance the student revision', async () => {
    await seedBase();
    const create = await repository(operatorA).commitCommand(studentInput('f4111111-1111-4111-8111-111111111111', '001', -25));
    expect(create.ok, JSON.stringify(create)).toBe(true);
    const edit = await repository(operatorA).commitCommand({
      commandId: 'f4222222-2222-4222-8222-222222222222', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId: '001' }, expectedRevisions: { student: 1 },
      payload: { displayName: 'Renamed Synthetic', aliases: ['A', 'B'] },
    });
    expect(edit.ok, JSON.stringify(edit)).toBe(true);
    const deactivate = await repository(operatorA).commitCommand({
      commandId: 'f4333333-3333-4333-8333-333333333333', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: '001' }, expectedRevisions: { student: 2 },
      payload: { status: 'inactive', reason: 'Synthetic roster correction' },
    });
    expect(deactivate.ok, JSON.stringify(deactivate)).toBe(true);
    if (deactivate.ok) expect(await repository(operatorA).readCommand('f4333333-3333-4333-8333-333333333333')).toMatchObject({ kind: 'SetStudentStatus', seq: 3 });
    const reactivate = await repository(operatorA).commitCommand({
      commandId: 'f4444444-4444-4444-8444-444444444444', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: '001' }, expectedRevisions: { student: 3 },
      payload: { status: 'active', reason: 'Synthetic roster restore' },
    });
    expect(reactivate.ok, JSON.stringify(reactivate)).toBe(true);
    const noOpEdit = await repository(operatorA).commitCommand({
      commandId: 'f4555555-5555-4555-8555-555555555555', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId: '001' }, expectedRevisions: { student: 4 },
      payload: { displayName: 'Renamed Synthetic' },
    });
    const noOpStatus = await repository(operatorA).commitCommand({
      commandId: 'f4666666-6666-4666-8666-666666666666', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: '001' }, expectedRevisions: { student: 4 },
      payload: { status: 'active', reason: 'No actual status change' },
    });
    const stale = await repository(operatorA).commitCommand({
      commandId: 'f4777777-7777-4777-8777-777777777777', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId: '001' }, expectedRevisions: { student: 3 },
      payload: { displayName: 'Stale Writer' },
    });
    expect(noOpEdit).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(noOpStatus).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(stale).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    const [head, student, tx, day] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'students/001')),
      getDocs(collection(db, 'transactions')),
      getDocs(collection(db, 'days')),
    ]));
    expect(head.data()).toMatchObject({ seq: 4, lastCommandId: 'f4444444-4444-4444-8444-444444444444' });
    expect(student.data()).toMatchObject({
      studentId: '001', displayName: 'Renamed Synthetic', aliases: ['A', 'B'], status: 'active',
      currentBalance: -25, revision: 4, openingBalance: { amount: -25 },
    });
    expect(tx.size).toBe(0);
    expect(day.size).toBe(0);
  });

  it.each([
    ['intermediate historical date', shiftDate(today, -2)],
    ['future date', shiftDate(today, 1)],
  ])('P06.6: rejects a student opening on %s atomically', async (_label, date) => {
    await seedBase();
    const goLiveDate = shiftDate(today, -5);
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), { goLiveDate }));
    const input = studentInput('f5111111-1111-4111-8111-111111111111', '001', 0, date);
    const result = await repository(operatorA).commitCommand(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await capturePaths(['system/dataHead', 'students/001', `commands/${input.commandId}`])).toMatchObject({
      'system/dataHead': { exists: true },
      'students/001': { exists: false },
    });
  });

  it('P06.7: production Rules accept a complete raw SDK CreateStudent closure with ten maximum-length aliases', async () => {
    await seedBase();
    const aliases = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(2, '0')}${'b'.repeat(98)}`);
    const artifacts = await rawStudentCreateArtifacts(studentInput(
      'f6111111-1111-4111-8111-111111111111', '001', 0, today, 'Raw Synthetic', aliases,
    ));
    const paths = ['system/dataHead', 'students/001', `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await rawStudentCreateBatch(authedDb(operatorA), artifacts).commit();
    const after = await capturePaths(paths);
    expect(after['system/dataHead'].data).toMatchObject({ seq: 1, lastCommandId: artifacts.commandId });
    expect((after['students/001'].data as RawMap).aliases).toEqual(aliases);
    expect(after[`commands/${artifacts.commandId}`].exists).toBe(true);
    expect(after['system/dataHead'].data).not.toEqual(before['system/dataHead'].data);
  });

  it.each([
    ['head writer', ['head'] as const],
    ['student writer', ['student'] as const],
  ])('P06.8: Rules reject CreateStudent when the raw batch omits its %s', async (_label, omit) => {
    await seedBase();
    const artifacts = await rawStudentCreateArtifacts();
    const paths = ['system/dataHead', `students/${artifacts.studentId}`, `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await assertFails(rawStudentCreateBatch(authedDb(operatorA), artifacts, { omit: [...omit] }).commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P06.9: Rules require an actually absent target when raw SDK creates a student ID', async () => {
    await seedBase();
    expect((await repository(operatorA).commitCommand(studentInput('f7111111-1111-4111-8111-111111111111', '001', 0))).ok).toBe(true);
    const artifacts = await rawStudentCreateArtifacts(
      studentInput('f7222222-2222-4222-8222-222222222222', '001', 0),
      true,
    );
    const paths = ['system/dataHead', 'students/001', `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await assertFails(rawStudentCreateBatch(authedDb(operatorA), artifacts).commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it.each([
    ['payload display name', (artifacts: RawStudentArtifacts) => { artifacts.command.payload.displayName = 'Forged Name'; }],
    ['actual projection balance', (artifacts: RawStudentArtifacts) => { artifacts.studentAfter.currentBalance = 1; }],
    ['receipt after projection', (artifacts: RawStudentArtifacts) => { artifacts.command.after.student.currentBalance = 1; }],
    ['actor identity', (artifacts: RawStudentArtifacts) => { artifacts.command.actor.uid = operatorB.uid; }],
    ['server commit timestamp', (artifacts: RawStudentArtifacts) => { artifacts.command.committedAt = Timestamp.fromMillis(0); }],
    ['head sequence', (artifacts: RawStudentArtifacts) => { artifacts.command.seq += 1; }],
  ])('P06.10: Rules deny a raw student closure with forged %s unchanged', async (_field, mutate) => {
    await seedBase();
    const artifacts = await rawStudentCreateArtifacts();
    mutate(artifacts);
    const paths = ['system/dataHead', `students/${artifacts.studentId}`, `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await assertFails(rawStudentCreateBatch(authedDb(operatorA), artifacts).commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P06.11: a student document can be read before creation and the holder can read the complete server list', async () => {
    await seedBase();
    const db = authedDb(operatorA);
    expect((await getDoc(doc(db, 'students/001'))).exists()).toBe(false);
    expect((await getDocs(collection(db, 'students'))).size).toBe(0);
    expect((await repository(operatorA).commitCommand(studentInput('f8111111-1111-4111-8111-111111111111', '001', 0))).ok).toBe(true);
    expect((await getDocs(collection(db, 'students'))).docs.map(snapshot => snapshot.id)).toEqual(['001']);
    await expect(repository(operatorB).readCommand('f8111111-1111-4111-8111-111111111111')).rejects.toMatchObject({ code: 'LEASE_LOST' });
    await expect(getDocs(collection(authedDb(operatorB), 'students'))).rejects.toThrow();
  });

  it('P06.12: raw SetStudentStatus accepts a nonempty reason and projects only the requested status', async () => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawStudentMutationArtifacts({
      commandId: 'f9111111-1111-4111-8111-111111111111',
      kind: 'SetStudentStatus', leaseEpoch: 1, targets: { studentId },
      expectedRevisions: { student: 1 }, payload: { status: 'inactive', reason: 'Synthetic disable' },
    });
    await rawStudentMutationBatch(authedDb(operatorA), artifacts).commit();
    const [head, student, command] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `students/${studentId}`)),
      getDoc(doc(db, `commands/${artifacts.commandId}`)),
    ]));
    expect(head.data()).toMatchObject({ seq: 1, lastCommandId: artifacts.commandId });
    expect(student.data()).toMatchObject({ status: 'inactive', currentBalance: 0, revision: 2 });
    expect(command.data()).toMatchObject({ kind: 'SetStudentStatus', reason: 'Synthetic disable', businessDate: null, studentId });
  });

  it.each(['missing payload reason', 'empty reason'] as const)(
    'P06.13: Rules reject raw status receipt with %s atomically', async reasonCase => {
      await seedBase({ withBusinessDocs: true });
      const artifacts = await rawStudentMutationArtifacts({
        commandId: reasonCase === 'missing payload reason'
          ? 'f9222222-2222-4222-8222-222222222222'
          : 'f9333333-3333-4333-8333-333333333333',
        kind: 'SetStudentStatus', leaseEpoch: 1, targets: { studentId },
        expectedRevisions: { student: 1 }, payload: { status: 'inactive', reason: 'Synthetic disable' },
      });
      const payload = artifacts.command.payload as RawMap;
      if (reasonCase === 'missing payload reason') {
        delete payload.reason;
      } else {
        payload.reason = '';
        artifacts.command.reason = '';
      }
      await expectRawStudentMutationDeniedUnchanged(artifacts);
    },
  );

  it.each([
    ['head writer', ['head'] as const],
    ['student writer', ['student'] as const],
  ])('P06.13: Rules reject an EditStudent closure that omits its %s', async (_label, omit) => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawStudentMutationArtifacts({
      commandId: 'fa111111-1111-4111-8111-111111111111',
      kind: 'EditStudent', leaseEpoch: 1, targets: { studentId },
      expectedRevisions: { student: 1 }, payload: { displayName: 'Changed Synthetic' },
    });
    await expectRawStudentMutationDeniedUnchanged(artifacts, { omit: [...omit] });
  });

  it.each([
    ['no-op edit', {
      commandId: 'fb111111-1111-4111-8111-111111111111', kind: 'EditStudent' as const,
      leaseEpoch: 1, targets: { studentId }, expectedRevisions: { student: 1 }, payload: { displayName: 'Synthetic Student' },
    }],
    ['no-op status', {
      commandId: 'fb222222-2222-4222-8222-222222222222', kind: 'SetStudentStatus' as const,
      leaseEpoch: 1, targets: { studentId }, expectedRevisions: { student: 1 }, payload: { status: 'active', reason: 'No change' },
    }],
  ])('P06.14: Rules reject raw %s receipts without changing any projection', async (_label, input) => {
    await seedBase({ withBusinessDocs: true });
    const artifacts = await rawStudentMutationArtifacts(input);
    await expectRawStudentMutationDeniedUnchanged(artifacts);
  });

  it('P06.15: Rules, receipt decoding, and server list accept literal nonempty names consistently', async () => {
    await seedBase();
    const names = [' ', '\t', '\u00a0', '\ufeff', 'name\ncontinued'];
    for (const [index, displayName] of names.entries()) {
      const commandId = `fc000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;
      const studentId = `name-${index}`;
      const artifacts = await rawStudentCreateArtifacts(studentInput(commandId, studentId, 0, today, displayName));
      await rawStudentCreateBatch(authedDb(operatorA), artifacts).commit();
      expect(await repository(operatorA).readCommand(commandId)).toMatchObject({ commandId, kind: 'CreateStudent' });
    }
    const db = authedDb(operatorA);
    const listed = await listCloudStudents(db, { currentUser: () => fakeCurrentUser(operatorA) });
    expect(listed.students.map(student => student.displayName)).toEqual(names);
  });

  it('P06.16: Rules reject a raw student projection with an empty display name', async () => {
    await seedBase();
    const artifacts = await rawStudentCreateArtifacts();
    artifacts.command.payload.displayName = '';
    artifacts.studentAfter.displayName = '';
    artifacts.command.after.student.displayName = '';
    await expectRawStudentCreateDeniedUnchanged(artifacts);
  });

  it('P05.26: historical order and payment dates are denied atomically without a reason field', async () => {
    const historicalDayId = shiftDate(today, -1);
    await seedBase({ withBusinessDocs: true });
    await withAdmin(async db => {
      await updateDoc(doc(db, 'system/dataHead'), { goLiveDate: historicalDayId });
      await updateDoc(doc(db, `students/${studentId}`), {
        openingBalance: { amount: 0, asOfDate: historicalDayId, note: '', createdAt: serverTimestamp() },
      });
      await setDoc(doc(db, `days/${historicalDayId}`), {
        status: 'open',
        revision: 1,
        menu: { ...menu, businessDate: historicalDayId },
        openingCash: 1000,
        openedBy: operatorA.uid,
        openedAt: serverTimestamp(),
        totals: {
          activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0,
          mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0,
        },
        lastSettlementRevision: 0,
        lastCommandId: 'p05-synthetic-historical-day-seed',
        updatedAt: serverTimestamp(),
      });
    });

    const orderId = 'e3333333-3333-4333-8333-333333333333';
    const paymentId = 'e4444444-4444-4444-8444-444444444444';
    const paths = [
      'system/dataHead', `students/${studentId}`, `days/${dayId}`, `days/${historicalDayId}`,
      'transactions/p05-historical-order', 'transactions/p05-historical-payment',
      `commands/${orderId}`, `commands/${paymentId}`,
    ];
    const before = await capturePaths(paths);
    const order = await repository(operatorA).commitCommand({
      ...orderInput(orderId, 'p05-historical-order'),
      targets: { transactionId: 'p05-historical-order', studentId, dayId: historicalDayId },
    });
    const payment = await repository(operatorA).commitCommand({
      ...paymentInput(paymentId, 'p05-historical-payment'),
      targets: { transactionId: 'p05-historical-payment', studentId, dayId: historicalDayId },
    });
    expect(order).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(payment).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await capturePaths(paths)).toEqual(before);
  });
});
