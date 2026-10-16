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
  deleteDoc,
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
import type { CommandResult } from '../../domain/cloudCommands';
import { fingerprintCommandInput, normalizeEnabledCommandInput } from '../../domain/cloudCommandSchema';
import { expectedCashFromTotals } from '../../domain/cloudLedgerProjection';
import {
  UNDO_REASON,
  applyTransactionMutation,
  mutationCashEffect,
  studentContribution,
  totalsContribution,
  type MutableTransaction,
  type TransactionMutationPayload,
} from '../../domain/cloudTransactionMutation';
import {
  createCloudOrderRepository,
  type CloudOrderTransactionRecord,
  type CloudTransactionMutationInput,
  type CreateCloudCashMovementInput,
  type CreateCloudOrderInput,
} from '../cloudOrderRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_MUTATIONS === 'true';
if (required && !emulatorHost) throw new Error('P10a mutation Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p10-mutation-a', email: 'p10-mutation-a@example.test', displayName: 'Synthetic Mutation A', active: true };
const operatorB = { uid: 'p10-mutation-b', email: 'p10-mutation-b@example.test', displayName: 'Synthetic Mutation B', active: true };
const studentA = '11111111-1111-4111-8111-111111111111';
const studentB = '22222222-2222-4222-8222-222222222222';
const cashier = '__cashier__';
const seedCommandId = '00000000-0000-4000-8000-00000000000a';

let env: RulesTestEnvironment;
let today = '';
let leaseHolder = operatorA;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw Firestore maps vary by attack case
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
    uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }],
  } as unknown as User;
}

