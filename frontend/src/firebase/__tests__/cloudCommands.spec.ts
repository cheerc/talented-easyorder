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
  deleteDoc,
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
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
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
const studentId = '22222222-2222-4222-8222-222222222222';
const sid001 = '22222222-2222-4222-8222-303031000000';
const sid002 = '22222222-2222-4222-8222-303032000000';
const sid003 = '22222222-2222-4222-8222-303033000000';

function toStudentUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hex = Array.from(id).map(c => c.charCodeAt(0).toString(16)).join('').padEnd(12, '0').slice(0, 12);
  return `22222222-2222-4222-8222-${hex}`;
}
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
        studentCode: '001',
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
      await setDoc(doc(db, 'studentCodes/001'), {
        studentId,
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
  studentCode?: string,
) {
  const actualStudentId = toStudentUuid(targetStudentId);
  const actualCode = studentCode ?? (/^\d+$/.test(targetStudentId) ? targetStudentId : '001');
  return {
    commandId,
    kind: 'CreateStudent' as const,
    leaseEpoch: 1,
    targets: { studentId: actualStudentId },
    expectedRevisions: { student: 0 as const },
    payload: {
      studentCode: actualCode,
      displayName,
      aliases,
      openingBalance: { amount, asOfDate, note: 'Synthetic opening' },
    },
  };
}

function changeStudentCodeInput(
  commandId = '33333333-3333-4333-8333-333333333333',
  targetStudentId = studentId,
  studentCode = '015',
  expectedRevision = 1,
  reason = 'Synthetic code change',
) {
  return {
    commandId,
    kind: 'ChangeStudentCode' as const,
    leaseEpoch: 1,
    targets: { studentId: toStudentUuid(targetStudentId) },
    expectedRevisions: { student: expectedRevision },
    payload: {
      studentCode,
      reason,
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
  studentCode: string;
  command: RawMap;
  headAfter: RawMap;
  studentAfter: RawMap;
  codeIndexAfter: RawMap;
};

type RawChangeCodeArtifacts = {
  commandId: string;
  studentId: string;
  oldCode: string;
  newCode: string;
  command: RawMap;
  headAfter: RawMap;
  studentAfter: RawMap;
  newIndexAfter: RawMap;
};

type RawStudentMutationInput = {
  commandId: string;
  kind: 'EditStudent' | 'SetStudentStatus';
  leaseEpoch: number;
  targets: { studentId: string };
  expectedRevisions: { student: number };
  payload: Record<string, unknown>;
};

type RawP07Artifacts = {
  commandId: string;
  targetPath: string;
  targetMode: 'create' | 'update';
  command: RawMap;
  headAfter: RawMap;
  targetAfter: RawMap;
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
    studentCode: canonical.payload.studentCode,
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
  const codeIndexAfter = {
    studentId: input.targets.studentId,
    lastCommandId: input.commandId,
    updatedAt: now,
  };
  return {
    commandId: input.commandId,
    studentId: input.targets.studentId,
    studentCode: canonical.payload.studentCode,
    command,
    headAfter,
    studentAfter,
    codeIndexAfter,
  };
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
  return {
    commandId: input.commandId,
    studentId: canonical.targets.studentId,
    studentCode: studentBefore.studentCode ?? '001',
    command,
    headAfter,
    studentAfter,
    codeIndexAfter: {},
  };
}

function rawStudentCreateBatch(
  db: Firestore,
  artifacts: RawStudentArtifacts,
  options: { omit?: Array<'head' | 'student' | 'codeIndex'> } = {},
) {
  const omitted = new Set(options.omit ?? []);
  const batch = writeBatch(db);
  if (!omitted.has('head')) batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!omitted.has('student')) batch.set(doc(db, `students/${artifacts.studentId}`), artifacts.studentAfter);
  if (!omitted.has('codeIndex')) batch.set(doc(db, `studentCodes/${artifacts.studentCode}`), artifacts.codeIndexAfter);
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  return batch;
}

async function rawStudentChangeCodeArtifacts(
  input = changeStudentCodeInput(),
): Promise<RawChangeCodeArtifacts> {
  const canonical = normalizeEnabledCommandInput(input);
  if (canonical.kind !== 'ChangeStudentCode') throw new Error('Expected ChangeStudentCode input');
  const fingerprint = await fingerprintCommandInput(canonical);
  const [headSnapshot, studentSnapshot] = await withAdmin(async admin => Promise.all([
    getDoc(doc(admin, 'system/dataHead')),
    getDoc(doc(admin, `students/${canonical.targets.studentId}`)),
  ]));
  if (!headSnapshot.exists() || !studentSnapshot.exists()) {
    throw new Error('Raw SDK student fixture requires dataHead and student');
  }
  const headBefore = headSnapshot.data() as RawMap;
  const studentBefore = studentSnapshot.data() as RawMap;
  const seq = headBefore.seq + 1;
  const now = serverTimestamp();
  const headAfter = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: now };
  const oldCode = String(studentBefore.studentCode);
  const newCode = canonical.payload.studentCode;
  const studentAfter = {
    ...studentBefore,
    studentCode: newCode,
    revision: Number(studentBefore.revision) + 1,
    lastCommandId: input.commandId,
    updatedAt: now,
  };
  const newIndexAfter = {
    studentId: canonical.targets.studentId,
    lastCommandId: input.commandId,
    updatedAt: now,
  };
  const command = {
    commandId: input.commandId,
    kind: 'ChangeStudentCode',
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
    reason: canonical.payload.reason,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: canonical.payload,
    inputFingerprint: fingerprint,
  };
  return {
    commandId: input.commandId,
    studentId: canonical.targets.studentId,
    oldCode,
    newCode,
    command,
    headAfter,
    studentAfter,
    newIndexAfter,
  };
}

function rawStudentChangeCodeBatch(
  db: Firestore,
  artifacts: RawChangeCodeArtifacts,
  options: { omit?: Array<'head' | 'student' | 'newIndex' | 'oldIndex'>; extraIndex?: boolean } = {},
) {
  const omitted = new Set(options.omit ?? []);
  const batch = writeBatch(db);
  if (!omitted.has('head')) batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!omitted.has('student')) batch.update(doc(db, `students/${artifacts.studentId}`), artifacts.studentAfter);
  if (!omitted.has('newIndex')) batch.set(doc(db, `studentCodes/${artifacts.newCode}`), artifacts.newIndexAfter);
  if (!omitted.has('oldIndex')) batch.delete(doc(db, `studentCodes/${artifacts.oldCode}`));
  if (options.extraIndex) {
    batch.set(doc(db, 'studentCodes/999'), { studentId: artifacts.studentId, lastCommandId: artifacts.commandId, updatedAt: serverTimestamp() });
  }
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  return batch;
}

