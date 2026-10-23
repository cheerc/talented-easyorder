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
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fingerprintCommandInput, normalizeEnabledCommandInput } from '../../domain/cloudCommandSchema';
import { expectedCashFromTotals } from '../../domain/cloudLedgerProjection';
import {
  createCloudOrderRepository,
  type CreateCloudCashMovementInput,
  type CreateCloudOrderInput,
  type CreateCloudPaymentInput,
  type CreateCloudRefundInput,
} from '../cloudOrderRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_REFUND === 'true';
if (required && !emulatorHost) throw new Error('P09b refund Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p09b-refund-a', email: 'p09b-refund-a@example.test', displayName: 'Synthetic Refund A', active: true };
const operatorB = { uid: 'p09b-refund-b', email: 'p09b-refund-b@example.test', displayName: 'Synthetic Refund B', active: true };
const studentA = '11111111-1111-4111-8111-111111111111';
const studentB = '22222222-2222-4222-8222-222222222222';
const seedCommandId = '00000000-0000-4000-8000-000000000009';

let env: RulesTestEnvironment;
let today = '';

// Emulator fixtures deliberately mutate nested Firestore maps to model raw SDK clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- map fields vary by attack case
type RawMap = Record<string, any>;

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

function repository(operator: typeof operatorA = operatorA) {
  return createCloudOrderRepository(authedDb(operator), { currentUser: () => fakeCurrentUser(operator) });
}