function authedDb(operator: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(operator.uid, {
    email: operator.email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

function repository(operator: typeof operatorA = leaseHolder) {
  return createCloudOrderRepository(authedDb(operator), { currentUser: () => fakeCurrentUser(operator) });
}

function student(studentId: string, code: string, opening: number) {
  return {
    studentId, studentCode: code, displayName: `Synthetic ${code}`, aliases: [], status: 'active',
    openingBalance: { amount: opening, asOfDate: shiftDate(today, -5), note: '', createdAt: serverTimestamp() },
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

function dayDoc(date: string, status: 'open' | 'closed' | 'reopened' = 'open') {
  return {
    status, revision: 1,
    menu: {
      businessDate: date, itemName: 'Synthetic Meal', price: 90, vendorId: 'p10-vendor',
      vendorNameSnapshot: 'Synthetic Vendor', updatedAt: serverTimestamp(), revision: 1, inheritedFromDate: null,
    },
    openingCash: 1000, openedBy: operatorA.uid, openedAt: serverTimestamp(),
    totals: emptyTotals(),
    lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

async function seed() {
  today = taipeiDate(new Date());
  leaseHolder = operatorA;
  leaseEpoch = 1;
  await withAdmin(async db => {
    await setDoc(doc(db, `operators/${operatorA.uid}`), { ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, `operators/${operatorB.uid}`), { ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: operatorA.uid, epoch: 1, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p10-mutation-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: shiftDate(today, -30), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `students/${studentA}`), student(studentA, '001', 100));
    await setDoc(doc(db, 'studentCodes/001'), { studentId: studentA, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `students/${studentB}`), student(studentB, '002', 0));
    await setDoc(doc(db, 'studentCodes/002'), { studentId: studentB, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `days/${today}`), dayDoc(today));
  });
}

/** Hands the lease to another operator (a later epoch), as a normal hand-over would. */
async function handLeaseTo(operator: typeof operatorA) {
  leaseHolder = operator;
  leaseEpoch += 1;
  await withAdmin(async db => setDoc(doc(db, 'system/accessLease'), { holderUid: operator.uid, epoch: leaseEpoch, updatedAt: serverTimestamp() }));
}

let idCounter = 0;
function uuid(): string {
  idCounter += 1;
  return `${crypto.randomUUID().slice(0, 24)}${idCounter.toString(16).padStart(12, '0')}`;
}

let leaseEpoch = 1;
function epoch() {
  return leaseEpoch;
}

async function freshSnapshot() {
  return repository().loadSnapshot();
}

function ok(result: CommandResult): { commandId: string; seq: number } {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.receipt;
}

async function order(studentId: string, paidAmount: number, overrides: Partial<CreateCloudOrderInput> = {}) {
  const snapshot = await freshSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  const commandId = uuid();
  const transactionId = uuid();
  ok(await repository().createOrder({
    commandId, transactionId, leaseEpoch: epoch(), studentId, dayId: snapshot.today,
    expectedStudentRevision: target.revision, expectedDayRevision: snapshot.day!.revision,
    mealKind: 'bento', mealPrice: snapshot.day!.menu!.price, paidAmount,
    menuRevision: snapshot.day!.menu!.revision, otherItemName: null, note: '',
    ...overrides,
  }));
  return { commandId, transactionId };
}

async function payment(studentId: string, paidAmount: number) {
  const snapshot = await freshSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  const commandId = uuid();
  const transactionId = uuid();
  ok(await repository().createPayment({
    commandId, transactionId, leaseEpoch: epoch(), studentId, dayId: snapshot.today,
    expectedStudentRevision: target.revision, expectedDayRevision: snapshot.day!.revision, paidAmount, note: '',
  }));
  return { commandId, transactionId };
}

async function cash(direction: CreateCloudCashMovementInput['direction'], amount: number) {
  const snapshot = await freshSnapshot();
  const commandId = uuid();
  const transactionId = uuid();
  ok(await repository().createCashMovement({
    commandId, transactionId, leaseEpoch: epoch(), dayId: snapshot.today,
    expectedDayRevision: snapshot.day!.revision, direction, amount, reason: direction === 'expense' ? '付餐費給廠商' : '零錢補充',
  }));
  return { commandId, transactionId };
}

async function refund(studentId: string, amount: number) {
  const snapshot = await freshSnapshot();
  const target = snapshot.students.find(item => item.studentId === studentId)!;
  const commandId = uuid();
  const transactionId = uuid();
  ok(await repository().createRefund({
    commandId, transactionId, leaseEpoch: epoch(), studentId, dayId: snapshot.today,
    expectedStudentRevision: target.revision, expectedDayRevision: snapshot.day!.revision, amount, reason: '溢繳退還',
  }));
  return { commandId, transactionId };
}

type MutationSpec = Pick<CloudTransactionMutationInput, 'kind' | 'payload'>;

/** Builds a mutation input from the server's current revisions, exactly as the F1 screen would. */
async function mutationInput(transactionId: string, spec: MutationSpec, overrides: Partial<CloudTransactionMutationInput> = {}) {
  const tx = await withAdmin(async db => (await getDoc(doc(db, `transactions/${transactionId}`))).data() as RawMap);
  const [day, studentDoc] = await withAdmin(async db => Promise.all([
    getDoc(doc(db, `days/${tx.businessDate}`)),
    tx.studentId === cashier ? Promise.resolve(null) : getDoc(doc(db, `students/${tx.studentId}`)),
  ]));
  return {
    commandId: uuid(), leaseEpoch: epoch(), transactionId, studentId: tx.studentId, dayId: tx.businessDate,
    expectedTransactionRevision: tx.revision,
    expectedStudentRevision: studentDoc ? (studentDoc.data() as RawMap).revision : null,
    expectedDayRevision: (day.data() as RawMap).revision,
    ...spec,
    ...overrides,
  } as CloudTransactionMutationInput;
}

async function mutate(transactionId: string, spec: MutationSpec, overrides: Partial<CloudTransactionMutationInput> = {}) {
  return repository().mutateTransaction(await mutationInput(transactionId, spec, overrides));
}

function correct(tx: RawMap, change: { mealPrice?: number; paidAmount?: number; amount?: number; note?: string }, reason = '收款記錯'): MutationSpec {
  const mealPrice = change.mealPrice ?? tx.mealPrice;
  const paidAmount = change.paidAmount ?? tx.paidAmount;
  const amount = change.amount ?? (tx.type === 'refund' ? tx.amount : paidAmount - mealPrice);
  return { kind: 'CorrectTransaction', payload: { mealPrice, paidAmount, amount, note: change.note ?? tx.note, reason } };
}

async function txDoc(transactionId: string): Promise<RawMap> {
  return withAdmin(async db => (await getDoc(doc(db, `transactions/${transactionId}`))).data() as RawMap);
}

async function commandDoc(commandId: string): Promise<RawMap> {
  return withAdmin(async db => (await getDoc(doc(db, `commands/${commandId}`))).data() as RawMap);
}

async function state(dayId = today) {
  return withAdmin(async db => {
    const [head, day, a, b, transactions, commands] = await Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${dayId}`)),
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

/** A complete raw SDK mutation closure, built the same way as the repository. */
async function rawMutationArtifacts(transactionId: string, mutation: TransactionMutationPayload, actor = operatorA) {
  const commandId = uuid();
  const txBefore = await txDoc(transactionId);
  const dayId = txBefore.businessDate;
  const studentId = txBefore.studentId;
  const isCashier = studentId === cashier;
  const [headSnapshot, daySnapshot, studentSnapshot] = await withAdmin(async db => Promise.all([
    getDoc(doc(db, 'system/dataHead')),
    getDoc(doc(db, `days/${dayId}`)),
    isCashier ? Promise.resolve(null) : getDoc(doc(db, `students/${studentId}`)),
  ]));
  const headBefore = headSnapshot.data() as RawMap;
  const dayBefore = daySnapshot.data() as RawMap;
  const studentBefore = studentSnapshot ? studentSnapshot.data() as RawMap : null;
  const input = {
    commandId, kind: mutation.kind, leaseEpoch: epoch(),
    targets: { transactionId, studentId, dayId },
    expectedRevisions: isCashier
      ? { transaction: txBefore.revision, day: dayBefore.revision }
      : { transaction: txBefore.revision, student: studentBefore!.revision, day: dayBefore.revision },
    payload: mutation.payload,
  };
  const fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input));
  const now = serverTimestamp();
  const seq = headBefore.seq + 1;
  const headAfter: RawMap = { ...headBefore, seq, lastCommandId: commandId, updatedAt: now };
  const applied = applyTransactionMutation(txBefore as unknown as MutableTransaction, mutation) as unknown as RawMap;
  const transactionAfter: RawMap = { ...applied, revision: txBefore.revision + 1, lastCommandId: commandId, updatedAt: now };
  const x = totalsContribution(txBefore as unknown as MutableTransaction) as unknown as Record<string, number>;
  const y = totalsContribution(transactionAfter as unknown as MutableTransaction) as unknown as Record<string, number>;
  const totals = dayBefore.totals as Record<string, number>;
  const dayAfter: RawMap = {
    ...dayBefore,
    revision: dayBefore.revision + 1,
    totals: Object.fromEntries(Object.keys(totals).map(key => [key, totals[key] - x[key] + y[key]])),
    lastCommandId: commandId,
    updatedAt: now,
  };
  const studentAfter: RawMap | null = studentBefore ? {
    ...studentBefore,
    currentBalance: studentBefore.currentBalance
      - studentContribution(txBefore as unknown as MutableTransaction)
      + studentContribution(transactionAfter as unknown as MutableTransaction),
    revision: studentBefore.revision + 1,
    lastCommandId: commandId,
    updatedAt: now,
  } : null;
  const command: RawMap = {
    commandId, kind: mutation.kind, seq, leaseEpoch: input.leaseEpoch,
    actor: { uid: actor.uid, email: actor.email }, committedAt: now,
    businessDate: dayId, studentId,
    targets: input.targets, expectedRevisions: input.expectedRevisions,
    before: {}, after: {},
    reason: mutation.payload.reason,
    cashEffect: mutationCashEffect(mutation.kind, txBefore as unknown as MutableTransaction, transactionAfter as unknown as MutableTransaction),
    payload: mutation.payload, inputFingerprint: fingerprint,
  };
  const artifacts = {
    commandId, transactionId, studentId, dayId, command, headBefore, headAfter, dayBefore, dayAfter,
    studentBefore, studentAfter, txBefore, transactionAfter,
  };
  syncSnapshots(artifacts);
  return artifacts;
}

type RawMutation = Awaited<ReturnType<typeof rawMutationArtifacts>>;

/** Keeps the command before/after snapshots in sync when an attack case edits a projection. */
function syncSnapshots(a: RawMutation) {
  a.command.before = a.studentBefore
    ? { head: a.headBefore, student: a.studentBefore, day: a.dayBefore, transaction: a.txBefore }
    : { head: a.headBefore, day: a.dayBefore, transaction: a.txBefore };
  a.command.after = a.studentAfter
    ? { head: a.headAfter, student: a.studentAfter, day: a.dayAfter, transaction: a.transactionAfter }
    : { head: a.headAfter, day: a.dayAfter, transaction: a.transactionAfter };
}

type BatchOptions = { omitDay?: boolean; omitStudent?: boolean; omitTransaction?: boolean };

function rawMutationBatch(db: Firestore, a: RawMutation, options: BatchOptions = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'system/dataHead'), a.headAfter);
  if (!options.omitDay) batch.update(doc(db, `days/${a.dayId}`), a.dayAfter);
  if (a.studentAfter && !options.omitStudent) batch.update(doc(db, `students/${a.studentId}`), a.studentAfter);
  if (!options.omitTransaction) batch.update(doc(db, `transactions/${a.transactionId}`), a.transactionAfter);
  batch.set(doc(db, `commands/${a.commandId}`), a.command);
  return batch;
}

async function expectRawDenied(a: RawMutation, options: BatchOptions = {}, actor = operatorA) {
  const before = await state(a.dayId);
  await assertFails(rawMutationBatch(authedDb(actor), a, options).commit());
  expect(await state(a.dayId)).toEqual(before);
}

describeWithEmulator('P10a transaction corrections, voids, cancels and undo: repository, reads and production Rules', () => {
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

  it('P10.1 (L01/L02): correcting a 90 meal to 110 leaves balance 190; the original 90 and the reason stay in the command', async () => {
    const meal = await order(studentA, 0);
    await payment(studentA, 200);
    expect((await state()).studentA?.currentBalance).toBe(210);
    const before = await txDoc(meal.transactionId);
    const receipt = ok(await mutate(meal.transactionId, correct(before, { mealPrice: 110 }, '便當實際 110 元')));

    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(190);
    expect(snapshot.day?.totals).toMatchObject({ activeTransactionCount: 2, bentoCount: 1, mealTotal: 110, retainedReceipts: 200 });
    const after = await txDoc(meal.transactionId);
    expect(after).toMatchObject({ mealPrice: 110, paidAmount: 0, amount: -110, revision: 2, status: 'active', studentId: studentA, businessDate: today });
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.createdSeq).toBe(before.createdSeq);
    expect(after.menuPriceSnapshot).toBe(90);
    const stored = await commandDoc(receipt.commandId);
    expect(stored).toMatchObject({
      kind: 'CorrectTransaction', reason: '便當實際 110 元', studentId: studentA, businessDate: today,
      before: { transaction: { mealPrice: 90 } }, after: { transaction: { mealPrice: 110 } },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
  });

  it('P10.2 (L03): cancelling a paid order and keeping the deposit turns it into a payment; cash is unchanged', async () => {
    const meal = await order(studentB, 100);
    const receipt = ok(await mutate(meal.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: '臨時不吃' } }));
    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentB)?.currentBalance).toBe(100);
    expect(snapshot.day?.totals).toEqual({ ...emptyTotals(), activeTransactionCount: 1, retainedReceipts: 100 });
    expect(snapshot.transactions.map(tx => [tx.type, tx.mealKind, tx.mealPrice, tx.paidAmount, tx.amount, tx.status, tx.menuNameSnapshot]))
      .toEqual([['payment', null, 0, 100, 100, 'active', '']]);
    expect((await commandDoc(receipt.commandId)).cashEffect).toEqual({ before: 100, after: 100, delta: 0, reasonKind: 'none', refundAmount: 0 });
  });

  it('P10.3 (L04): cancelling with a refund voids the order, returns the 100 once and keeps both records', async () => {
    const meal = await order(studentB, 100);
    const receipt = ok(await mutate(meal.transactionId, { kind: 'CancelRefund', payload: { reason: '取消退現' } }));
    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentB)?.currentBalance).toBe(0);
    expect(snapshot.day?.totals).toEqual(emptyTotals());
    expect(expectedCashFromTotals(snapshot.day!.openingCash, snapshot.day!.totals).expectedCash).toBe(1000);
    expect(snapshot.transactions.map(tx => [tx.type, tx.paidAmount, tx.status])).toEqual([['order', 100, 'voided']]);
    expect((await commandDoc(receipt.commandId)).cashEffect).toEqual({ before: 100, after: 0, delta: -100, reasonKind: 'refund', refundAmount: 100 });
    // The original collection command is still there, untouched.
    expect((await state()).commandCount).toBe(2);
  });

  it('P10.4: cancelling a zero-paid order keeps no zero-amount payment; it is voided', async () => {
    const meal = await order(studentA, 0);
    ok(await mutate(meal.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: '點錯' } }));
    const after = await txDoc(meal.transactionId);
    expect(after).toMatchObject({ type: 'order', status: 'voided', paidAmount: 0 });
    expect((await state()).studentA?.currentBalance).toBe(100);
  });

  it('P10.5 (L11): undoing a payment of 100 restores the balance and takes the 100 back out of cash', async () => {
    const pay = await payment(studentA, 100);
    const receipt = ok(await mutate(pay.transactionId, { kind: 'Undo', payload: { targetCommandId: pay.commandId, reason: UNDO_REASON } }));
    const after = await state();
    expect(after.studentA?.currentBalance).toBe(100);
    expect(after.day?.totals).toEqual(emptyTotals());
    expect((await commandDoc(receipt.commandId))).toMatchObject({
      reason: UNDO_REASON, cashEffect: { before: 100, after: 0, delta: -100, reasonKind: 'refund', refundAmount: 100 },
    });
    expect(after.transactions.map(tx => tx.status)).toEqual(['voided']);
  });

  it('P10.6 (L11): undoing counter income 50 and expense 80 reverses cash only, never a student', async () => {
    const income = await cash('income', 50);
    const undoIncome = ok(await mutate(income.transactionId, { kind: 'Undo', payload: { targetCommandId: income.commandId, reason: UNDO_REASON } }));
    expect((await commandDoc(undoIncome.commandId)).cashEffect).toEqual({ before: 50, after: 0, delta: -50, reasonKind: 'reversal', refundAmount: 0 });

    await env.clearFirestore();
    await seed();
    const expense = await cash('expense', 80);
    const undoExpense = ok(await mutate(expense.transactionId, { kind: 'Undo', payload: { targetCommandId: expense.commandId, reason: UNDO_REASON } }));
    expect((await commandDoc(undoExpense.commandId)).cashEffect).toEqual({ before: -80, after: 0, delta: 80, reasonKind: 'reversal', refundAmount: 0 });
    const after = await state();
    expect(after.day?.totals).toEqual(emptyTotals());
    expect(after.studentA?.currentBalance).toBe(100);
    expect(after.studentA?.revision).toBe(1);
  });

  it('P10.7: undoing a refund puts the money back on the account and out of account refunds', async () => {
    const back = await refund(studentA, 60);
    const receipt = ok(await mutate(back.transactionId, { kind: 'Undo', payload: { targetCommandId: back.commandId, reason: UNDO_REASON } }));
    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(100);
    expect(snapshot.day?.totals.accountRefunds).toBe(0);
    expect((await commandDoc(receipt.commandId)).cashEffect).toEqual({ before: -60, after: 0, delta: 60, reasonKind: 'reversal', refundAmount: 0 });
  });

  it('P10.8: undo is only for the creator, an untouched row and the right creating command', async () => {
    const pay = await payment(studentA, 100);
    expect(await mutate(pay.transactionId, { kind: 'Undo', payload: { targetCommandId: uuid(), reason: UNDO_REASON } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await handLeaseTo(operatorB);
    expect(await mutate(pay.transactionId, { kind: 'Undo', payload: { targetCommandId: pay.commandId, reason: UNDO_REASON } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    // B can still void it with a reason; it is not a security boundary for normal corrections.
    ok(await mutate(pay.transactionId, { kind: 'VoidTransaction', payload: { reason: '重複登記' } }));

    await handLeaseTo(operatorA);
    const second = await payment(studentA, 30);
    ok(await mutate(second.transactionId, correct(await txDoc(second.transactionId), { paidAmount: 40 })));
    expect(await mutate(second.transactionId, { kind: 'Undo', payload: { targetCommandId: second.commandId, reason: UNDO_REASON } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const { createCloudCommandRepository } = await import('../cloudCommandRepository');
    const commands = createCloudCommandRepository(authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) });
    const tx = await txDoc(second.transactionId);
    expect(await commands.commitCommand({
      commandId: uuid(), kind: 'Undo', leaseEpoch: epoch(),
      targets: { transactionId: second.transactionId, studentId: studentA, dayId: today },
      expectedRevisions: { transaction: tx.revision, student: (await state()).studentA?.revision, day: (await state()).day?.revision },
      payload: { targetCommandId: second.commandId, reason: '其他理由' },
    })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('P10.9: voiding a payment lowers balance and receipts; a voided row cannot be changed again', async () => {
    const pay = await payment(studentA, 200);
    const receipt = ok(await mutate(pay.transactionId, { kind: 'VoidTransaction', payload: { reason: '重複登記' } }));
    expect((await commandDoc(receipt.commandId)).cashEffect).toEqual({ before: 200, after: 0, delta: -200, reasonKind: 'correction', refundAmount: 0 });
    const after = await state();
    expect(after.studentA?.currentBalance).toBe(100);
    expect(after.day?.totals.retainedReceipts).toBe(0);
    expect(await mutate(pay.transactionId, { kind: 'VoidTransaction', payload: { reason: '再作廢一次' } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await mutate(pay.transactionId, correct(await txDoc(pay.transactionId), { paidAmount: 150 })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect((await state()).head?.seq).toBe(2);
  });

  it('P10.10: corrections keep the row type: payment stays above zero, expense keeps its direction, nothing-changed is refused', async () => {
    const pay = await payment(studentA, 100);
    expect(await mutate(pay.transactionId, correct(await txDoc(pay.transactionId), { paidAmount: 0 })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await mutate(pay.transactionId, correct(await txDoc(pay.transactionId), {})))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const expense = await cash('expense', 80);
    expect(await mutate(expense.transactionId, correct(await txDoc(expense.transactionId), { mealPrice: 0, paidAmount: 80 })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await mutate(expense.transactionId, correct(await txDoc(expense.transactionId), { note: '' })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await mutate(pay.transactionId, { kind: 'CancelRefund', payload: { reason: '不是訂餐' } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect((await state()).head?.seq).toBe(2);
  });

  it('P10.11: a mistyped collection of 100 corrected to 80 is a book correction of −20; expense 80 corrected to 70', async () => {
    const pay = await payment(studentA, 100);
    const first = ok(await mutate(pay.transactionId, correct(await txDoc(pay.transactionId), { paidAmount: 80 })));
    expect((await commandDoc(first.commandId)).cashEffect).toEqual({ before: 100, after: 80, delta: -20, reasonKind: 'correction', refundAmount: 0 });
    const expense = await cash('expense', 80);
    const second = ok(await mutate(expense.transactionId, correct(await txDoc(expense.transactionId), { mealPrice: 70, note: '廠商找回 10 元' })));
    expect((await commandDoc(second.commandId)).cashEffect).toEqual({ before: -80, after: -70, delta: 10, reasonKind: 'correction', refundAmount: 0 });
    const snapshot = await freshSnapshot();
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(180);
    expect(snapshot.day?.totals).toMatchObject({ retainedReceipts: 80, cashierExpense: 70 });
  });

  it('P10.12: a refund can be corrected down, and up only while the balance stays at zero or more', async () => {
    const back = await refund(studentA, 60);
    ok(await mutate(back.transactionId, correct(await txDoc(back.transactionId), { amount: 40 })));
    let after = await state();
    expect(after.studentA?.currentBalance).toBe(60);
    expect(after.day?.totals.accountRefunds).toBe(40);
    ok(await mutate(back.transactionId, correct(await txDoc(back.transactionId), { amount: 100 })));
    expect(await mutate(back.transactionId, correct(await txDoc(back.transactionId), { amount: 101 })))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    after = await state();
    expect(after.studentA?.currentBalance).toBe(0);
    expect(after.day?.totals.accountRefunds).toBe(100);
  });

  it('P10.13 (A03): two corrections of the same row from one revision: one wins, the other is a revision conflict', async () => {
    const meal = await order(studentA, 0);
    const tx = await txDoc(meal.transactionId);
    const first = await mutationInput(meal.transactionId, correct(tx, { mealPrice: 100 }));
    const second = await mutationInput(meal.transactionId, correct(tx, { mealPrice: 120 }));
    const results = await Promise.all([repository().mutateTransaction(first), repository().mutateTransaction(second)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok).map(result => !result.ok && result.error.code)).toEqual(['REVISION_CONFLICT']);
    const after = await state();
    expect(after.head?.seq).toBe(2);
    expect([100, 120]).toContain(after.transactions[0].mealPrice);
    expect(after.studentA?.currentBalance).toBe(100 - after.transactions[0].mealPrice);
  });

  it('P10.14 (L08): ten retries of one correction apply it once; the same ID with other content is refused', async () => {
    const pay = await payment(studentA, 100);
    const input = await mutationInput(pay.transactionId, correct(await txDoc(pay.transactionId), { paidAmount: 80 }));
    const first = await repository().mutateTransaction(input);
    expect(first.ok).toBe(true);
    const retries = await Promise.all(Array.from({ length: 10 }, () => repository().mutateTransaction(input)));
    for (const retry of retries) expect(retry).toEqual(first);
    expect(await repository().mutateTransaction({
      ...input, payload: { ...(input.payload as RawMap), paidAmount: 70, amount: 70 },
    } as CloudTransactionMutationInput)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const after = await state();
    expect(after.head?.seq).toBe(2);
    expect(after.studentA?.currentBalance).toBe(180);
  });

  it('P10.15 (L06/L07): a closed day refuses every mutation; a reopened earlier day can be corrected but not refunded over the counter', async () => {
    const meal = await order(studentA, 0);
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { status: 'closed' }));
    expect(await mutate(meal.transactionId, correct(await txDoc(meal.transactionId), { mealPrice: 100 })))
      .toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
    expect(await mutate(meal.transactionId, { kind: 'VoidTransaction', payload: { reason: 'x' } }))
      .toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });

    // An earlier reopened day with one paid order, seeded the way an earlier CreateOrder would have left it.
    const yesterday = shiftDate(today, -1);
    const oldId = uuid();
    await withAdmin(async db => {
      await setDoc(doc(db, `days/${yesterday}`), {
        ...dayDoc(yesterday, 'reopened'),
        totals: { ...emptyTotals(), activeTransactionCount: 1, bentoCount: 1, mealTotal: 90, retainedReceipts: 90 },
      });
      await setDoc(doc(db, `transactions/${oldId}`), {
        transactionId: oldId, studentId: studentA, businessDate: yesterday, type: 'order', mealKind: 'bento',
        mealPrice: 90, paidAmount: 90, amount: 0, studentNameSnapshot: 'Synthetic 001', menuNameSnapshot: 'Synthetic Meal',
        menuPriceSnapshot: 90, vendorIdSnapshot: 'p10-vendor', vendorNameSnapshot: 'Synthetic Vendor', otherItemName: null,
        status: 'active', revision: 1, createdAt: serverTimestamp(), createdSeq: 1, operatorUid: operatorA.uid,
        operatorEmail: operatorA.email, sourceDevice: 'pc', note: '', lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
      });
    });
    expect(await mutate(oldId, { kind: 'CancelRefund', payload: { reason: '補退現' } }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    ok(await mutate(oldId, correct(await txDoc(oldId), { paidAmount: 80 }, '紙本補正：當天實收 80')));
    const after = await state(yesterday);
    expect(after.day?.totals).toMatchObject({ retainedReceipts: 80, activeTransactionCount: 1 });
    expect(after.studentA?.currentBalance).toBe(100 - 90 - 10);
    const corrected = await txDoc(oldId);
    expect(corrected).toMatchObject({ businessDate: yesterday, studentId: studentA, createdSeq: 1, revision: 2 });
  });

  it('P10.16: an inactive account can still have an existing meal corrected or cancelled', async () => {
    const meal = await order(studentA, 0);
    await withAdmin(async db => updateDoc(doc(db, `students/${studentA}`), { status: 'inactive' }));
    ok(await mutate(meal.transactionId, correct(await txDoc(meal.transactionId), { mealPrice: 80 })));
    ok(await mutate(meal.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: '停用前取消' } }));
    expect((await state()).studentA).toMatchObject({ status: 'inactive', currentBalance: 100 });
  });

  it('P10.17: legal maximum payloads (500-char reason and note) stay under the expression ceiling', async () => {
    const meal = await order(studentA, 1_000_000, { mealKind: 'other', mealPrice: 1_000_000, menuRevision: null, otherItemName: '食'.repeat(100) });
    ok(await mutate(meal.transactionId, correct(await txDoc(meal.transactionId), { mealPrice: 999_999, note: '註'.repeat(500) }, '理'.repeat(500))));
    ok(await mutate(meal.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: '理'.repeat(500) } }));
    const bento = await order(studentB, 90);
    ok(await mutate(bento.transactionId, { kind: 'CancelRefund', payload: { reason: '退'.repeat(500) } }));
    const expense = await cash('expense', 1_000_000);
    ok(await mutate(expense.transactionId, { kind: 'Undo', payload: { targetCommandId: expense.commandId, reason: UNDO_REASON } }));
    const back = await refund(studentA, 500);
    ok(await mutate(back.transactionId, correct(await txDoc(back.transactionId), { amount: 400, note: '退'.repeat(500) }, '理'.repeat(500))));
    const raw = await rawMutationArtifacts((await payment(studentB, 1_000_000)).transactionId, {
      kind: 'VoidTransaction', payload: { reason: 'r'.repeat(500) },
    });
    await assertSucceeds(rawMutationBatch(authedDb(operatorA), raw).commit());
    const snapshot = await freshSnapshot();
    expect(snapshot.transactions.filter((tx: CloudOrderTransactionRecord) => tx.status === 'voided')).toHaveLength(3);
  });

  it('P10.18: a raw SDK correction closure commits for the holder and is denied for a non-holder', async () => {
    const meal = await order(studentA, 0);
    const raw = await rawMutationArtifacts(meal.transactionId, correct(await txDoc(meal.transactionId), { mealPrice: 110 }) as TransactionMutationPayload);
    await expectRawDenied(raw, {}, operatorB);
    await assertSucceeds(rawMutationBatch(authedDb(operatorA), raw).commit());
    const after = await state();
    expect(after.studentA?.currentBalance).toBe(-10);
    expect(after.day?.totals.mealTotal).toBe(110);
  });

  it.each<[string, (a: RawMutation) => void]>([
    ['the student balance is not adjusted', a => { a.studentAfter!.currentBalance = a.studentBefore!.currentBalance; syncSnapshots(a); }],
    ['the student balance is adjusted twice', a => { a.studentAfter!.currentBalance -= 20; syncSnapshots(a); }],
    ['the student status changes in the same write', a => { a.studentAfter!.status = 'inactive'; syncSnapshots(a); }],
    ['the day meal total is not adjusted', a => { a.dayAfter.totals = { ...a.dayBefore.totals }; syncSnapshots(a); }],
    ['the day meal count changes too', a => { a.dayAfter.totals = { ...a.dayAfter.totals, bentoCount: 0 }; syncSnapshots(a); }],
    ['the day status changes in the same write', a => { a.dayAfter.status = 'closed'; syncSnapshots(a); }],
    ['the transaction moves to another account', a => { a.transactionAfter.studentId = studentB; syncSnapshots(a); }],
    ['the transaction moves to another date', a => { a.transactionAfter.businessDate = shiftDate(today, -1); syncSnapshots(a); }],
    ['the transaction creation time changes', a => { a.transactionAfter.createdAt = serverTimestamp(); syncSnapshots(a); }],
    ['the transaction creation seq changes', a => { a.transactionAfter.createdSeq = 99; syncSnapshots(a); }],
    ['a correction changes the row type', a => { a.transactionAfter.type = 'payment'; syncSnapshots(a); }],
    ['a correction leaves amount inconsistent', a => { a.transactionAfter.amount = 0; a.command.payload = { ...a.command.payload, amount: 0 }; syncSnapshots(a); }],
    ['the transaction gains an extra field', a => { a.transactionAfter.extraField = 'x'; syncSnapshots(a); }],
    ['the transaction revision is not advanced', a => { a.transactionAfter.revision = a.txBefore.revision; syncSnapshots(a); }],
    ['the cash effect is called a refund', a => {
      a.command.cashEffect = { before: 0, after: 0, delta: 0, reasonKind: 'refund', refundAmount: 0 };
    }],
    ['the cash effect hides the change', a => { a.command.cashEffect = { ...a.command.cashEffect, delta: 5 }; }],
    ['the command reason is null', a => { a.command.reason = null; }],
    ['the command reason differs from the payload', a => { a.command.reason = 'different'; }],
    ['the payload reason is empty', a => { a.command.payload = { ...a.command.payload, reason: '' }; a.command.reason = ''; }],
    ['the command claims another student', a => { a.command.studentId = studentB; }],
    ['the expected transaction revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, transaction: 7 }; }],
    ['the command before-snapshot lies about the old row', a => {
      a.command.before = { ...a.command.before, transaction: { ...a.txBefore, mealPrice: 0, amount: 0 } };
    }],
  ])('P10.19 (L09): a raw SDK correction is denied atomically when %s', async (_label, attack) => {
    const meal = await order(studentA, 50);
    const raw = await rawMutationArtifacts(meal.transactionId, correct(await txDoc(meal.transactionId), { mealPrice: 110 }) as TransactionMutationPayload);
    attack(raw);
    await expectRawDenied(raw);
  });

  it('P10.20 (L09): a raw SDK mutation cannot skip the transaction, student or day write', async () => {
    const meal = await order(studentA, 50);
    const spec = correct(await txDoc(meal.transactionId), { mealPrice: 110 }) as TransactionMutationPayload;
    await expectRawDenied(await rawMutationArtifacts(meal.transactionId, spec), { omitTransaction: true });
    await expectRawDenied(await rawMutationArtifacts(meal.transactionId, spec), { omitStudent: true });
    await expectRawDenied(await rawMutationArtifacts(meal.transactionId, spec), { omitDay: true });
  });

  it('P10.21 (L09): a transaction cannot be updated or deleted without a command, even by the holder', async () => {
    const meal = await order(studentA, 50);
    const db = authedDb(operatorA);
    const before = await state();
    await assertFails(updateDoc(doc(db, `transactions/${meal.transactionId}`), { mealPrice: 0, amount: 50 }));
    await assertFails(updateDoc(doc(db, `transactions/${meal.transactionId}`), { status: 'voided' }));
    await assertFails(deleteDoc(doc(db, `transactions/${meal.transactionId}`)));
    expect(await state()).toEqual(before);
  });

  it('P10.22: raw SDK cancels and undo are denied outside their own rules', async () => {
    // Undo of a row created by another operator.
    const pay = await payment(studentA, 100);
    await handLeaseTo(operatorB);
    await expectRawDenied(await rawMutationArtifacts(pay.transactionId, {
      kind: 'Undo', payload: { targetCommandId: pay.commandId, reason: UNDO_REASON },
    }, operatorB), {}, operatorB);
    await handLeaseTo(operatorA);
    // CancelRefund on a payment row.
    const cancelPayment = await rawMutationArtifacts(pay.transactionId, { kind: 'VoidTransaction', payload: { reason: 'x' } });
    cancelPayment.command.kind = 'CancelRefund';
    cancelPayment.command.cashEffect = { before: 100, after: 0, delta: -100, reasonKind: 'refund', refundAmount: 100 };
    cancelPayment.command.inputFingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput({
      commandId: cancelPayment.commandId, kind: 'CancelRefund', leaseEpoch: epoch(),
      targets: cancelPayment.command.targets, expectedRevisions: cancelPayment.command.expectedRevisions,
      payload: cancelPayment.command.payload,
    }));
    await expectRawDenied(cancelPayment);
    // CancelKeepDeposit that leaves a zero-amount payment instead of voiding.
    const zero = await order(studentA, 0);
    const keep = await rawMutationArtifacts(zero.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: 'x' } });
    keep.transactionAfter = {
      ...keep.txBefore, type: 'payment', mealKind: null, mealPrice: 0, amount: 0, menuNameSnapshot: '', menuPriceSnapshot: 0,
      vendorIdSnapshot: '', vendorNameSnapshot: '', revision: keep.txBefore.revision + 1, lastCommandId: keep.commandId,
      updatedAt: serverTimestamp(),
    };
    keep.dayAfter.totals = { ...keep.dayBefore.totals, bentoCount: keep.dayBefore.totals.bentoCount - 1, mealTotal: keep.dayBefore.totals.mealTotal - 90 };
    keep.studentAfter!.currentBalance = keep.studentBefore!.currentBalance + 90;
    syncSnapshots(keep);
    await expectRawDenied(keep);
    // Undo with revision 2 (already corrected).
    const later = await payment(studentA, 30);
    ok(await mutate(later.transactionId, correct(await txDoc(later.transactionId), { paidAmount: 40 })));
    const laterUndo = await rawMutationArtifacts(later.transactionId, { kind: 'VoidTransaction', payload: { reason: UNDO_REASON } });
    laterUndo.command.kind = 'Undo';
    laterUndo.command.payload = { targetCommandId: later.commandId, reason: UNDO_REASON };
    laterUndo.command.cashEffect = { before: 40, after: 0, delta: -40, reasonKind: 'refund', refundAmount: 40 };
    await expectRawDenied(laterUndo);
  });

  it('P10.23: a counter-cash mutation cannot touch a student, and a student mutation cannot pose as counter cash', async () => {
    const expense = await cash('expense', 80);
    const raw = await rawMutationArtifacts(expense.transactionId, { kind: 'VoidTransaction', payload: { reason: '記錯' } });
    // Smuggle a student balance change into the counter-cash closure.
    const holderDb = authedDb(operatorA);
    const smuggled = rawMutationBatch(holderDb, raw);
    smuggled.update(doc(holderDb, `students/${studentA}`), { currentBalance: 999 });
    const before = await state();
    await assertFails(smuggled.commit());
    expect(await state()).toEqual(before);
    await assertSucceeds(rawMutationBatch(authedDb(operatorA), raw).commit());
    expect((await state()).day?.totals.cashierExpense).toBe(0);
  });

  it('P10.24: reads after mutations reconcile; voided rows are returned and contribute nothing', async () => {
    const a = await order(studentA, 100);
    const b = await payment(studentA, 50);
    const c = await cash('income', 30);
    ok(await mutate(a.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: 'x' } }));
    ok(await mutate(b.transactionId, { kind: 'VoidTransaction', payload: { reason: 'x' } }));
    ok(await mutate(c.transactionId, correct(await txDoc(c.transactionId), { paidAmount: 20 })));
    const snapshot = await freshSnapshot();
    expect(snapshot.transactions.map(tx => [tx.type, tx.status])).toEqual([['payment', 'active'], ['payment', 'voided'], ['expense', 'active']]);
    expect(snapshot.day?.totals).toEqual({ ...emptyTotals(), activeTransactionCount: 2, retainedReceipts: 100, cashierIncome: 20 });
    expect(snapshot.students.find(item => item.studentId === studentA)?.currentBalance).toBe(200);
  });
});