async function expectRawStudentChangeCodeDeniedUnchanged(
  artifacts: RawChangeCodeArtifacts,
  options: { omit?: Array<'head' | 'student' | 'newIndex' | 'oldIndex'> } = {},
) {
  const paths = [
    'system/dataHead',
    `students/${artifacts.studentId}`,
    `studentCodes/${artifacts.oldCode}`,
    `studentCodes/${artifacts.newCode}`,
    `commands/${artifacts.commandId}`,
  ];
  const before = await capturePaths(paths);
  await assertFails(rawStudentChangeCodeBatch(authedDb(operatorA), artifacts, options).commit());
  expect(await capturePaths(paths)).toEqual(before);
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

async function seedP07Vendor(
  vendorId: string,
  options: { name?: string; status?: 'active' | 'inactive'; deleted?: boolean } = {},
) {
  await withAdmin(db => setDoc(doc(db, `vendors/${vendorId}`), {
    vendorId,
    name: options.name ?? 'Synthetic Vendor',
    phone: '',
    note: '',
    status: options.status ?? 'active',
    deleted: options.deleted ?? false,
    createdAt: serverTimestamp(),
    revision: 1,
    lastCommandId: 'p07-synthetic-vendor-seed',
    updatedAt: serverTimestamp(),
  }));
}

async function seedP07Day(dayId: string, overrides: Partial<RawMap> = {}) {
  await withAdmin(db => setDoc(doc(db, `days/${dayId}`), {
    status: 'open',
    revision: 1,
    menu: null,
    openingCash: null,
    openedBy: null,
    openedAt: null,
    totals: {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0,
      mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: 'p07-synthetic-day-seed',
    updatedAt: serverTimestamp(),
    ...overrides,
  }));
}

async function rawP07VendorArtifacts(input: {
  commandId: string;
  kind: 'SaveVendor' | 'RemoveVendor';
  vendorId: string;
  payload: RawMap;
  expectedRevision?: number;
}): Promise<RawP07Artifacts> {
  const [headSnapshot, vendorSnapshot] = await withAdmin(async db => Promise.all([
    getDoc(doc(db, 'system/dataHead')),
    getDoc(doc(db, `vendors/${input.vendorId}`)),
  ]));
  if (!headSnapshot.exists()) throw new Error('P07 raw vendor fixture requires dataHead');
  const headBefore = headSnapshot.data() as RawMap;
  const vendorBefore = vendorSnapshot.exists() ? vendorSnapshot.data() as RawMap : null;
  if (input.kind === 'RemoveVendor' && vendorBefore === null) {
    throw new Error('P07 raw RemoveVendor fixture requires an existing vendor');
  }
  const seq = Number(headBefore.seq) + 1;
  const headAfter = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: serverTimestamp() };
  const vendorAfter = input.kind === 'SaveVendor'
    ? {
      ...(vendorBefore ?? {}),
      vendorId: input.vendorId,
      name: input.payload.name,
      phone: input.payload.phone,
      note: input.payload.note,
      status: input.payload.status,
      deleted: false,
      createdAt: vendorBefore?.createdAt ?? serverTimestamp(),
      revision: Number(vendorBefore?.revision ?? 0) + 1,
      lastCommandId: input.commandId,
      updatedAt: serverTimestamp(),
    }
    : {
      ...(vendorBefore ?? {}),
      deleted: true,
      revision: Number(vendorBefore?.revision ?? 0) + 1,
      lastCommandId: input.commandId,
      updatedAt: serverTimestamp(),
    };
  const expectedRevision = input.expectedRevision ?? Number(vendorBefore?.revision ?? 0);
  const command: RawMap = {
    commandId: input.commandId,
    kind: input.kind,
    seq,
    leaseEpoch: 1,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: null,
    studentId: null,
    targets: { vendorId: input.vendorId },
    expectedRevisions: { vendor: expectedRevision },
    before: { head: headBefore, vendor: vendorBefore },
    after: { head: headAfter, vendor: vendorAfter },
    reason: input.kind === 'RemoveVendor' ? input.payload.reason : null,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: input.payload,
    inputFingerprint: 'a'.repeat(64),
  };
  return {
    commandId: input.commandId,
    targetPath: `vendors/${input.vendorId}`,
    targetMode: vendorBefore === null ? 'create' : 'update',
    command,
    headAfter,
    targetAfter: vendorAfter,
  };
}

async function rawP07DayArtifacts(input: {
  commandId: string;
  kind: 'SetDayMenu' | 'SetOpeningCash';
  dayId: string;
  payload: RawMap;
  expectedRevision?: number;
  expectedHeadSeq?: number;
}): Promise<RawP07Artifacts> {
  const [headSnapshot, daySnapshot] = await withAdmin(async db => Promise.all([
    getDoc(doc(db, 'system/dataHead')),
    getDoc(doc(db, `days/${input.dayId}`)),
  ]));
  if (!headSnapshot.exists() || !daySnapshot.exists()) {
    throw new Error('P07 raw day fixture requires dataHead and an existing target day');
  }
  const headBefore = headSnapshot.data() as RawMap;
  const dayBefore = daySnapshot.data() as RawMap;
  const seq = Number(headBefore.seq) + 1;
  const headAfter = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: serverTimestamp() };
  const expectedRevisions = input.kind === 'SetDayMenu'
    ? {
      day: input.expectedRevision ?? Number(dayBefore.revision),
      headSeq: input.expectedHeadSeq ?? Number(headBefore.seq),
    }
    : { day: input.expectedRevision ?? Number(dayBefore.revision) };
  const dayAfter = input.kind === 'SetDayMenu'
    ? {
      ...dayBefore,
      menu: {
        businessDate: input.dayId,
        itemName: input.payload.itemName,
        price: input.payload.price,
        vendorId: input.payload.vendorId,
        vendorNameSnapshot: input.payload.vendorNameSnapshot,
        updatedAt: serverTimestamp(),
        revision: dayBefore.menu === null ? 1 : Number(dayBefore.menu.revision) + 1,
        inheritedFromDate: input.payload.inheritedFromDate,
      },
      revision: Number(dayBefore.revision) + 1,
      lastCommandId: input.commandId,
      updatedAt: serverTimestamp(),
    }
    : {
      ...dayBefore,
      openingCash: input.payload.openingCash,
      openedBy: dayBefore.openingCash === null ? operatorA.uid : dayBefore.openedBy,
      openedAt: dayBefore.openingCash === null ? serverTimestamp() : dayBefore.openedAt,
      revision: Number(dayBefore.revision) + 1,
      lastCommandId: input.commandId,
      updatedAt: serverTimestamp(),
    };
  const command: RawMap = {
    commandId: input.commandId,
    kind: input.kind,
    seq,
    leaseEpoch: 1,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: input.dayId,
    studentId: null,
    targets: { dayId: input.dayId },
    expectedRevisions,
    before: { head: headBefore, day: dayBefore },
    after: { head: headAfter, day: dayAfter },
    reason: null,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: input.payload,
    inputFingerprint: 'b'.repeat(64),
  };
  return {
    commandId: input.commandId,
    targetPath: `days/${input.dayId}`,
    targetMode: 'update',
    command,
    headAfter,
    targetAfter: dayAfter,
  };
}

function rawP07Batch(
  db: Firestore,
  artifacts: RawP07Artifacts,
  options: { omit?: Array<'head' | 'target' | 'command'>; extraPaths?: string[] } = {},
) {
  const omitted = new Set(options.omit ?? []);
  const batch = writeBatch(db);
  if (!omitted.has('head')) batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!omitted.has('target')) {
    const targetRef = doc(db, artifacts.targetPath);
    if (artifacts.targetMode === 'create') batch.set(targetRef, artifacts.targetAfter);
    else batch.update(targetRef, artifacts.targetAfter);
  }
  if (!omitted.has('command')) batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  for (const extraPath of options.extraPaths ?? []) {
    batch.set(doc(db, extraPath), { unexpected: true });
  }
  return batch;
}

function encodeRulesMockToken(operator: typeof operatorA): string {
  const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const header = encode({ alg: 'none', type: 'JWT' });
  const payload = encode({
    iss: 'https://securetoken.google.com/demo-easyorder',
    aud: 'demo-easyorder',
    iat: 0,
    exp: 3600,
    auth_time: 0,
    sub: operator.uid,
    user_id: operator.uid,
    firebase: { sign_in_provider: 'google.com', identities: {} },
    email: operator.email,
    email_verified: true,
  });
  return `${header}.${payload}.`;
}

function encodeRestValue(value: unknown, fieldPath: string, doubleValuePaths: Set<string>): Record<string, unknown> {
  if (value === null) return { nullValue: null };
  if (value instanceof Timestamp) return { timestampValue: value.toDate().toISOString() };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return doubleValuePaths.has(fieldPath)
      ? { doubleValue: value }
      : Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item, index) => encodeRestValue(item, `${fieldPath}.${index}`, doubleValuePaths)) } };
  }
  if (typeof value === 'object') {
    const fields = Object.fromEntries(Object.entries(value as RawMap).map(([key, child]) => [
      key,
      encodeRestValue(child, fieldPath ? `${fieldPath}.${key}` : key, doubleValuePaths),
    ]));
    return { mapValue: { fields } };
  }
  throw new Error(`Cannot encode unsupported Firestore REST fixture value at ${fieldPath}`);
}

function encodeRestFields(data: RawMap, doubleValuePaths: Set<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeRestValue(value, key, doubleValuePaths)]));
}

function restMaskPaths(fields: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(fields).flatMap(([key, rawValue]) => {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const value = rawValue as RawMap;
    const nestedFields = value.mapValue?.fields as Record<string, unknown> | undefined;
    return nestedFields && Object.keys(nestedFields).length > 0
      ? restMaskPaths(nestedFields, fieldPath)
      : [fieldPath];
  });
}

function restWrite(
  path: string,
  data: RawMap,
  options: {
    transforms?: string[];
    doubleValuePaths?: Set<string>;
    mustNotExist?: boolean;
  } = {},
) {
  const fields = encodeRestFields(data, options.doubleValuePaths ?? new Set());
  return {
    update: {
      name: `projects/demo-easyorder/databases/(default)/documents/${path}`,
      fields,
    },
    updateMask: { fieldPaths: restMaskPaths(fields) },
    ...(options.transforms && options.transforms.length > 0 ? {
      updateTransforms: options.transforms.map(fieldPath => ({
        fieldPath,
        setToServerValue: 'REQUEST_TIME',
      })),
    } : {}),
    ...(options.mustNotExist ? { currentDocument: { exists: false } } : {}),
  };
}

