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
} from '../cloudOrderRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_CASH === 'true';
if (required && !emulatorHost) throw new Error('P09 cash Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p09-cash-a', email: 'p09-cash-a@example.test', displayName: 'Synthetic Cash A', active: true };
const operatorB = { uid: 'p09-cash-b', email: 'p09-cash-b@example.test', displayName: 'Synthetic Cash B', active: true };
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
    retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0,
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
      schemaVersion: 1, datasetId: 'p09-cash-dataset', seq: 0, lastCommandId: null,
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

/** A complete raw SDK closure for CreateCashMovement, built exactly as the repository would. */
async function rawCashArtifacts(direction: 'income' | 'expense', amount: number, reason = 'Synthetic cash reason', dayId = today) {
  const commandId = uuid();
  const transactionId = uuid();
  const payload = {
    mealPrice: direction === 'expense' ? amount : 0,
    paidAmount: direction === 'income' ? amount : 0,
    reason,
  };
  const input = {
    commandId, kind: 'CreateCashMovement' as const, leaseEpoch: 1,
    targets: { transactionId, dayId },
    expectedRevisions: { transaction: 0 as const, day: 0 },
    payload,
  };
  const [headSnapshot, daySnapshot] = await withAdmin(async db => Promise.all([
    getDoc(doc(db, 'system/dataHead')),
    getDoc(doc(db, `days/${dayId}`)),
  ]));
  const headBefore = headSnapshot.data() as RawMap;
  const dayBefore = daySnapshot.data() as RawMap;
  input.expectedRevisions.day = dayBefore.revision;
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
      cashierIncome: totals.cashierIncome + payload.paidAmount,
      cashierExpense: totals.cashierExpense + payload.mealPrice,
    },
    lastCommandId: commandId,
    updatedAt: now,
  };
  const transactionAfter: RawMap = {
    transactionId, studentId: '__cashier__', businessDate: dayId, type: 'expense', mealKind: null,
    mealPrice: payload.mealPrice, paidAmount: payload.paidAmount, amount: payload.paidAmount - payload.mealPrice,
    studentNameSnapshot: '櫃台', menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '',
    otherItemName: null, status: 'active', revision: 1, createdAt: now, createdSeq: seq,
    operatorUid: operatorA.uid, operatorEmail: operatorA.email, sourceDevice: 'pc', note: reason,
    lastCommandId: commandId, updatedAt: now,
  };
  const command: RawMap = {
    commandId, kind: 'CreateCashMovement', seq, leaseEpoch: 1,
    actor: { uid: operatorA.uid, email: operatorA.email }, committedAt: now,
    businessDate: dayId, studentId: '__cashier__',
    targets: input.targets, expectedRevisions: input.expectedRevisions,
    before: { head: headBefore, day: dayBefore, transaction: null },
    after: { head: headAfter, day: dayAfter, transaction: transactionAfter },
    reason,
    cashEffect: direction === 'income'
      ? { before: 0, after: amount, delta: amount, reasonKind: 'collection', refundAmount: 0 }
      : { before: 0, after: -amount, delta: -amount, reasonKind: 'payout', refundAmount: 0 },
    payload, inputFingerprint: fingerprint,
  };
  return { commandId, transactionId, dayId, command, headAfter, dayAfter, transactionAfter };
}

type RawCash = Awaited<ReturnType<typeof rawCashArtifacts>>;

function rawCashBatch(db: Firestore, artifacts: RawCash, options: { omitDay?: boolean } = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'system/dataHead'), artifacts.headAfter);
  if (!options.omitDay) batch.update(doc(db, `days/${artifacts.dayId}`), artifacts.dayAfter);
  batch.set(doc(db, `transactions/${artifacts.transactionId}`), artifacts.transactionAfter);
  batch.set(doc(db, `commands/${artifacts.commandId}`), artifacts.command);
  return batch;
}

/** Keeps the command's after-snapshot in sync when an attack case edits a projection. */
function syncAfter(artifacts: RawCash) {
  artifacts.command.after = { head: artifacts.headAfter, day: artifacts.dayAfter, transaction: artifacts.transactionAfter };
}

async function expectRawDenied(artifacts: RawCash, options: { omitDay?: boolean; extra?: (batch: ReturnType<typeof writeBatch>, db: Firestore) => void } = {}) {
  const before = await state();
  const db = authedDb(operatorA);
  const batch = rawCashBatch(db, artifacts, options);
  options.extra?.(batch, db);
  await assertFails(batch.commit());
  expect(await state()).toEqual(before);
}