function student(studentId: string, code: string, opening: number, displayName = `Synthetic ${code}`) {
  return {
    studentId, studentCode: code, displayName, aliases: [], status: 'active',
    openingBalance: { amount: opening, asOfDate: shiftDate(today, -1), note: '', createdAt: serverTimestamp() },
    currentBalance: opening, createdAt: serverTimestamp(), revision: 1,
    lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

function emptyTotals() {
  return {
    activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
    retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
  };
}

function dayDoc(options: { status?: 'open' | 'closed' | 'reopened'; openingCash?: number | null; date?: string } = {}) {
  const openingCash = options.openingCash === undefined ? 1000 : options.openingCash;
  return {
    status: options.status ?? 'open', revision: 1,
    menu: {
      businessDate: options.date ?? today, itemName: 'Synthetic Meal', price: 90, vendorId: 'p09-vendor',
      vendorNameSnapshot: 'Synthetic Vendor', updatedAt: serverTimestamp(), revision: 1, inheritedFromDate: null,
    },
    openingCash,
    openedBy: openingCash === null ? null : operatorA.uid,
    openedAt: openingCash === null ? null : serverTimestamp(),
    totals: emptyTotals(),
    lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

async function seed(options: { dayStatus?: 'open' | 'closed' | 'reopened'; studentName?: string } = {}) {
  today = taipeiDate(new Date());
  await withAdmin(async db => {
    await setDoc(doc(db, `operators/${operatorA.uid}`), { ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, `operators/${operatorB.uid}`), { ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: operatorA.uid, epoch: 1, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p09b-refund-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: shiftDate(today, -30), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `students/${studentA}`), student(studentA, '001', 100, options.studentName));
    await setDoc(doc(db, 'studentCodes/001'), { studentId: studentA, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `students/${studentB}`), student(studentB, '002', 0));
    await setDoc(doc(db, 'studentCodes/002'), { studentId: studentB, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `days/${today}`), dayDoc({ status: options.dayStatus }));
  });
}

let idCounter = 0;
function uuid(): string {
  idCounter += 1;
  return `${crypto.randomUUID().slice(0, 24)}${idCounter.toString(16).padStart(12, '0')}`;
}

async function freshSnapshot() {
  return repository().loadSnapshot();
}

async function orderInput(studentId: string, overrides: Partial<CreateCloudOrderInput> = {}): Promise<CreateCloudOrderInput> {
  const snapshot = await freshSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  return {
    commandId: uuid(), transactionId: uuid(), leaseEpoch: 1, studentId, dayId: snapshot.today,
    expectedStudentRevision: target.revision, expectedDayRevision: snapshot.day!.revision,
    mealKind: 'bento', mealPrice: snapshot.day!.menu!.price, paidAmount: 0,
    menuRevision: snapshot.day!.menu!.revision, otherItemName: null, note: '',
    ...overrides,
  };
}

async function paymentInput(studentId: string, paidAmount: number, overrides: Partial<CreateCloudPaymentInput> = {}): Promise<CreateCloudPaymentInput> {
  const snapshot = await freshSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  return {
    commandId: uuid(), transactionId: uuid(), leaseEpoch: 1, studentId, dayId: snapshot.today,
    expectedStudentRevision: target.revision, expectedDayRevision: snapshot.day!.revision,
    paidAmount, note: '', ...overrides,
  };
}

async function cashInput(
  direction: 'income' | 'expense',
  amount: number,
  overrides: Partial<CreateCloudCashMovementInput> = {},
): Promise<CreateCloudCashMovementInput> {
  const snapshot = await freshSnapshot();
  return {
    commandId: uuid(), transactionId: uuid(), leaseEpoch: 1, dayId: snapshot.today,
    expectedDayRevision: snapshot.day!.revision, direction, amount,
    reason: direction === 'expense' ? '付餐費給廠商' : '零錢補充', ...overrides,
  };
}

async function state() {
  return withAdmin(async db => {
    const [head, day, a, b, transactions, commands] = await Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${today}`)),
      getDoc(doc(db, `students/${studentA}`)),
      getDoc(doc(db, `students/${studentB}`)),
      getDocs(collection(db, 'transactions')),
      getDocs(collection(db, 'commands')),
    ]);
    return {
      head: head.data(), day: day.data(), studentA: a.data(), studentB: b.data(),
      transactions: transactions.docs.map(item => item.data()).sort((x, y) => x.createdSeq - y.createdSeq),
      commandCount: commands.size,
    };
  });
}

async function refundInput(studentId: string, amount: number, overrides: Partial<CreateCloudRefundInput> = {}): Promise<CreateCloudRefundInput> {
  const snapshot = await freshSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  return {
    commandId: uuid(), transactionId: uuid(), leaseEpoch: 1, studentId, dayId: snapshot.today,
    expectedStudentRevision: target.revision, expectedDayRevision: snapshot.day!.revision,
    amount, reason: '溢繳退還', ...overrides,
  };
}

/** A complete raw SDK closure for CreateRefund, built exactly as the repository would. */
async function rawRefundArtifacts(amount: number, reason = 'Synthetic refund reason', studentId = studentA, dayId = today) {
  const commandId = uuid();
  const transactionId = uuid();
  const payload = { amount, reason };
  const input = {
    commandId, kind: 'CreateRefund' as const, leaseEpoch: 1,
    targets: { transactionId, studentId, dayId },
    expectedRevisions: { transaction: 0 as const, student: 0, day: 0 },
    payload,
  };
  const [headSnapshot, daySnapshot, studentSnapshot] = await withAdmin(async db => Promise.all([
    getDoc(doc(db, 'system/dataHead')),
    getDoc(doc(db, `days/${dayId}`)),
    getDoc(doc(db, `students/${studentId}`)),
  ]));
  const headBefore = headSnapshot.data() as RawMap;
  const dayBefore = daySnapshot.data() as RawMap;
  const studentBefore = studentSnapshot.data() as RawMap;
  input.expectedRevisions.day = dayBefore.revision;
  input.expectedRevisions.student = studentBefore.revision;
  const fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input));
  const seq = headBefore.seq + 1;
  const now = serverTimestamp();
  const headAfter: RawMap = { ...headBefore, seq, lastCommandId: commandId, updatedAt: now };
  const totals = dayBefore.totals as Record<string, number>;
  const dayAfter: RawMap = {
    ...dayBefore,
    revision: dayBefore.revision + 1,
    totals: {
      ...totals,
      activeTransactionCount: totals.activeTransactionCount + 1,
      accountRefunds: totals.accountRefunds + amount,
    },
    lastCommandId: commandId,
    updatedAt: now,
  };
  const studentAfter: RawMap = {
    ...studentBefore,
    currentBalance: studentBefore.currentBalance - amount,
    revision: studentBefore.revision + 1,
    lastCommandId: commandId,
    updatedAt: now,
  };
  const transactionAfter: RawMap = {
    transactionId, studentId, businessDate: dayId, type: 'refund', mealKind: null,
    mealPrice: 0, paidAmount: 0, amount,
    studentNameSnapshot: studentBefore.displayName, menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '',
    otherItemName: null, status: 'active', revision: 1, createdAt: now, createdSeq: seq,
    operatorUid: operatorA.uid, operatorEmail: operatorA.email, sourceDevice: 'pc', note: reason,
    lastCommandId: commandId, updatedAt: now,
  };
  const command: RawMap = {
    commandId, kind: 'CreateRefund', seq, leaseEpoch: 1,
    actor: { uid: operatorA.uid, email: operatorA.email }, committedAt: now,
    businessDate: dayId, studentId,
    targets: input.targets, expectedRevisions: input.expectedRevisions,
    before: { head: headBefore, student: studentBefore, day: dayBefore, transaction: null },
    after: { head: headAfter, student: studentAfter, day: dayAfter, transaction: transactionAfter },
    reason,
    cashEffect: { before: 0, after: -amount, delta: -amount, reasonKind: 'refund', refundAmount: amount },
    payload, inputFingerprint: fingerprint,
  };
  return { commandId, transactionId, studentId, dayId, command, headAfter, dayAfter, studentAfter, transactionAfter };
}

type RawRefund = Awaited<ReturnType<typeof rawRefundArtifacts>>;

function rawRefundBatch(db: Firestore, artifacts: RawRefund, options: { omitDay?: boolean; omitStudent?: boolean } = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!options.omitDay) batch.update(doc(db, `days/${artifacts.dayId}`), artifacts.dayAfter);
  if (!options.omitStudent) batch.update(doc(db, `students/${artifacts.studentId}`), artifacts.studentAfter);
  batch.set(doc(db, `transactions/${artifacts.transactionId}`), artifacts.transactionAfter);
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  return batch;
}

/** Keeps the command's after-snapshot in sync when an attack case edits a projection. */
function syncAfter(artifacts: RawRefund) {
  artifacts.command.after = {
    head: artifacts.headAfter, student: artifacts.studentAfter, day: artifacts.dayAfter, transaction: artifacts.transactionAfter,
  };
}

async function expectRawDenied(artifacts: RawRefund, options: { omitDay?: boolean; omitStudent?: boolean } = {}) {
  const before = await state();
  await assertFails(rawRefundBatch(authedDb(operatorA), artifacts, options).commit());
  expect(await state()).toEqual(before);
}

async function setBalance(studentId: string, currentBalance: number) {
  await withAdmin(async db => updateDoc(doc(db, `students/${studentId}`), { currentBalance }));
}

describeWithEmulator('P09b account refunds: repository, reads and production Rules', () => {
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

  it('P09b.1: refunding 60 of a 100 balance lowers the account and the expected cash by 60 exactly once', async () => {
    const result = await repository().createRefund(await refundInput(studentA, 60));
    expect(result).toMatchObject({ ok: true, receipt: { kind: 'CreateRefund', seq: 1 } });

    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(40);
    expect(snapshot.day?.totals).toEqual({
      activeTransactionCount: 1, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 60,
    });
    expect(snapshot.transactions.map(tx => [tx.type, tx.studentId, tx.mealPrice, tx.paidAmount, tx.amount, tx.note]))
      .toEqual([['refund', studentA, 0, 0, 60, '溢繳退還']]);
    expect(expectedCashFromTotals(snapshot.day!.openingCash, snapshot.day!.totals)).toEqual({
      totalIncome: 0, totalExpense: 0, totalRefund: 60, netCash: -60, expectedCash: 940,
    });
    const stored = await withAdmin(async db => (await getDoc(doc(db, `commands/${(result as { receipt: { commandId: string } }).receipt.commandId}`))).data());
    expect(stored).toMatchObject({
      studentId: studentA, businessDate: today, reason: '溢繳退還',
      cashEffect: { before: 0, after: -60, delta: -60, reasonKind: 'refund', refundAmount: 60 },
    });
  });

  it('P09b.2: a full-day mix (order, payment, income, expense, refund) gives the spec §7.1 expected cash', async () => {
    const repo = repository();
    expect((await repo.createOrder(await orderInput(studentA))).ok).toBe(true);
    expect((await repo.createPayment(await paymentInput(studentA, 200))).ok).toBe(true);
    const income: CreateCloudCashMovementInput = await cashInput('income', 50);
    expect((await repo.createCashMovement(income)).ok).toBe(true);
    expect((await repo.createCashMovement(await cashInput('expense', 80))).ok).toBe(true);
    expect((await repo.createRefund(await refundInput(studentA, 210, { reason: '結清離班' }))).ok).toBe(true);

    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(0);
    expect(snapshot.day?.totals).toMatchObject({ retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 210 });
    // Refunds sit on their own line and never offset receipts: 1000 + 200 + 50 - 80 - 210.
    expect(expectedCashFromTotals(snapshot.day!.openingCash, snapshot.day!.totals)).toEqual({
      totalIncome: 250, totalExpense: 80, totalRefund: 210, netCash: -40, expectedCash: 960,
    });
  });

  it('P09b.3: a refund larger than the balance, or from a zero or negative balance, is refused without writes', async () => {
    expect(await repository().createRefund(await refundInput(studentA, 101))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await repository().createRefund(await refundInput(studentB, 1))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await setBalance(studentB, -50);
    expect(await repository().createRefund(await refundInput(studentB, 1))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const after = await state();
    expect(after.head?.seq).toBe(0);
    expect(after.transactions).toEqual([]);
  });

  it.each([
    ['zero amount', { amount: 0, reason: 'x' }],
    ['negative amount', { amount: -10, reason: 'x' }],
    ['decimal amount', { amount: 10.5, reason: 'x' }],
    ['amount over the single-entry limit', { amount: 1_000_001, reason: 'x' }],
    ['missing reason', { amount: 10 }],
    ['empty reason', { amount: 10, reason: '' }],
    ['501-char reason', { amount: 10, reason: 'r'.repeat(501) }],
    ['an extra note field', { amount: 10, reason: 'x', note: '' }],
  ])('P09b.4: repository refuses a refund with %s before any write', async (_label, payload) => {
    const db = authedDb(operatorA);
    const { createCloudCommandRepository } = await import('../cloudCommandRepository');
    const commands = createCloudCommandRepository(db, { currentUser: () => fakeCurrentUser(operatorA) });
    const result = await commands.commitCommand({
      commandId: uuid(), kind: 'CreateRefund', leaseEpoch: 1,
      targets: { transactionId: uuid(), studentId: studentA, dayId: today },
      expectedRevisions: { transaction: 0, student: 1, day: 1 }, payload,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect((await state()).head?.seq).toBe(0);
  });

  it('P09b.5: an inactive account can still be refunded (settle, then deactivate)', async () => {
    await withAdmin(async db => updateDoc(doc(db, `students/${studentA}`), { status: 'inactive' }));
    expect((await repository().createRefund(await refundInput(studentA, 100, { reason: '結清離班' }))).ok).toBe(true);
    expect((await state()).studentA).toMatchObject({ status: 'inactive', currentBalance: 0 });
  });

  it('P09b.6: a stale student revision is a REVISION_CONFLICT and a closed day is DAY_CLOSED, both without writes', async () => {
    const stale = await refundInput(studentA, 30);
    expect((await repository().createPayment(await paymentInput(studentA, 10))).ok).toBe(true);
    expect(await repository().createRefund(stale)).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { status: 'closed' }));
    expect(await repository().createRefund(await refundInput(studentA, 30))).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
    const after = await state();
    expect(after.head?.seq).toBe(1);
    expect(after.transactions).toHaveLength(1);
  });

  it('P09b.7: ten retries of one refund create one row; the same ID with another amount is refused', async () => {
    const input = await refundInput(studentA, 40);
    const first = await repository().createRefund(input);
    expect(first.ok).toBe(true);
    const retries = await Promise.all(Array.from({ length: 10 }, () => repository().createRefund(input)));
    for (const retry of retries) expect(retry).toEqual(first);
    expect(await repository().createRefund({ ...input, amount: 41 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const after = await state();
    expect(after.head?.seq).toBe(1);
    expect(after.studentA?.currentBalance).toBe(60);
    expect(after.day?.totals.accountRefunds).toBe(40);
  }, 60_000);

  it('P09b.8: a raw SDK refund closure commits for the holder and is denied for a non-holder', async () => {
    const artifacts = await rawRefundArtifacts(25);
    const before = await state();
    await assertFails(rawRefundBatch(authedDb(operatorB), artifacts).commit());
    expect(await state()).toEqual(before);
    await assertSucceeds(rawRefundBatch(authedDb(operatorA), artifacts).commit());
    const after = await state();
    expect(after.studentA?.currentBalance).toBe(75);
    expect(after.day?.totals).toMatchObject({ activeTransactionCount: 1, accountRefunds: 25, retainedReceipts: 0 });
  });

  it('P09b.9: legal maximum payload (1,000,000 and a 500-char reason) stays under the expression ceiling', async () => {
    await setBalance(studentA, 2_000_000);
    const reason = '退'.repeat(500);
    expect((await repository().createRefund(await refundInput(studentA, 1_000_000, { reason }))).ok).toBe(true);
    const raw = await rawRefundArtifacts(1_000_000, 'r'.repeat(500));
    await assertSucceeds(rawRefundBatch(authedDb(operatorA), raw).commit());
    expect((await state()).studentA?.currentBalance).toBe(0);
  });

  it.each<[string, (artifacts: RawRefund) => void]>([
    ['the amount exceeds the balance', a => {
      a.command.payload = { ...a.command.payload, amount: 101 };
      a.command.cashEffect = { before: 0, after: -101, delta: -101, reasonKind: 'refund', refundAmount: 101 };
      a.transactionAfter.amount = 101;
      a.studentAfter.currentBalance = -1;
      a.dayAfter.totals = { ...a.dayAfter.totals, accountRefunds: 101 };
      syncAfter(a);
    }],
    ['the student balance is not lowered', a => { a.studentAfter.currentBalance = 100; syncAfter(a); }],
    ['the student balance is lowered twice', a => { a.studentAfter.currentBalance = 20; syncAfter(a); }],
    ['the student status changes in the same write', a => { a.studentAfter.status = 'inactive'; syncAfter(a); }],
    ['account refunds are not advanced', a => { a.dayAfter.totals = { ...a.dayAfter.totals, accountRefunds: 0 }; syncAfter(a); }],
    ['the refund is booked as a counter expense', a => {
      a.dayAfter.totals = { ...a.dayAfter.totals, accountRefunds: 0, cashierExpense: 40 };
      syncAfter(a);
    }],
    ['the refund offsets retained receipts', a => { a.dayAfter.totals = { ...a.dayAfter.totals, retainedReceipts: -40 }; syncAfter(a); }],
    ['the active count is not advanced', a => {
      a.dayAfter.totals = { ...a.dayAfter.totals, activeTransactionCount: a.dayAfter.totals.activeTransactionCount - 1 };
      syncAfter(a);
    }],
    ['the transaction type is payment', a => { a.transactionAfter.type = 'payment'; syncAfter(a); }],
    ['the transaction amount is negative', a => { a.transactionAfter.amount = -40; syncAfter(a); }],
    ['the transaction carries a paid amount', a => { a.transactionAfter.paidAmount = 40; syncAfter(a); }],
    ['the transaction note differs from the reason', a => { a.transactionAfter.note = 'other text'; syncAfter(a); }],
    ['the transaction name snapshot is not the student name', a => { a.transactionAfter.studentNameSnapshot = '櫃台'; syncAfter(a); }],
    ['the transaction has an extra field', a => { a.transactionAfter.extraField = 'x'; syncAfter(a); }],
    ['the transaction is missing a field', a => { delete a.transactionAfter.vendorNameSnapshot; syncAfter(a); }],
    ['the transaction sourceDevice is changed', a => { a.transactionAfter.sourceDevice = 'ipad_handoff'; syncAfter(a); }],
    ['the cash effect is not a refund', a => {
      a.command.cashEffect = { before: 0, after: -40, delta: -40, reasonKind: 'payout', refundAmount: 0 };
    }],
    ['the cash effect refund amount is zero', a => {
      a.command.cashEffect = { before: 0, after: -40, delta: -40, reasonKind: 'refund', refundAmount: 0 };
    }],
    ['the command reason is null', a => { a.command.reason = null; }],
    ['the command reason differs from the payload', a => { a.command.reason = 'different'; }],
    ['the payload reason is empty', a => {
      a.command.payload = { ...a.command.payload, reason: '' }; a.command.reason = ''; a.transactionAfter.note = ''; syncAfter(a);
    }],
    ['the command studentId is the cashier', a => { a.command.studentId = '__cashier__'; }],
    ['the day status changes in the same write', a => { a.dayAfter.status = 'closed'; syncAfter(a); }],
  ])('P09b.10: a raw SDK refund is denied atomically when %s', async (_label, mutate) => {
    const artifacts = await rawRefundArtifacts(40);
    mutate(artifacts);
    await expectRawDenied(artifacts);
  });

  it('P09b.11: a raw SDK refund cannot omit the day write or the student write', async () => {
    await expectRawDenied(await rawRefundArtifacts(40), { omitDay: true });
    await expectRawDenied(await rawRefundArtifacts(40), { omitStudent: true });
  });

  it('P09b.12: a raw SDK refund is denied on a closed day and on a non-today day', async () => {
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { status: 'closed' }));
    await expectRawDenied(await rawRefundArtifacts(40));
    const yesterday = shiftDate(today, -1);
    await withAdmin(async db => setDoc(doc(db, `days/${yesterday}`), dayDoc({ date: yesterday })));
    await expectRawDenied(await rawRefundArtifacts(40, 'Synthetic', studentA, yesterday));
  });

  it('P09b.13: a day whose totals still have the old seven fields is refused on read and cannot be advanced by Rules', async () => {
    await withAdmin(async db => {
      const legacy = emptyTotals() as Record<string, number>;
      delete legacy.accountRefunds;
      await updateDoc(doc(db, `days/${today}`), { totals: legacy });
    });
    await expect(freshSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    // A raw closure that keeps the seven-field shape on both sides is still denied by validTotals.
    const artifacts = await rawRefundArtifacts(40);
    delete artifacts.dayAfter.totals.accountRefunds;
    syncAfter(artifacts);
    await expectRawDenied(artifacts);
  });

  it('P09b.14: account refunds that disagree with the refund rows, or a tampered refund row, fail closed on read', async () => {
    expect((await repository().createRefund(await refundInput(studentA, 40))).ok).toBe(true);
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { 'totals.accountRefunds': 30 }));
    await expect(freshSnapshot()).rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });

    await env.clearFirestore();
    await seed();
    expect((await repository().createRefund(await refundInput(studentA, 40))).ok).toBe(true);
    await withAdmin(async db => {
      const [row] = (await getDocs(collection(db, 'transactions'))).docs;
      await updateDoc(row.ref, { paidAmount: 40 });
    });
    await expect(freshSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
});