async function commitRawP07OpeningCashViaRest(
  artifacts: RawP07Artifacts,
  doubleValuePaths: string[] = [],
): Promise<Response> {
  const host = emulatorHost?.includes('://') ? emulatorHost : `http://${emulatorHost}`;
  const url = `${host}/v1/projects/demo-easyorder/databases/(default)/documents:commit`;
  const headAfter = { ...artifacts.headAfter };
  delete headAfter.updatedAt;
  const targetAfter = { ...artifacts.targetAfter };
  delete targetAfter.openedAt;
  delete targetAfter.updatedAt;
  const command = { ...artifacts.command };
  delete command.committedAt;
  const commandAfter = command.after as RawMap;
  const headReceiptAfter = { ...commandAfter.head };
  delete headReceiptAfter.updatedAt;
  const dayReceiptAfter = { ...commandAfter.day };
  delete dayReceiptAfter.openedAt;
  delete dayReceiptAfter.updatedAt;
  command.after = { ...commandAfter, head: headReceiptAfter, day: dayReceiptAfter };
  const doublePaths = new Set(doubleValuePaths);
  const writes = [
    restWrite('system/dataHead', headAfter, { transforms: ['updatedAt'] }),
    restWrite(artifacts.targetPath, targetAfter, {
      transforms: ['openedAt', 'updatedAt'],
      doubleValuePaths: doublePaths,
    }),
    restWrite(`commands/${artifacts.commandId}`, command, {
      transforms: ['committedAt', 'after.head.updatedAt', 'after.day.openedAt', 'after.day.updatedAt'],
      doubleValuePaths: new Set(doubleValuePaths.map(path => `after.day.${path}`)),
      mustNotExist: true,
    }),
  ];
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${encodeRulesMockToken(operatorA)}`,
    },
    body: JSON.stringify({ writes }),
  });
}

async function expectRawP07DeniedUnchanged(
  artifacts: RawP07Artifacts,
  options: Parameters<typeof rawP07Batch>[2] = {},
) {
  const paths = ['system/dataHead', artifacts.targetPath, `commands/${artifacts.commandId}`, ...(options.extraPaths ?? [])];
  const before = await capturePaths(paths);
  await assertFails(rawP07Batch(authedDb(operatorA), artifacts, options).commit());
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

const invalidDirectMenuCases: Array<[string, 'active' | 'inactive' | null, string, boolean]> = [
  ['missing vendor', null, 'Synthetic Vendor', false],
  ['inactive vendor', 'inactive', 'Synthetic Vendor', false],
  ['deleted vendor', 'active', 'Synthetic Vendor', true],
  ['forged vendor name snapshot', 'active', 'Wrong Name', false],
];

const invalidOpeningCommandMutations: Array<[string, (artifacts: RawP07Artifacts) => void]> = [
  ['actor', artifacts => { artifacts.command.actor.uid = operatorB.uid; }],
  ['server time', artifacts => { artifacts.command.committedAt = Timestamp.fromMillis(0); }],
  ['sequence', artifacts => { artifacts.command.seq += 1; }],
  ['lease epoch', artifacts => { artifacts.command.leaseEpoch += 1; }],
  ['expected day revision', artifacts => { artifacts.command.expectedRevisions.day += 1; }],
  ['before snapshot', artifacts => { artifacts.command.before.day.revision += 1; }],
  ['after snapshot', artifacts => { artifacts.command.after.day.openingCash += 1; }],
  ['projection payload', artifacts => { artifacts.targetAfter.openingCash += 1; }],
  ['forbidden top-level reason', artifacts => { artifacts.command.reason = 'unexpected'; }],
];

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

  it('P07.1: only the twelve P05/P06/P06b/P07/P09a enabled kinds pass runtime validation', async () => {
    await seedBase();
    expect(ALL_COMMAND_KINDS).toHaveLength(23);
    const enabledKinds = [
      'EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus',
      'SaveVendor', 'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateCashMovement',
    ];
    const disabledKinds = ALL_COMMAND_KINDS.filter(kind => !enabledKinds.includes(kind));
    expect(enabledKinds).toHaveLength(12);
    expect(disabledKinds).toHaveLength(11);
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

  it.each(ALL_COMMAND_KINDS.filter(kind => ![
    'EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus',
    'SaveVendor', 'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateCashMovement',
  ].includes(kind)))(
    'P07.2: production Rules directly deny unsupported raw SDK kind %s atomically', async kind => {
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

  it('P07.3: raw SaveVendor creates then revisions one vendor without array replacement', async () => {
    await seedBase();
    const create = await rawP07VendorArtifacts({
      commandId: 'f7111111-1111-4111-8111-111111111111',
      kind: 'SaveVendor',
      vendorId: 'p07-vendor-create',
      payload: { vendorId: 'p07-vendor-create', name: 'New Vendor', phone: '02-1234', note: 'fresh', status: 'active' },
    });
    await rawP07Batch(authedDb(operatorA), create).commit();
    const edit = await rawP07VendorArtifacts({
      commandId: 'f7222222-2222-4222-8222-222222222222',
      kind: 'SaveVendor',
      vendorId: 'p07-vendor-create',
      payload: { vendorId: 'p07-vendor-create', name: 'Updated Vendor', phone: '', note: '', status: 'inactive' },
    });
    await rawP07Batch(authedDb(operatorA), edit).commit();
    const boundary = await rawP07VendorArtifacts({
      commandId: 'f7333333-3333-4333-8333-333333333335',
      kind: 'SaveVendor',
      vendorId: 'p07-vendor-boundaries',
      payload: {
        vendorId: 'p07-vendor-boundaries', name: 'n'.repeat(100),
        phone: 'p'.repeat(100), note: 'x'.repeat(500), status: 'active',
      },
    });
    await rawP07Batch(authedDb(operatorA), boundary).commit();
    const state = await withAdmin(async db => {
      const [head, vendor, boundaryVendor] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, 'vendors/p07-vendor-create')),
        getDoc(doc(db, 'vendors/p07-vendor-boundaries')),
      ]);
      return { head: head.data(), vendor: vendor.data(), boundaryVendor: boundaryVendor.data() };
    });
    expect(state.head).toMatchObject({ seq: 3, lastCommandId: boundary.commandId });
    expect(state.vendor).toMatchObject({
      vendorId: 'p07-vendor-create', name: 'Updated Vendor', phone: '', note: '',
      status: 'inactive', deleted: false, revision: 2, lastCommandId: edit.commandId,
    });
    expect(state.boundaryVendor).toMatchObject({ name: 'n'.repeat(100), phone: 'p'.repeat(100), note: 'x'.repeat(500) });
  });

  it('P07.4: raw RemoveVendor tombstones an inactive vendor and the ID cannot be reused', async () => {
    await seedBase();
    await seedP07Vendor('p07-vendor-remove', { name: 'Inactive Vendor', status: 'inactive' });
    const remove = await rawP07VendorArtifacts({
      commandId: 'f7333333-3333-4333-8333-333333333333',
      kind: 'RemoveVendor',
      vendorId: 'p07-vendor-remove',
      payload: { reason: 'r'.repeat(500) },
    });
    await rawP07Batch(authedDb(operatorA), remove).commit();
    const tombstone = await withAdmin(db => getDoc(doc(db, 'vendors/p07-vendor-remove')));
    expect(tombstone.data()).toMatchObject({ deleted: true, status: 'inactive', revision: 2 });
    const reuse = await rawP07VendorArtifacts({
      commandId: 'f7444444-4444-4444-8444-444444444444',
      kind: 'SaveVendor',
      vendorId: 'p07-vendor-remove',
      expectedRevision: 0,
      payload: { vendorId: 'p07-vendor-remove', name: 'Reused Vendor', phone: '', note: '', status: 'active' },
    });
    await expectRawP07DeniedUnchanged(reuse);
  });

  it.each([
    ['active vendor', 'active', false],
    ['already removed vendor', 'inactive', true],
  ] as const)('P07.5: raw RemoveVendor rejects an %s atomically', async (_label, status, deleted) => {
    await seedBase();
    await seedP07Vendor('p07-invalid-remove', { status, deleted });
    const artifacts = await rawP07VendorArtifacts({
      commandId: 'f7555555-5555-4555-8555-555555555555',
      kind: 'RemoveVendor',
      vendorId: 'p07-invalid-remove',
      payload: { reason: 'Invalid removal attempt' },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.6a: raw SaveVendor rejects an overlong document ID atomically', async () => {
    await seedBase();
    const vendorId = 'v'.repeat(65);
    const artifacts = await rawP07VendorArtifacts({
      commandId: 'f7a11111-1111-4111-8111-111111111111',
      kind: 'SaveVendor', vendorId,
      payload: { vendorId, name: 'Valid Name', phone: '', note: '', status: 'active' },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it.each([
    ['missing', 'p07-create-status-missing', 'f7b11111-1111-4111-8111-111111111111', {
      vendorId: 'p07-create-status-missing', name: 'Valid Name', phone: '', note: '',
    }],
    ['inactive', 'p07-create-status-inactive', 'f7b22222-2222-4222-8222-222222222222', {
      vendorId: 'p07-create-status-inactive', name: 'Valid Name', phone: '', note: '', status: 'inactive',
    }],
    ['invalid', 'p07-create-status-invalid', 'f7b33333-3333-4333-8333-333333333333', {
      vendorId: 'p07-create-status-invalid', name: 'Valid Name', phone: '', note: '', status: 'invalid',
    }],
    ['null', 'p07-create-status-null', 'f7b44444-4444-4444-8444-444444444444', {
      vendorId: 'p07-create-status-null', name: 'Valid Name', phone: '', note: '', status: null,
    }],
  ] as const)(
    'P07.6b: raw SaveVendor rejects a create payload with %s status even when the new vendor projection is active',
    async (_label, vendorId, commandId, payload) => {
      await seedBase();
      const artifacts = await rawP07VendorArtifacts({
        commandId,
        kind: 'SaveVendor',
        vendorId,
        payload,
      });
      artifacts.targetAfter.status = 'active';
      (artifacts.command.after as RawMap).vendor = artifacts.targetAfter;
      await expectRawP07DeniedUnchanged(artifacts);
    },
  );

  it.each([
    ['missing', 'missing'],
    ['non-null', 'non-null'],
  ] as const)(
    'P07.6c: raw SaveVendor create rejects a %s before.vendor receipt snapshot atomically',
    async (_label, beforeVendorShape) => {
      await seedBase();
      const vendorId = 'p07-create-before-vendor';
      const artifacts = await rawP07VendorArtifacts({
        commandId: 'f7c11111-1111-4111-8111-111111111111',
        kind: 'SaveVendor',
        vendorId,
        payload: { vendorId, name: 'New Vendor', phone: '', note: '', status: 'active' },
      });
      const before = artifacts.command.before as RawMap;
      if (beforeVendorShape === 'missing') {
        delete before.vendor;
      } else {
        const timestamp = Timestamp.fromMillis(1);
        before.vendor = {
          vendorId,
          name: 'Existing Snapshot',
          phone: '',
          note: '',
          status: 'inactive',
          deleted: true,
          createdAt: timestamp,
          revision: 1,
          lastCommandId: 'p07-prior-vendor-snapshot',
          updatedAt: timestamp,
        };
      }
      await expectRawP07DeniedUnchanged(artifacts);
    },
  );

  it.each([
    ['empty name', { name: '', phone: '', note: '', status: 'active' }],
    ['overlong name', { name: 'n'.repeat(101), phone: '', note: '', status: 'active' }],
    ['overlong phone', { name: 'Valid Name', phone: 'p'.repeat(101), note: '', status: 'active' }],
    ['overlong note', { name: 'Valid Name', phone: '', note: 'n'.repeat(501), status: 'active' }],
    ['nonliteral status', { name: 'Valid Name', phone: '', note: '', status: 'deleted' }],
  ])('P07.6: raw SaveVendor rejects a %s without changing the target or head', async (_label, values) => {
    await seedBase();
    const vendorId = 'p07-invalid-save';
    const artifacts = await rawP07VendorArtifacts({
      commandId: 'f7666666-6666-4666-8666-666666666666',
      kind: 'SaveVendor',
      vendorId,
      payload: { vendorId, ...values },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it.each([
    ['empty reason', ''],
    ['overlong reason', 'r'.repeat(501)],
  ])('P07.7: raw RemoveVendor rejects a %s atomically', async (_label, reason) => {
    await seedBase();
    await seedP07Vendor('p07-invalid-reason', { status: 'inactive' });
    const artifacts = await rawP07VendorArtifacts({
      commandId: 'f7777777-7777-4777-8777-777777777777',
      kind: 'RemoveVendor',
      vendorId: 'p07-invalid-reason',
      payload: { reason },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.8: raw SetDayMenu preplans a future empty day after EnsureDay', async () => {
    await seedBase();
    await seedP07Vendor('p07-menu-vendor');
    const futureDay = shiftDate(today, 1);
    const ensured = await repository(operatorA).commitCommand({
      commandId: 'f7888888-8888-4888-8888-888888888888',
      kind: 'EnsureDay', leaseEpoch: 1,
      targets: { dayId: futureDay }, expectedRevisions: { day: 0 }, payload: { businessDate: futureDay },
    });
    expect(ensured.ok, JSON.stringify(ensured)).toBe(true);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7999999-9999-4999-8999-999999999999',
      kind: 'SetDayMenu',
      dayId: futureDay,
      payload: {
        selectionDate: today,
        itemName: 'Future Menu', price: 125, vendorId: 'p07-menu-vendor',
        vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null,
      },
    });
    await rawP07Batch(authedDb(operatorA), artifacts).commit();
    const [head, day] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${futureDay}`)),
    ]));
    expect(head.data()).toMatchObject({ seq: 2, lastCommandId: artifacts.commandId });
    expect(day.data()).toMatchObject({
      status: 'open', revision: 2,
      menu: {
        businessDate: futureDay, itemName: 'Future Menu', price: 125,
        vendorId: 'p07-menu-vendor', vendorNameSnapshot: 'Synthetic Vendor',
        revision: 1, inheritedFromDate: null,
      },
    });
  });

  it('P07.9: raw SetDayMenu inherits the immediate source menu with a frozen snapshot', async () => {
    await seedBase({ withBusinessDocs: true });
    await seedP07Vendor('p05-vendor', { name: 'Synthetic Vendor' });
    const futureDay = shiftDate(today, 1);
    const ensured = await repository(operatorA).commitCommand({
      commandId: 'f7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'EnsureDay', leaseEpoch: 1,
      targets: { dayId: futureDay }, expectedRevisions: { day: 0 }, payload: { businessDate: futureDay },
    });
    expect(ensured.ok, JSON.stringify(ensured)).toBe(true);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      kind: 'SetDayMenu',
      dayId: futureDay,
      payload: {
        selectionDate: today,
        itemName: menu.itemName, price: menu.price, vendorId: menu.vendorId,
        vendorNameSnapshot: menu.vendorNameSnapshot, inheritedFromDate: today,
      },
    });
    await rawP07Batch(authedDb(operatorA), artifacts).commit();
    const day = await withAdmin(db => getDoc(doc(db, `days/${futureDay}`)));
    expect(day.data()?.menu).toMatchObject({
      businessDate: futureDay, itemName: menu.itemName, price: menu.price,
      vendorId: menu.vendorId, vendorNameSnapshot: menu.vendorNameSnapshot,
      inheritedFromDate: today, revision: 1,
    });
  });

  it('P07.9a: raw SetDayMenu inherits over an existing target menu from a confirmed, nonzero source day', async () => {
    await seedBase();
    await seedP07Vendor('p05-vendor', { name: 'Synthetic Vendor' });
    const futureDay = shiftDate(today, 1);
    await seedP07Day(today, {
      revision: 7,
      menu: { ...menu, businessDate: today, revision: 3 },
      openingCash: 20_000,
      openedBy: operatorA.uid,
      openedAt: serverTimestamp(),
      totals: {
        activeTransactionCount: 12, bentoCount: 9, otherMealCount: 3,
        mealTotal: 1_200, retainedReceipts: 800, cashierIncome: 50, cashierExpense: 20,
      },
      lastSettlementRevision: 2,
      status: 'reopened',
    });
    await seedP07Day(futureDay, {
      revision: 4,
      menu: {
        ...menu, businessDate: futureDay, itemName: 'Direct Future Menu', price: 175, revision: 2,
        inheritedFromDate: null,
      },
    });
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7b9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9',
      kind: 'SetDayMenu',
      dayId: futureDay,
      payload: {
        selectionDate: today,
        itemName: menu.itemName, price: menu.price, vendorId: menu.vendorId,
        vendorNameSnapshot: menu.vendorNameSnapshot, inheritedFromDate: today,
      },
    });
    await rawP07Batch(authedDb(operatorA), artifacts).commit();
    const day = await withAdmin(db => getDoc(doc(db, `days/${futureDay}`)));
    expect(day.data()).toMatchObject({
      revision: 5,
      menu: {
        businessDate: futureDay, itemName: menu.itemName, price: menu.price,
        vendorId: menu.vendorId, vendorNameSnapshot: menu.vendorNameSnapshot,
        inheritedFromDate: today, revision: 3,
      },
    });
  });

  // The complete source-day schema check runs on the dataHead write (headInheritedMenuSourceDay).
  // Each source below keeps a legal menu, so only that check can deny the inherited commit.
  it.each([
    ['an extra top-level field', (sourceDay: string) => ({ menu: { ...menu, businessDate: sourceDay }, extraField: 'x' })],
    ['incomplete totals', (sourceDay: string) => ({ menu: { ...menu, businessDate: sourceDay }, totals: { activeTransactionCount: 0 } })],
    ['openingCash without openedBy/openedAt', (sourceDay: string) => ({ menu: { ...menu, businessDate: sourceDay }, openingCash: 100 })],
    ['a menu businessDate that is not the source day', (sourceDay: string) => ({ menu: { ...menu, businessDate: shiftDate(sourceDay, -1) } })],
    ['an invalid status', (sourceDay: string) => ({ menu: { ...menu, businessDate: sourceDay }, status: 'archived' })],
    ['an extra menu key', (sourceDay: string) => ({ menu: { ...menu, businessDate: sourceDay, extra: 1 } })],
  ])('P07.9b: raw inherited SetDayMenu rejects a source day with %s atomically', async (_label, sourceOverrides) => {
    await seedBase();
    await seedP07Vendor('p05-vendor', { name: 'Synthetic Vendor' });
    const futureDay = shiftDate(today, 1);
    await seedP07Day(today, sourceOverrides(today));
    await seedP07Day(futureDay);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9',
      kind: 'SetDayMenu',
      dayId: futureDay,
      payload: {
        selectionDate: today,
        itemName: menu.itemName, price: menu.price, vendorId: menu.vendorId,
        vendorNameSnapshot: menu.vendorNameSnapshot, inheritedFromDate: today,
      },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.10: raw SetOpeningCash confirms zero then preserves the first actor and time', async () => {
    await seedBase();
    await seedP07Day(today);
    const first = await rawP07DayArtifacts({
      commandId: 'f7cccccc-cccc-4ccc-8ccc-cccccccccccc',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 0 },
    });
    await rawP07Batch(authedDb(operatorA), first).commit();
    const firstDay = await withAdmin(async db => {
      const snapshot = await getDoc(doc(db, `days/${today}`));
      return snapshot.data() as RawMap;
    });
    expect(firstDay.openingCash).toBe(0);
    expect(firstDay.openedBy).toBe(operatorA.uid);
    expect(firstDay.openedAt).toBeInstanceOf(Timestamp);
    const firstActor = firstDay.openedBy;
    const firstAt = firstDay.openedAt;
    const second = await rawP07DayArtifacts({
      commandId: 'f7dddddd-dddd-4ddd-8ddd-dddddddddddd',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 20000 },
    });
    await rawP07Batch(authedDb(operatorA), second).commit();
    const finalDay = await withAdmin(db => getDoc(doc(db, `days/${today}`)));
    expect(finalDay.data()).toMatchObject({ openingCash: 20000, openedBy: firstActor, openedAt: firstAt });
  });

  it('P07.10a: authenticated REST integerValue control accepts a valid SetOpeningCash commit', async () => {
    await seedBase();
    await seedP07Day(today);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7c11111-1111-4111-8111-111111111111',
      kind: 'SetOpeningCash',
      dayId: today,
      payload: { openingCash: 321 },
    });
    const response = await commitRawP07OpeningCashViaRest(artifacts);
    const responseBody = await response.text();
    expect(response.status, responseBody).toBe(200);
    const [head, day, command] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${today}`)),
      getDoc(doc(db, `commands/${artifacts.commandId}`)),
    ]));
    expect(head.data()).toMatchObject({ seq: 1, lastCommandId: artifacts.commandId });
    expect(day.data()).toMatchObject({ openingCash: 321, openedBy: operatorA.uid, revision: 2 });
    expect(day.data()?.openedAt).toBeInstanceOf(Timestamp);
    expect(command.data()).toMatchObject({ kind: 'SetOpeningCash', commandId: artifacts.commandId });
  });

  it.each([
    ['openingCash', 'f7c22222-2222-4222-8222-222222222222'],
    ['revision', 'f7c33333-3333-4333-8333-333333333333'],
  ] as const)(
    'P07.10b: authenticated REST doubleValue %s projection is denied atomically',
    async (doubleField, commandId) => {
      await seedBase();
      await seedP07Day(today);
      const artifacts = await rawP07DayArtifacts({
        commandId,
        kind: 'SetOpeningCash',
        dayId: today,
        payload: { openingCash: 321 },
      });
      const paths = ['system/dataHead', artifacts.targetPath, `commands/${artifacts.commandId}`];
      const before = await capturePaths(paths);
      const response = await commitRawP07OpeningCashViaRest(artifacts, [doubleField]);
      const responseBody = await response.text();
      expect(response.status, responseBody).toBe(403);
      expect(await capturePaths(paths)).toEqual(before);
    },
  );

  it.each([
    ['above the ceiling', 20001, today],
    ['fractionally', 1.5, today],
    ['unconfirmed null', null, today],
    ['on a future date', 0, shiftDate(today, 1)],
  ])('P07.11: raw SetOpeningCash rejects an amount %s atomically', async (_label, openingCash, targetDate) => {
    await seedBase();
    await seedP07Day(targetDate);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7eeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      kind: 'SetOpeningCash', dayId: targetDate, payload: { openingCash },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.12: raw SetOpeningCash rejects closed days and inconsistent unconfirmed metadata', async () => {
    await seedBase();
    await seedP07Day(today, { status: 'closed' });
    const closed = await rawP07DayArtifacts({
      commandId: 'f7f11111-1111-4111-8111-111111111111',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 100 },
    });
    await expectRawP07DeniedUnchanged(closed);

    await seedP07Day(today, { openingCash: null, openedBy: operatorA.uid, openedAt: Timestamp.fromDate(new Date()) });
    const malformed = await rawP07DayArtifacts({
      commandId: 'f7f22222-2222-4222-8222-222222222222',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 100 },
    });
    await expectRawP07DeniedUnchanged(malformed);
  });

  it.each(invalidDirectMenuCases)(
    'P07.13: direct menu assignment rejects a %s atomically', async (_label, status, snapshot, deleted) => {
    await seedBase({ withBusinessDocs: true });
    if (status !== null) await seedP07Vendor('p05-vendor', { name: 'Synthetic Vendor', status, deleted });
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7333333-3333-4333-8333-333333333334',
      kind: 'SetDayMenu', dayId: today,
      payload: {
        selectionDate: today, itemName: 'New Menu', price: 125,
        vendorId: 'p05-vendor', vendorNameSnapshot: snapshot, inheritedFromDate: null,
      },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it.each([
    ['future selection date', shiftDate(today, 1), today, 'Synthetic Vendor'],
    ['closed target day', today, today, 'Synthetic Vendor'],
    ['stale head sequence', today, today, 'Synthetic Vendor'],
    ['malformed target day ID', today, 'not-a-date', 'Synthetic Vendor'],
  ])('P07.14: SetDayMenu rejects a %s atomically', async (_label, selectionDate, dayId, vendorNameSnapshot) => {
    await seedBase({ withBusinessDocs: true });
    await seedP07Vendor('p05-vendor', { name: 'Synthetic Vendor' });
    if (dayId !== today) await seedP07Day(dayId);
    if (_label === 'closed target day') {
      await withAdmin(db => updateDoc(doc(db, `days/${dayId}`), { status: 'closed' }));
    }
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7444444-4444-4444-8444-444444444445',
      kind: 'SetDayMenu', dayId,
      expectedHeadSeq: _label === 'stale head sequence' ? 1 : undefined,
      payload: {
        selectionDate, itemName: 'New Menu', price: 125,
        vendorId: 'p05-vendor', vendorNameSnapshot, inheritedFromDate: null,
      },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.15: inheritance rejects a source whose vendor was renamed', async () => {
    await seedBase({ withBusinessDocs: true });
    await seedP07Vendor('p05-vendor', { name: 'Renamed Vendor' });
    const futureDay = shiftDate(today, 1);
    const ensured = await repository(operatorA).commitCommand({
      commandId: 'f7555555-5555-4555-8555-555555555556',
      kind: 'EnsureDay', leaseEpoch: 1,
      targets: { dayId: futureDay }, expectedRevisions: { day: 0 }, payload: { businessDate: futureDay },
    });
    expect(ensured.ok, JSON.stringify(ensured)).toBe(true);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7666666-6666-4666-8666-666666666667',
      kind: 'SetDayMenu', dayId: futureDay,
      payload: {
        selectionDate: today,
        itemName: menu.itemName, price: menu.price, vendorId: menu.vendorId,
        vendorNameSnapshot: menu.vendorNameSnapshot, inheritedFromDate: today,
      },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.16: inherited menus cannot cite a source after the selected date', async () => {
    await seedBase();
    await seedP07Vendor('p07-source-vendor');
    const sourceDate = shiftDate(today, 1);
    const targetDate = shiftDate(today, 2);
    await seedP07Day(sourceDate, {
      menu: {
        businessDate: sourceDate, itemName: 'Future Source', price: 125,
        vendorId: 'p07-source-vendor', vendorNameSnapshot: 'Synthetic Vendor',
        updatedAt: Timestamp.fromDate(new Date()), revision: 1, inheritedFromDate: null,
      },
    });
    await seedP07Day(targetDate);
    const artifacts = await rawP07DayArtifacts({
      commandId: 'f7777777-7777-4777-8777-777777777778',
      kind: 'SetDayMenu', dayId: targetDate,
      payload: {
        selectionDate: today,
        itemName: 'Future Source', price: 125, vendorId: 'p07-source-vendor',
        vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: sourceDate,
      },
    });
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P07.17: missing day writer, extra writes, and raw replay are denied atomically', async () => {
    await seedBase();
    await seedP07Day(today);
    const omitted = await rawP07DayArtifacts({
      commandId: 'f7888888-8888-4888-8888-888888888889',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 0 },
    });
    await expectRawP07DeniedUnchanged(omitted, { omit: ['target'] });
    const noHead = await rawP07DayArtifacts({
      commandId: 'f7899999-9999-4999-8999-999999999989',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 0 },
    });
    await expectRawP07DeniedUnchanged(noHead, { omit: ['head'] });
    const noCommand = await rawP07DayArtifacts({
      commandId: 'f7900000-0000-4000-8000-000000000090',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 0 },
    });
    await expectRawP07DeniedUnchanged(noCommand, { omit: ['command'] });
    const extra = await rawP07DayArtifacts({
      commandId: 'f7999999-9999-4999-8999-999999999990',
      kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 0 },
    });
    await expectRawP07DeniedUnchanged(extra, { extraPaths: ['vendors/p07-extra-write'] });
    const db = authedDb(operatorA);
    await rawP07Batch(db, extra).commit();
    const beforeReplay = await capturePaths(['system/dataHead', `days/${today}`, `commands/${extra.commandId}`]);
    await assertFails(rawP07Batch(db, extra).commit());
    expect(await capturePaths(['system/dataHead', `days/${today}`, `commands/${extra.commandId}`])).toEqual(beforeReplay);
  });

  it.each(invalidOpeningCommandMutations)(
    'P07.19: raw SetOpeningCash rejects a forged %s with all state unchanged', async (_label, mutate) => {
      await seedBase();
      await seedP07Day(today);
      const artifacts = await rawP07DayArtifacts({
        commandId: 'f7aaaaaa-aaaa-4aaa-8aaa-aaaaaaaabbbb',
        kind: 'SetOpeningCash', dayId: today, payload: { openingCash: 0 },
      });
      mutate(artifacts);
      await expectRawP07DeniedUnchanged(artifacts);
    },
  );

  it('P07.20: raw direct deletes remain denied for vendors and business days', async () => {
    await seedBase();
    await seedP07Vendor('p07-delete-vendor', { status: 'inactive' });
    await seedP07Day(today);
    const paths = ['system/dataHead', 'days/' + today, 'vendors/p07-delete-vendor'];
    const before = await capturePaths(paths);
    const db = authedDb(operatorA);
    const dayDelete = writeBatch(db);
    dayDelete.delete(doc(db, `days/${today}`));
    await assertFails(dayDelete.commit());
    const vendorDelete = writeBatch(db);
    vendorDelete.delete(doc(db, 'vendors/p07-delete-vendor'));
    await assertFails(vendorDelete.commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P07.21: later menu and vendor changes preserve an order’s frozen snapshots and financial totals', async () => {
    await seedBase({ withBusinessDocs: true });
    const vendorId = 'p05-vendor';
    const removeCommandId = 'f7666666-6666-4666-8666-666666666666';
    const vendorCreate = await repository(operatorA).commitCommand({
      commandId: 'f7211111-1111-4111-8111-111111111111',
      kind: 'SaveVendor', leaseEpoch: 1, targets: { vendorId },
      expectedRevisions: { vendor: 0 },
      payload: { vendorId, name: 'Synthetic Vendor', phone: '', note: '', status: 'active' },
    });
    expect(vendorCreate.ok, JSON.stringify(vendorCreate)).toBe(true);

    const order = await repository(operatorA).commitCommand(
      orderInput('f7222222-2222-4222-8222-222222222222', 'p07-snapshot-order'),
    );
    expect(order.ok, JSON.stringify(order)).toBe(true);
    const orderState = await withAdmin(async db => {
      const [head, student, day, transaction] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, 'transactions/p07-snapshot-order')),
      ]);
      return {
        head: head.data() as RawMap,
        student: student.data() as RawMap,
        day: day.data() as RawMap,
        transaction: transaction.data() as RawMap,
      };
    });
    expect(orderState.transaction).toMatchObject({
      menuNameSnapshot: 'Synthetic Bento', menuPriceSnapshot: 100,
      vendorIdSnapshot: vendorId, vendorNameSnapshot: 'Synthetic Vendor',
    });
    expect(orderState.student).toMatchObject({ currentBalance: 10, revision: 2 });
    expect(orderState.day).toMatchObject({
      revision: 2,
      totals: { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 100, retainedReceipts: 110 },
    });

    const menuUpdate = await repository(operatorA).commitCommand({
      commandId: 'f7333333-3333-4333-8333-333333333333',
      kind: 'SetDayMenu', leaseEpoch: 1, targets: { dayId },
      expectedRevisions: { day: 2, headSeq: 2 },
      payload: {
        selectionDate: today, itemName: 'Updated Bento', price: 125,
        vendorId, vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null,
      },
    });
    expect(menuUpdate.ok, JSON.stringify(menuUpdate)).toBe(true);

    const rename = await repository(operatorA).commitCommand({
      commandId: 'f7444444-4444-4444-8444-444444444444',
      kind: 'SaveVendor', leaseEpoch: 1, targets: { vendorId },
      expectedRevisions: { vendor: 1 },
      payload: { vendorId, name: 'Renamed Vendor', phone: '', note: '', status: 'active' },
    });
    expect(rename.ok, JSON.stringify(rename)).toBe(true);
    const deactivate = await repository(operatorA).commitCommand({
      commandId: 'f7555555-5555-4555-8555-555555555555',
      kind: 'SaveVendor', leaseEpoch: 1, targets: { vendorId },
      expectedRevisions: { vendor: 2 },
      payload: { vendorId, name: 'Renamed Vendor', phone: '', note: '', status: 'inactive' },
    });
    expect(deactivate.ok, JSON.stringify(deactivate)).toBe(true);
    const remove = await repository(operatorA).commitCommand({
      commandId: removeCommandId,
      kind: 'RemoveVendor', leaseEpoch: 1, targets: { vendorId },
      expectedRevisions: { vendor: 3 }, payload: { reason: 'Vendor retired' },
    });
    expect(remove.ok, JSON.stringify(remove)).toBe(true);

    const finalState = await withAdmin(async db => {
      const [head, student, day, transaction, vendor] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, 'transactions/p07-snapshot-order')),
        getDoc(doc(db, `vendors/${vendorId}`)),
      ]);
      return {
        head: head.data() as RawMap,
        student: student.data() as RawMap,
        day: day.data() as RawMap,
        transaction: transaction.data() as RawMap,
        vendor: vendor.data() as RawMap,
      };
    });
    expect(finalState.head).toMatchObject({ seq: 6, lastCommandId: removeCommandId });
    expect(finalState.transaction).toMatchObject({
      menuNameSnapshot: 'Synthetic Bento', menuPriceSnapshot: 100,
      vendorIdSnapshot: vendorId, vendorNameSnapshot: 'Synthetic Vendor',
    });
    expect(finalState.day).toMatchObject({
      revision: 3,
      menu: {
        businessDate: dayId, itemName: 'Updated Bento', price: 125,
        vendorId, vendorNameSnapshot: 'Synthetic Vendor',
      },
      totals: { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 100, retainedReceipts: 110 },
    });
    expect(finalState.student).toMatchObject({ currentBalance: 10, revision: 2 });
    expect(finalState.vendor).toMatchObject({ name: 'Renamed Vendor', status: 'inactive', deleted: true, revision: 4 });
  });

  it('P07.18: raw RemoveVendor requires matching top-level and payload reasons', async () => {
    await seedBase();
    await seedP07Vendor('p07-reason-vendor', { status: 'inactive' });
    const artifacts = await rawP07VendorArtifacts({
      commandId: 'f7fffff7-ffff-4fff-8fff-fffffffffff7',
      kind: 'RemoveVendor',
      vendorId: 'p07-reason-vendor',
      payload: { reason: 'Correct reason' },
    });
    artifacts.command.reason = 'Different reason';
    await expectRawP07DeniedUnchanged(artifacts);
  });

  it('P06.3: creates UUID studentId with studentCode index, baseline/current opening dates, signed boundaries, and no financial side effects', async () => {
    await seedBase();
    const goLiveDate = shiftDate(today, -20);
    await withAdmin(db => updateDoc(doc(db, 'system/dataHead'), { goLiveDate }));
    const aliases = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(2, '0')}${'a'.repeat(98)}`);
    const inputs = [
      studentInput('f2111111-1111-4111-8111-111111111111', sid001, 0, goLiveDate, 'Same Name', aliases, '001'),
      studentInput('f2222222-2222-4222-8222-222222222222', sid002, -1_000_000_000, today, 'Same Name', [], '002'),
      studentInput('f2333333-3333-4333-8333-333333333333', sid003, 1_000_000_000, goLiveDate, 'Same Name', [], '003'),
    ];
    const results = [];
    for (const input of inputs) results.push(await repository(operatorA).commitCommand(input));
    expect(results.map(result => result.ok)).toEqual([true, true, true]);
    const state = await withAdmin(async db => {
      const [head, students, codes, commands, transactions, days] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        Promise.all([sid001, sid002, sid003].map(id => getDoc(doc(db, `students/${id}`)))),
        Promise.all(['001', '002', '003'].map(c => getDoc(doc(db, `studentCodes/${c}`)))),
        getDocs(collection(db, 'commands')),
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'days')),
      ]);
      return { head: head.data(), students: students.map(snapshot => snapshot.data()), codes: codes.map(snapshot => snapshot.data()), commands, transactions, days };
    });
    expect(state.head).toMatchObject({ seq: 3, lastCommandId: inputs[2].commandId });
    expect(state.students.map(student => student?.studentId)).toEqual([sid001, sid002, sid003]);
    expect(state.students.map(student => student?.studentCode)).toEqual(['001', '002', '003']);
    expect(state.codes.map(code => code?.studentId)).toEqual([sid001, sid002, sid003]);
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

  it('P06.4: semantic replay returns the original receipt; ID collision and duplicate student code do not advance state', async () => {
    await seedBase();
    const repo = repository(operatorA);
    const input = studentInput('f3111111-1111-4111-8111-111111111111', sid001, -25, today, 'Synthetic Student', [], '001');
    const first = await repo.commitCommand(input);
    const replay = await repo.commitCommand(input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(replay).toEqual(first);
    const collision = await repo.commitCommand({ ...input, payload: { ...input.payload, openingBalance: { ...input.payload.openingBalance, amount: 20 } } });
    expect(collision).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const duplicateCode = await repo.commitCommand(studentInput('f3222222-2222-4222-8222-222222222222', sid002, 0, today, 'Other Student', [], '001'));
    expect(duplicateCode).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const state = await withAdmin(async db => {
      const [head, student, codeIndex, commands] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${sid001}`)),
        getDoc(doc(db, 'studentCodes/001')),
        getDocs(collection(db, 'commands')),
      ]);
      return { head: head.data(), student: student.data(), codeIndex: codeIndex.data(), commandCount: commands.size };
    });
    expect(state).toMatchObject({
      head: { seq: 1, lastCommandId: input.commandId },
      student: { studentId: sid001, studentCode: '001', currentBalance: -25, revision: 1 },
      codeIndex: { studentId: sid001, lastCommandId: input.commandId },
      commandCount: 1,
    });
  });

  it('P06.5: only EditStudent fields and explicit status changes advance the student revision', async () => {
    await seedBase();
    const create = await repository(operatorA).commitCommand(studentInput('f4111111-1111-4111-8111-111111111111', sid001, -25, today, 'Synthetic Student', [], '001'));
    expect(create.ok, JSON.stringify(create)).toBe(true);
    const edit = await repository(operatorA).commitCommand({
      commandId: 'f4222222-2222-4222-8222-222222222222', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 1 },
      payload: { displayName: 'Renamed Synthetic', aliases: ['A', 'B'] },
    });
    expect(edit.ok, JSON.stringify(edit)).toBe(true);
    const deactivate = await repository(operatorA).commitCommand({
      commandId: 'f4333333-3333-4333-8333-333333333333', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 2 },
      payload: { status: 'inactive', reason: 'Synthetic roster correction' },
    });
    expect(deactivate.ok, JSON.stringify(deactivate)).toBe(true);
    if (deactivate.ok) expect(await repository(operatorA).readCommand('f4333333-3333-4333-8333-333333333333')).toMatchObject({ kind: 'SetStudentStatus', seq: 3 });
    const reactivate = await repository(operatorA).commitCommand({
      commandId: 'f4444444-4444-4444-8444-444444444444', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 3 },
      payload: { status: 'active', reason: 'Synthetic roster restore' },
    });
    expect(reactivate.ok, JSON.stringify(reactivate)).toBe(true);
    const noOpEdit = await repository(operatorA).commitCommand({
      commandId: 'f4555555-5555-4555-8555-555555555555', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 4 },
      payload: { displayName: 'Renamed Synthetic' },
    });
    const noOpStatus = await repository(operatorA).commitCommand({
      commandId: 'f4666666-6666-4666-8666-666666666666', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 4 },
      payload: { status: 'active', reason: 'No actual status change' },
    });
    const stale = await repository(operatorA).commitCommand({
      commandId: 'f4777777-7777-4777-8777-777777777777', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 3 },
      payload: { displayName: 'Stale Writer' },
    });
    expect(noOpEdit).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(noOpStatus).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(stale).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    const [head, student, tx, day] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `students/${sid001}`)),
      getDocs(collection(db, 'transactions')),
      getDocs(collection(db, 'days')),
    ]));
    expect(head.data()).toMatchObject({ seq: 4, lastCommandId: 'f4444444-4444-4444-8444-444444444444' });
    expect(student.data()).toMatchObject({
      studentId: sid001, studentCode: '001', displayName: 'Renamed Synthetic', aliases: ['A', 'B'], status: 'active',
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
    const input = studentInput('f5111111-1111-4111-8111-111111111111', sid001, 0, date, 'Synthetic Student', [], '001');
    const result = await repository(operatorA).commitCommand(input);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await capturePaths(['system/dataHead', `students/${sid001}`, 'studentCodes/001', `commands/${input.commandId}`])).toMatchObject({
      'system/dataHead': { exists: true },
      [`students/${sid001}`]: { exists: false },
      'studentCodes/001': { exists: false },
    });
  });

  it('P06.7: production Rules accept a complete raw SDK CreateStudent closure with ten maximum-length aliases', async () => {
    await seedBase();
    const aliases = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(2, '0')}${'b'.repeat(98)}`);
    const artifacts = await rawStudentCreateArtifacts(studentInput(
      'f6111111-1111-4111-8111-111111111111', sid001, 0, today, 'Raw Synthetic', aliases, '001',
    ));
    const paths = ['system/dataHead', `students/${sid001}`, 'studentCodes/001', `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await rawStudentCreateBatch(authedDb(operatorA), artifacts).commit();
    const after = await capturePaths(paths);
    expect(after['system/dataHead'].data).toMatchObject({ seq: 1, lastCommandId: artifacts.commandId });
    expect((after[`students/${sid001}`].data as RawMap).aliases).toEqual(aliases);
    expect(after['studentCodes/001'].data).toMatchObject({ studentId: sid001, lastCommandId: artifacts.commandId });
    expect(after[`commands/${artifacts.commandId}`].exists).toBe(true);
    expect(after['system/dataHead'].data).not.toEqual(before['system/dataHead'].data);
  });

  it.each([
    ['head writer', ['head'] as const],
    ['student writer', ['student'] as const],
    ['codeIndex writer', ['codeIndex'] as const],
  ])('P06.8: Rules reject CreateStudent when the raw batch omits its %s', async (_label, omit) => {
    await seedBase();
    const artifacts = await rawStudentCreateArtifacts(studentInput(
      'f6222222-2222-4222-8222-222222222222', sid001, 0, today, 'Raw Synthetic', [], '001',
    ));
    const paths = ['system/dataHead', `students/${artifacts.studentId}`, `studentCodes/${artifacts.studentCode}`, `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await assertFails(rawStudentCreateBatch(authedDb(operatorA), artifacts, { omit: [...omit] }).commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P06.9: Rules require an actually absent target when raw SDK creates a student ID', async () => {
    await seedBase();
    expect((await repository(operatorA).commitCommand(studentInput('f7111111-1111-4111-8111-111111111111', sid001, 0, today, 'Synthetic Student', [], '001'))).ok).toBe(true);
    const artifacts = await rawStudentCreateArtifacts(
      studentInput('f7222222-2222-4222-8222-222222222222', sid001, 0, today, 'Synthetic Student', [], '001'),
      true,
    );
    const paths = ['system/dataHead', `students/${sid001}`, 'studentCodes/001', `commands/${artifacts.commandId}`];
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
    const paths = ['system/dataHead', `students/${artifacts.studentId}`, `studentCodes/${artifacts.studentCode}`, `commands/${artifacts.commandId}`];
    const before = await capturePaths(paths);
    await assertFails(rawStudentCreateBatch(authedDb(operatorA), artifacts).commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P06.11: a student document can be read before creation and the holder can read the complete server list', async () => {
    await seedBase();
    const db = authedDb(operatorA);
    expect((await getDoc(doc(db, `students/${sid001}`))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'studentCodes/001'))).exists()).toBe(false);
    expect((await getDocs(collection(db, 'students'))).size).toBe(0);
    expect((await repository(operatorA).commitCommand(studentInput('f8111111-1111-4111-8111-111111111111', sid001, 0, today, 'Synthetic Student', [], '001'))).ok).toBe(true);
    expect((await getDocs(collection(db, 'students'))).docs.map(snapshot => snapshot.id)).toEqual([sid001]);
    expect((await getDoc(doc(db, 'studentCodes/001'))).exists()).toBe(true);
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
      const code = (index + 1).toString().padStart(3, '0');
      const artifacts = await rawStudentCreateArtifacts(studentInput(commandId, studentId, 0, today, displayName, [], code));
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

  it('P06b.1: ChangeStudentCode advances studentCode, updates index, deletes old index, and frees old code', async () => {
    await seedBase();
    const repo = repository(operatorA);
    const create = await repo.commitCommand(studentInput('fa111111-1111-4111-8111-111111111111', sid001, 0, today, 'Student One', [], '001'));
    expect(create.ok, JSON.stringify(create)).toBe(true);

    const change = await repo.commitCommand(changeStudentCodeInput(
      'fa222222-2222-4222-8222-222222222222', sid001, '015', 1, '換號至十五號',
    ));
    expect(change.ok, JSON.stringify(change)).toBe(true);

    const db = authedDb(operatorA);
    const [studentSnap, oldIndexSnap, newIndexSnap, headSnap] = await Promise.all([
      getDoc(doc(db, `students/${sid001}`)),
      getDoc(doc(db, 'studentCodes/001')),
      getDoc(doc(db, 'studentCodes/015')),
      getDoc(doc(db, 'system/dataHead')),
    ]);

    expect(studentSnap.data()).toMatchObject({
      studentId: sid001,
      studentCode: '015',
      revision: 2,
      lastCommandId: 'fa222222-2222-4222-8222-222222222222',
    });
    expect(oldIndexSnap.exists()).toBe(false);
    expect(newIndexSnap.data()).toMatchObject({
      studentId: sid001,
      lastCommandId: 'fa222222-2222-4222-8222-222222222222',
    });
    expect(headSnap.data()).toMatchObject({ seq: 2 });

    // Verify freed code 001 can now be used by a new student
    const create2 = await repo.commitCommand(studentInput('fa333333-3333-4333-8333-333333333333', sid002, 0, today, 'Student Two', [], '001'));
    expect(create2.ok, JSON.stringify(create2)).toBe(true);
    const reusedIndex = await getDoc(doc(db, 'studentCodes/001'));
    expect(reusedIndex.data()).toMatchObject({ studentId: sid002 });
  });

  it('P06b.2: ChangeStudentCode is allowed on inactive students to release code', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa411111-1111-4111-8111-111111111111', sid001, 0, today, 'To Inactive', [], '001'));
    await repo.commitCommand({
      commandId: 'fa422222-2222-4222-8222-222222222222', kind: 'SetStudentStatus', leaseEpoch: 1,
      targets: { studentId: sid001 }, expectedRevisions: { student: 1 },
      payload: { status: 'inactive', reason: '畢業停用' },
    });

    const change = await repo.commitCommand(changeStudentCodeInput(
      'fa433333-3333-4333-8333-333333333333', sid001, '999', 2, '停用學生退讓號碼',
    ));
    expect(change.ok, JSON.stringify(change)).toBe(true);

    const db = authedDb(operatorA);
    const studentDoc = await getDoc(doc(db, `students/${sid001}`));
    expect(studentDoc.data()).toMatchObject({
      studentId: sid001,
      studentCode: '999',
      status: 'inactive',
      revision: 3,
    });
    expect((await getDoc(doc(db, 'studentCodes/001'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'studentCodes/999'))).exists()).toBe(true);
  });

  it('P06b.3: ChangeStudentCode rejects collision when target code is already occupied', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa511111-1111-4111-8111-111111111111', sid001, 0, today, 'Student 1', [], '001'));
    await repo.commitCommand(studentInput('fa522222-2222-4222-8222-222222222222', sid002, 0, today, 'Student 2', [], '002'));

    const collision = await repo.commitCommand(changeStudentCodeInput(
      'fa533333-3333-4333-8333-333333333333', sid001, '002', 1, '搶號測試',
    ));
    expect(collision).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('P06b.4: ChangeStudentCode semantic replay returns original receipt', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa611111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const input = changeStudentCodeInput('fa622222-2222-4222-8222-222222222222', sid001, '015', 1, '正常改號');
    const first = await repo.commitCommand(input);
    const replay = await repo.commitCommand(input);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(replay).toEqual(first);
  });

  it('P06b.5: raw SDK ChangeStudentCode accepts complete valid batch and denies missing writers atomically', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa711111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fa722222-2222-4222-8222-222222222222', sid001, '015', 1, 'Raw 改號',
    ));
    await rawStudentChangeCodeBatch(authedDb(operatorA), artifacts).commit();

    const db = authedDb(operatorA);
    expect((await getDoc(doc(db, `students/${sid001}`))).data()).toMatchObject({ studentCode: '015', revision: 2 });
    expect((await getDoc(doc(db, 'studentCodes/001'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'studentCodes/015'))).exists()).toBe(true);
  });

  it('P06b.6: raw SDK ChangeStudentCode fails and leaves state unchanged when omitting old index delete', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa811111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fa822222-2222-4222-8222-222222222222', sid001, '015', 1, '漏刪舊索引',
    ));
    await expectRawStudentChangeCodeDeniedUnchanged(artifacts, { omit: ['oldIndex'] });
  });

  it('P06b.6b: raw ChangeStudentCode fails closed when old index was missing beforehand and delete writer is omitted', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa833333-3333-4333-8333-333333333333', sid001, 0, today, 'Student', [], '001'));

    // Simulate inconsistent prior state: old index was deleted beforehand by admin
    await withAdmin(db => deleteDoc(doc(db, 'studentCodes/001')));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fa844444-4444-4444-8444-444444444444', sid001, '015', 1, '無舊索引前態省略刪除',
    ));
    const paths = [
      'system/dataHead',
      `students/${artifacts.studentId}`,
      `studentCodes/${artifacts.newCode}`,
      `commands/${artifacts.commandId}`,
    ];
    const before = await capturePaths(paths);
    await assertFails(rawStudentChangeCodeBatch(authedDb(operatorA), artifacts, { omit: ['oldIndex'] }).commit());
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P06b.7: raw SDK ChangeStudentCode fails and leaves state unchanged when omitting new index create', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fa911111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fa922222-2222-4222-8222-222222222222', sid001, '015', 1, '漏建新索引',
    ));
    await expectRawStudentChangeCodeDeniedUnchanged(artifacts, { omit: ['newIndex'] });
  });

  it('P06b.8: isolated studentCodes delete is denied by Rules', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fb011111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const db = authedDb(operatorA);
    await assertFails(deleteDoc(doc(db, 'studentCodes/001')));
    expect((await getDoc(doc(db, 'studentCodes/001'))).exists()).toBe(true);
  });

  it('P06b.9: deleting another student code index in ChangeStudentCode is denied by Rules', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fb111111-1111-4111-8111-111111111111', sid001, 0, today, 'Student 1', [], '001'));
    await repo.commitCommand(studentInput('fb222222-2222-4222-8222-222222222222', sid002, 0, today, 'Student 2', [], '002'));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fb333333-3333-4333-8333-333333333333', sid001, '015', 1, '刪別人索引',
    ));
    artifacts.oldCode = '002';
    await expectRawStudentChangeCodeDeniedUnchanged(artifacts);
  });

  it('P06b.10: replaying historical command or forged student lastCommandId for delete is denied', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fb411111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fb555555-5555-4555-8555-555555555555', sid001, '015', 1, '偽造命令',
    ));
    artifacts.studentAfter.lastCommandId = 'fb411111-1111-4111-8111-111111111111';
    await expectRawStudentChangeCodeDeniedUnchanged(artifacts);
  });

  it('P06b.11: extra index writer in the same transaction is denied', async () => {
    await seedBase();
    const repo = repository(operatorA);
    await repo.commitCommand(studentInput('fb611111-1111-4111-8111-111111111111', sid001, 0, today, 'Student', [], '001'));

    const artifacts = await rawStudentChangeCodeArtifacts(changeStudentCodeInput(
      'fb777777-7777-4777-8777-777777777777', sid001, '015', 1, '額外寫入者',
    ));
    await assertFails(rawStudentChangeCodeBatch(authedDb(operatorA), artifacts, { extraIndex: true }).commit());
    expect((await getDoc(doc(authedDb(operatorA), 'studentCodes/999'))).exists()).toBe(false);
  });

  it('P06b.12: production Rules accept maximum legal payload with 10 max aliases, 500-char note and reason without hitting expression ceiling', async () => {
    await seedBase();
    const repo = repository(operatorA);
    const maxAliases = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(2, '0')}${'x'.repeat(98)}`);
    const maxReason = 'R'.repeat(500);

    const create = await repo.commitCommand(studentInput(
      'fc111111-1111-4111-8111-111111111111',
      sid001,
      0,
      today,
      'M'.repeat(100),
      maxAliases,
      '001',
    ));
    expect(create.ok, JSON.stringify(create)).toBe(true);

    const change = await repo.commitCommand(changeStudentCodeInput(
      'fc222222-2222-4222-8222-222222222222',
      sid001,
      '015',
      1,
      maxReason,
    ));
    expect(change.ok, JSON.stringify(change)).toBe(true);

    const db = authedDb(operatorA);
    const studentDoc = await getDoc(doc(db, `students/${sid001}`));
    expect(studentDoc.data()).toMatchObject({
      studentId: sid001,
      studentCode: '015',
      revision: 2,
    });
    expect((await getDoc(doc(db, 'studentCodes/001'))).exists()).toBe(false);
    expect((await getDoc(doc(db, 'studentCodes/015'))).exists()).toBe(true);
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

  it('P08.1: legal bento CreateOrder with UUID studentId advances day totals and student balance atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const commandId = 'b8011111-1111-4111-8111-111111111111';
    const txId = 'b8012222-2222-4222-8222-222222222222';
    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: txId, studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'bento',
        mealPrice: 100,
        paidAmount: 110,
        menuRevision: 1,
        otherItemName: null,
        note: 'P08 bento order',
      },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const db = authedDb(operatorA);
    const headDoc = await getDoc(doc(db, 'system/dataHead'));
    const studentDoc = await getDoc(doc(db, `students/${studentId}`));
    const dayDoc = await getDoc(doc(db, `days/${dayId}`));
    const txDoc = await getDoc(doc(db, `transactions/${txId}`));
    const cmdDoc = await getDoc(doc(db, `commands/${commandId}`));

    expect(headDoc.data()?.seq).toBe(1);
    expect(headDoc.data()?.lastCommandId).toBe(commandId);

    expect(studentDoc.data()).toMatchObject({
      studentId,
      studentCode: '001',
      currentBalance: 10,
      revision: 2,
      lastCommandId: commandId,
    });

    expect(dayDoc.data()?.totals).toMatchObject({
      activeTransactionCount: 1,
      bentoCount: 1,
      otherMealCount: 0,
      mealTotal: 100,
      retainedReceipts: 110,
    });

    expect(txDoc.data()).toMatchObject({
      transactionId: txId,
      studentId,
      businessDate: dayId,
      type: 'order',
      mealKind: 'bento',
      mealPrice: 100,
      paidAmount: 110,
      amount: 10,
      menuNameSnapshot: 'Synthetic Bento',
      otherItemName: null,
      status: 'active',
      revision: 1,
      lastCommandId: commandId,
    });

    expect(cmdDoc.data()).toMatchObject({
      commandId,
      kind: 'CreateOrder',
      seq: 1,
      targets: { transactionId: txId, studentId, dayId },
    });
  });

  it('P08.2: legal other meal CreateOrder with custom name and zero paid amount creates debit atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const commandId = 'b8021111-1111-4111-8111-111111111111';
    const txId = 'b8022222-2222-4222-8222-222222222222';
    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: txId, studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'other',
        mealPrice: 80,
        paidAmount: 0,
        menuRevision: null,
        otherItemName: '素食炒麵',
        note: 'zero paid other meal',
      },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);

    const db = authedDb(operatorA);
    const studentDoc = await getDoc(doc(db, `students/${studentId}`));
    const dayDoc = await getDoc(doc(db, `days/${dayId}`));
    const txDoc = await getDoc(doc(db, `transactions/${txId}`));

    expect(studentDoc.data()?.currentBalance).toBe(-80);
    expect(studentDoc.data()?.revision).toBe(2);

    expect(dayDoc.data()?.totals).toMatchObject({
      activeTransactionCount: 1,
      bentoCount: 0,
      otherMealCount: 1,
      mealTotal: 80,
      retainedReceipts: 0,
    });

    expect(txDoc.data()).toMatchObject({
      transactionId: txId,
      type: 'order',
      mealKind: 'other',
      mealPrice: 80,
      paidAmount: 0,
      amount: -80,
      menuNameSnapshot: '',
      otherItemName: '素食炒麵',
      status: 'active',
    });
  });

  it('P08.3: ordering bento when day menu is null is rejected atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(async db => {
      await updateDoc(doc(db, `days/${dayId}`), { menu: null });
    });

    const repo = repository(operatorA);
    const commandId = 'b8031111-1111-4111-8111-111111111111';
    const txId = 'b8032222-2222-4222-8222-222222222222';
    const paths = ['system/dataHead', `students/${studentId}`, `days/${dayId}`, `commands/${commandId}`, `transactions/${txId}`];
    const before = await capturePaths(paths);

    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: txId, studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'bento',
        mealPrice: 100,
        paidAmount: 100,
        menuRevision: 1,
        otherItemName: null,
        note: '',
      },
    });

    expect(result.ok).toBe(false);
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P08.4: ordering other meal when day menu is null is accepted atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(async db => {
      await updateDoc(doc(db, `days/${dayId}`), { menu: null });
    });

    const repo = repository(operatorA);
    const commandId = 'b8041111-1111-4111-8111-111111111111';
    const txId = 'b8042222-2222-4222-8222-222222222222';

    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: txId, studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'other',
        mealPrice: 65,
        paidAmount: 65,
        menuRevision: null,
        otherItemName: '特製湯麵',
        note: '',
      },
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);

    const db = authedDb(operatorA);
    const txDoc = await getDoc(doc(db, `transactions/${txId}`));
    expect(txDoc.data()).toMatchObject({
      transactionId: txId,
      mealKind: 'other',
      otherItemName: '特製湯麵',
      mealPrice: 65,
    });
  });

  it('P08.5: bento order with stale menuRevision is rejected as REVISION_CONFLICT', async () => {
    await seedBase({ withBusinessDocs: true });
    await withAdmin(async db => {
      await updateDoc(doc(db, `days/${dayId}`), {
        'menu.revision': 2,
        'menu.price': 120,
        revision: 2,
      });
    });

    const repo = repository(operatorA);
    const commandId = 'b8051111-1111-4111-8111-111111111111';
    const txId = 'b8052222-2222-4222-8222-222222222222';
    const paths = ['system/dataHead', `students/${studentId}`, `days/${dayId}`, `commands/${commandId}`, `transactions/${txId}`];
    const before = await capturePaths(paths);

    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: txId, studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 2 },
      payload: {
        mealKind: 'bento',
        mealPrice: 100,
        paidAmount: 100,
        menuRevision: 1, // stale
        otherItemName: null,
        note: '',
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P08.6: other meal carrying menuRevision or empty otherItemName is rejected atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const commandId1 = 'b8061111-1111-4111-8111-111111111111';
    const commandId2 = 'b8062222-2222-4222-8222-222222222222';
    const paths = ['system/dataHead', `students/${studentId}`, `days/${dayId}`];
    const before = await capturePaths(paths);

    const withMenuRev = await repo.commitCommand({
      commandId: commandId1,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: 'tx-bad-1', studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'other',
        mealPrice: 80,
        paidAmount: 80,
        menuRevision: 1, // invalid for other
        otherItemName: '炒麵',
        note: '',
      },
    });
    expect(withMenuRev.ok).toBe(false);

    const withEmptyName = await repo.commitCommand({
      commandId: commandId2,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: 'tx-bad-2', studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'other',
        mealPrice: 80,
        paidAmount: 80,
        menuRevision: null,
        otherItemName: '   ', // empty
        note: '',
      },
    });
    expect(withEmptyName.ok).toBe(false);
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P08.7: bento order carrying otherItemName is rejected atomically', async () => {
    await seedBase({ withBusinessDocs: true });
    const repo = repository(operatorA);
    const commandId = 'b8071111-1111-4111-8111-111111111111';
    const paths = ['system/dataHead', `students/${studentId}`, `days/${dayId}`];
    const before = await capturePaths(paths);

    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: 'tx-bad-bento', studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'bento',
        mealPrice: 100,
        paidAmount: 100,
        menuRevision: 1,
        otherItemName: '不該存在的品名',
        note: '',
      },
    });
    expect(result.ok).toBe(false);
    expect(await capturePaths(paths)).toEqual(before);
  });

  it('P08.8: legal maximum payload (100-char otherItemName, 500-char note, 100-char student name) does not hit 1,000-expression ceiling', async () => {
    await seedBase({ withBusinessDocs: true });
    const maxName = '姓'.repeat(50) + '名'.repeat(50);
    const maxOther = '餐'.repeat(50) + '點'.repeat(50);
    const maxNote = '備註說明'.repeat(125); // 500 chars

    await withAdmin(async db => {
      await updateDoc(doc(db, `students/${studentId}`), {
        displayName: maxName,
      });
    });

    const repo = repository(operatorA);
    const commandId = 'b8081111-1111-4111-8111-111111111111';
    const txId = 'b8082222-2222-4222-8222-222222222222';

    const result = await repo.commitCommand({
      commandId,
      kind: 'CreateOrder',
      leaseEpoch: 1,
      targets: { transactionId: txId, studentId, dayId },
      expectedRevisions: { transaction: 0, student: 1, day: 1 },
      payload: {
        mealKind: 'other',
        mealPrice: 999_999,
        paidAmount: 999_999,
        menuRevision: null,
        otherItemName: maxOther,
        note: maxNote,
      },
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);

    const db = authedDb(operatorA);
    const txDoc = await getDoc(doc(db, `transactions/${txId}`));
    expect(txDoc.data()?.studentNameSnapshot).toBe(maxName);
    expect(txDoc.data()?.otherItemName).toBe(maxOther);
    expect(txDoc.data()?.note).toBe(maxNote);
  });
});