describeWithEmulator('P09a payments and counter cash movements: repository, reads and production Rules', () => {
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

  it('P09.1: L01 complete (opening 100, meal 90 paid 0, then payment 200) reloads as balance 210, meals 90, receipts 200', async () => {
    const repo = repository();
    expect((await repo.createOrder(await orderInput(studentA))).ok).toBe(true);
    const payment = await repo.createPayment(await paymentInput(studentA, 200, { note: 'Synthetic deposit' }));
    expect(payment).toMatchObject({ ok: true, receipt: { kind: 'CreatePayment', seq: 2 } });

    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(210);
    expect(snapshot.day?.totals).toEqual({
      activeTransactionCount: 2, bentoCount: 1, otherMealCount: 0, mealTotal: 90,
      retainedReceipts: 200, cashierIncome: 0, cashierExpense: 0,
    });
    expect(snapshot.transactions.map(tx => [tx.type, tx.mealPrice, tx.paidAmount, tx.amount, tx.note])).toEqual([
      ['order', 90, 0, -90, ''], ['payment', 0, 200, 200, 'Synthetic deposit'],
    ]);
  });

  it.each([
    ['zero', 0], ['negative', -10], ['decimal', 10.5], ['over the single-entry limit', 1_000_001],
  ])('P09.2: a %s payment is refused before any write', async (_label, paidAmount) => {
    const result = await repository().createPayment(await paymentInput(studentA, paidAmount));
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const after = await state();
    expect(after.head?.seq).toBe(0);
    expect(after.transactions).toEqual([]);
  });

  it('P09.3: L05 numbers — income 50 and expense 80 move only the counter totals; expected cash is 1170', async () => {
    const repo = repository();
    expect((await repo.createOrder(await orderInput(studentA))).ok).toBe(true);
    expect((await repo.createPayment(await paymentInput(studentA, 200))).ok).toBe(true);
    const income = await repo.createCashMovement(await cashInput('income', 50, { reason: '零錢補充' }));
    expect(income).toMatchObject({ ok: true, receipt: { kind: 'CreateCashMovement', seq: 3 } });
    const expense = await repo.createCashMovement(await cashInput('expense', 80, { reason: '付餐費給廠商' }));
    expect(expense).toMatchObject({ ok: true, receipt: { kind: 'CreateCashMovement', seq: 4 } });

    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(210);
    expect(snapshot.students.find(item => item.studentId === studentB)?.currentBalance).toBe(0);
    expect(snapshot.day?.totals).toEqual({
      activeTransactionCount: 4, bentoCount: 1, otherMealCount: 0, mealTotal: 90,
      retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80,
    });
    expect(snapshot.transactions.slice(2).map(tx => [tx.type, tx.studentId, tx.mealPrice, tx.paidAmount, tx.amount, tx.note]))
      .toEqual([
        ['expense', '__cashier__', 0, 50, 50, '零錢補充'],
        ['expense', '__cashier__', 80, 0, -80, '付餐費給廠商'],
      ]);
    expect(expectedCashFromTotals(snapshot.day!.openingCash, snapshot.day!.totals)).toEqual({
      totalIncome: 250, totalExpense: 80, netCash: 170, expectedCash: 1170,
    });

    const receipt = await repo.readCommand((expense as { receipt: { commandId: string } }).receipt.commandId);
    expect(receipt).toMatchObject({ kind: 'CreateCashMovement', seq: 4, targets: { dayId: today } });
    const stored = await withAdmin(async db => (await getDoc(doc(db, `commands/${receipt!.commandId}`))).data());
    expect(stored).toMatchObject({
      studentId: '__cashier__', businessDate: today, reason: '付餐費給廠商',
      cashEffect: { before: 0, after: -80, delta: -80, reasonKind: 'payout', refundAmount: 0 },
    });
  });

  it.each([
    ['both directions', { mealPrice: 10, paidAmount: 10, reason: 'x' }],
    ['zero amount', { mealPrice: 0, paidAmount: 0, reason: 'x' }],
    ['empty reason', { mealPrice: 0, paidAmount: 10, reason: '' }],
    ['501-char reason', { mealPrice: 0, paidAmount: 10, reason: 'r'.repeat(501) }],
    ['decimal amount', { mealPrice: 0, paidAmount: 10.5, reason: 'x' }],
    ['extra note field', { mealPrice: 0, paidAmount: 10, reason: 'x', note: '' }],
  ])('P09.4: repository refuses a cash movement with %s before any write', async (_label, payload) => {
    const db = authedDb(operatorA);
    const { createCloudCommandRepository } = await import('../cloudCommandRepository');
    const commands = createCloudCommandRepository(db, { currentUser: () => fakeCurrentUser(operatorA) });
    const result = await commands.commitCommand({
      commandId: uuid(), kind: 'CreateCashMovement', leaseEpoch: 1,
      targets: { transactionId: uuid(), dayId: today }, expectedRevisions: { transaction: 0, day: 1 }, payload,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect((await state()).head?.seq).toBe(0);
  });

  it('P09.5: ten retries of one cash command create one row; the same ID with another amount is refused', async () => {
    const input = await cashInput('expense', 80);
    const first = await repository().createCashMovement(input);
    expect(first.ok).toBe(true);
    const retries = await Promise.all(Array.from({ length: 10 }, () => repository().createCashMovement(input)));
    for (const retry of retries) expect(retry).toEqual(first);
    const changed = await repository().createCashMovement({ ...input, amount: 81 });
    expect(changed).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const after = await state();
    expect(after.head?.seq).toBe(1);
    expect(after.transactions).toHaveLength(1);
    expect(after.day?.totals.cashierExpense).toBe(80);
  });

  it('P09.6: a stale day revision is a REVISION_CONFLICT and a closed day is DAY_CLOSED, both without writes', async () => {
    const stale = await cashInput('income', 30);
    expect((await repository().createPayment(await paymentInput(studentB, 10))).ok).toBe(true);
    expect(await repository().createCashMovement(stale)).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { status: 'closed' }));
    const closed = await cashInput('income', 30);
    expect(await repository().createCashMovement(closed)).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
    const after = await state();
    expect(after.head?.seq).toBe(1);
    expect(after.transactions).toHaveLength(1);
  });

  it('P09.7: raw SDK income and expense closures commit; non-holders are denied', async () => {
    const income = await rawCashArtifacts('income', 50);
    await assertSucceeds(rawCashBatch(authedDb(operatorA), income).commit());
    const expense = await rawCashArtifacts('expense', 80);
    const before = await state();
    await assertFails(rawCashBatch(authedDb(operatorB), expense).commit());
    expect(await state()).toEqual(before);
    await assertSucceeds(rawCashBatch(authedDb(operatorA), expense).commit());
    const after = await state();
    expect(after.day?.totals).toMatchObject({ activeTransactionCount: 2, cashierIncome: 50, cashierExpense: 80, retainedReceipts: 0 });
    expect(after.studentA?.revision).toBe(1);
  });

  it('P09.8: legal maximum payload (1,000,000 and a 500-char reason) stays under the expression ceiling', async () => {
    const reason = '因'.repeat(500);
    const income = await repository().createCashMovement(await cashInput('income', 1_000_000, { reason }));
    expect(income.ok).toBe(true);
    const expense = await repository().createCashMovement(await cashInput('expense', 1_000_000, { reason }));
    expect(expense.ok).toBe(true);
    const raw = await rawCashArtifacts('income', 1_000_000, 'r'.repeat(500));
    await assertSucceeds(rawCashBatch(authedDb(operatorA), raw).commit());
    expect((await state()).day?.totals).toMatchObject({ cashierIncome: 2_000_000, cashierExpense: 1_000_000 });
  });

  it.each<[string, (artifacts: RawCash) => void]>([
    ['command studentId is a real student', a => { a.command.studentId = studentA; }],
    ['transaction studentId is a real student', a => { a.transactionAfter.studentId = studentA; syncAfter(a); }],
    ['transaction type is payment', a => { a.transactionAfter.type = 'payment'; syncAfter(a); }],
    ['transaction note differs from the reason', a => { a.transactionAfter.note = 'other text'; syncAfter(a); }],
    ['transaction name snapshot is a student name', a => { a.transactionAfter.studentNameSnapshot = 'Synthetic 001'; syncAfter(a); }],
    ['command reason is null', a => { a.command.reason = null; }],
    ['command reason differs from payload', a => { a.command.reason = 'different'; }],
    ['payload reason is empty', a => { a.command.payload.reason = ''; a.command.reason = ''; a.transactionAfter.note = ''; syncAfter(a); }],
    ['cash effect is marked as a collection', a => { a.command.cashEffect = { before: 0, after: -80, delta: -80, reasonKind: 'collection', refundAmount: 0 }; }],
    ['cash effect has the wrong sign', a => { a.command.cashEffect = { before: 0, after: 80, delta: 80, reasonKind: 'payout', refundAmount: 0 }; }],
    ['expense is credited to retained receipts', a => {
      a.dayAfter.totals = { ...a.dayAfter.totals, cashierExpense: a.dayAfter.totals.cashierExpense - 80, retainedReceipts: 80 };
      syncAfter(a);
    }],
    ['expense increases the meal total', a => { a.dayAfter.totals = { ...a.dayAfter.totals, mealTotal: 80 }; syncAfter(a); }],
    ['active count is not advanced', a => {
      a.dayAfter.totals = { ...a.dayAfter.totals, activeTransactionCount: a.dayAfter.totals.activeTransactionCount - 1 };
      syncAfter(a);
    }],
    ['both payload directions are positive', a => {
      a.command.payload = { ...a.command.payload, paidAmount: 80 };
      a.transactionAfter.paidAmount = 80; a.transactionAfter.amount = 0;
      a.dayAfter.totals = { ...a.dayAfter.totals, cashierIncome: 80 };
      // A cash effect consistent with the income branch isolates the exactly-one-direction rule.
      a.command.cashEffect = { before: 0, after: 80, delta: 80, reasonKind: 'collection', refundAmount: 0 };
      syncAfter(a);
    }],
    ['amount exceeds the single-entry limit', a => {
      a.command.payload = { ...a.command.payload, mealPrice: 1_000_001 };
      a.transactionAfter.mealPrice = 1_000_001; a.transactionAfter.amount = -1_000_001;
      a.dayAfter.totals = { ...a.dayAfter.totals, cashierExpense: 1_000_001 };
      a.command.cashEffect = { before: 0, after: -1_000_001, delta: -1_000_001, reasonKind: 'payout', refundAmount: 0 };
      syncAfter(a);
    }],
    ['day status changes in the same write', a => { a.dayAfter.status = 'closed'; syncAfter(a); }],
  ])('P09.9: raw SDK cash movement is denied atomically when %s', async (_label, mutate) => {
    const artifacts = await rawCashArtifacts('expense', 80);
    mutate(artifacts);
    await expectRawDenied(artifacts);
  });

  it('P09.10: raw SDK cash movement cannot omit the day write or also change a student balance', async () => {
    await expectRawDenied(await rawCashArtifacts('income', 50), { omitDay: true });
    await expectRawDenied(await rawCashArtifacts('income', 50), {
      extra: (batch, db) => batch.update(doc(db, `students/${studentA}`), { currentBalance: 150 }),
    });
  });

  it('P09.11: raw SDK cash movement is denied on a closed day and on a non-today day', async () => {
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { status: 'closed' }));
    await expectRawDenied(await rawCashArtifacts('income', 50));
    const yesterday = shiftDate(today, -1);
    await withAdmin(async db => setDoc(doc(db, `days/${yesterday}`), dayDoc({ date: yesterday })));
    await expectRawDenied(await rawCashArtifacts('income', 50, 'Synthetic', yesterday));
  });

  it('P09.12: replaying a committed cash command as a new row is denied', async () => {
    const committed = await rawCashArtifacts('income', 50);
    await assertSucceeds(rawCashBatch(authedDb(operatorA), committed).commit());
    const replay = await rawCashArtifacts('income', 50);
    replay.command = { ...committed.command };
    replay.transactionAfter = { ...replay.transactionAfter, lastCommandId: committed.commandId };
    replay.headAfter = { ...replay.headAfter, lastCommandId: committed.commandId };
    replay.dayAfter = { ...replay.dayAfter, lastCommandId: committed.commandId };
    await expectRawDenied({ ...replay, commandId: committed.commandId });
  });

  it('P09.13: day counter totals that disagree with the cash rows fail closed on read', async () => {
    expect((await repository().createCashMovement(await cashInput('expense', 80))).ok).toBe(true);
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { 'totals.cashierExpense': 70 }));
    await expect(freshSnapshot()).rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
  });

  it('P09.14: a cash row moved onto a student or a student row moved onto the cashier fails closed on read', async () => {
    expect((await repository().createCashMovement(await cashInput('income', 50))).ok).toBe(true);
    await withAdmin(async db => {
      const [row] = (await getDocs(collection(db, 'transactions'))).docs;
      await updateDoc(row.ref, { studentId: studentA });
    });
    await expect(freshSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });

    await env.clearFirestore();
    await seed();
    expect((await repository().createPayment(await paymentInput(studentA, 20))).ok).toBe(true);
    await withAdmin(async db => {
      const [row] = (await getDocs(collection(db, 'transactions'))).docs;
      await updateDoc(row.ref, { studentId: '__cashier__' });
    });
    await expect(freshSnapshot()).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
});
