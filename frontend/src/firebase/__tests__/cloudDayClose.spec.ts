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
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_DAY_CLOSE === 'true';
if (required && !emulatorHost) throw new Error('P11 day-close Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p11-close-a', email: 'p11-close-a@example.test', displayName: 'Synthetic Close A', active: true };
const operatorB = { uid: 'p11-close-b', email: 'p11-close-b@example.test', displayName: 'Synthetic Close B', active: true };
const studentA = '55555555-5555-4555-8555-555555555555';
const seedCommandId = '00000000-0000-4000-8000-0000000000c1';

let env: RulesTestEnvironment;
let today = '';

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

function repository(operator: typeof operatorA = operatorA) {
  return createCloudDayCloseRepository(authedDb(operator), { currentUser: () => fakeCurrentUser(operator) });
}

function writer(operator: typeof operatorA = operatorA) {
  return createCloudCommandRepository(authedDb(operator), { currentUser: () => fakeCurrentUser(operator) });
}

/** Spec L05: opening 1,000, receipts 200, counter income 50, expense 80 → expected 1,170. */
function totals() {
  return {
    activeTransactionCount: 4, bentoCount: 2, otherMealCount: 0, mealTotal: 180,
    retainedReceipts: 200, cashierIncome: 50, cashierExpense: 80, accountRefunds: 0,
  };
}

function dayDoc(date: string, openingCash: number | null = 1000) {
  return {
    status: 'open', revision: 6,
    menu: {
      businessDate: date, itemName: 'Synthetic Meal', price: 90, vendorId: 'p11-vendor',
      vendorNameSnapshot: 'Synthetic Vendor', updatedAt: serverTimestamp(), revision: 1, inheritedFromDate: null,
    },
    openingCash, openedBy: openingCash === null ? null : operatorA.uid, openedAt: openingCash === null ? null : serverTimestamp(),
    totals: totals(), lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

async function seed(options: { openingCash?: number | null } = {}) {
  today = taipeiDate(new Date());
  await withAdmin(async db => {
    await setDoc(doc(db, `operators/${operatorA.uid}`), { ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, `operators/${operatorB.uid}`), { ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: operatorA.uid, epoch: 1, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p11-close-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: shiftDate(today, -30), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `students/${studentA}`), {
      studentId: studentA, studentCode: '001', displayName: 'Synthetic 001', aliases: [], status: 'active',
      openingBalance: { amount: 100, asOfDate: today, note: '', createdAt: serverTimestamp() },
      currentBalance: 100, createdAt: serverTimestamp(), revision: 1, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'studentCodes/001'), { studentId: studentA, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `days/${today}`), dayDoc(today, options.openingCash === undefined ? 1000 : options.openingCash));
  });
}

let idCounter = 0;
function uuid(): string {
  idCounter += 1;
  return `${crypto.randomUUID().slice(0, 24)}${idCounter.toString(16).padStart(12, '0')}`;
}

function ok(result: CommandResult): { commandId: string; seq: number } {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.receipt;
}

async function read(pathName: string): Promise<RawMap | undefined> {
  return withAdmin(async db => (await getDoc(doc(db, pathName))).data() as RawMap | undefined);
}

async function state(dayId = today) {
  return withAdmin(async db => {
    const [head, day, student, commands, settlements] = await Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${dayId}`)),
      getDoc(doc(db, `students/${studentA}`)),
      getDocs(collection(db, 'commands')),
      getDocs(collection(db, `days/${dayId}/settlements`)),
    ]);
    return {
      head: head.data(), day: day.data(), student: student.data(), commandCount: commands.size,
      settlements: Object.fromEntries(settlements.docs.map(item => [item.id, item.data()])),
    };
  });
}

async function closeInput(change: { countedCash: number; note?: string; expectedCash?: number }, dayId = today) {
  const day = (await read(`days/${dayId}`))!;
  const t = day.totals;
  return {
    commandId: uuid(), leaseEpoch: 1, dayId,
    expectedDayRevision: day.revision, expectedSettlementRevision: day.lastSettlementRevision,
    expectedCash: change.expectedCash ?? day.openingCash + t.retainedReceipts + t.cashierIncome - t.cashierExpense - t.accountRefunds,
    countedCash: change.countedCash, note: change.note ?? '',
  };
}

async function reopenInput(reason: string, dayId = today) {
  const day = (await read(`days/${dayId}`))!;
  return {
    commandId: uuid(), leaseEpoch: 1, dayId,
    expectedDayRevision: day.revision, expectedSettlementRevision: day.lastSettlementRevision, reason,
  };
}

/** A complete raw SDK CloseDay／ReopenDay closure, built the same way as the repository. */
async function rawSettlement(kind: 'CloseDay' | 'ReopenDay', change: { countedCash?: number; note?: string; reason?: string } = {}, actor = operatorA) {
  const commandId = uuid();
  const dayId = today;
  const headBefore = (await read('system/dataHead'))!;
  const dayBefore = (await read(`days/${dayId}`))!;
  const last = dayBefore.lastSettlementRevision as number;
  const revision = last + 1;
  const previous = last === 0 ? null : (await read(`days/${dayId}/settlements/${last}`))!;
  const t = dayBefore.totals;
  const expectedCash = (dayBefore.openingCash ?? 0) + t.retainedReceipts + t.cashierIncome - t.cashierExpense - t.accountRefunds;
  const close = kind === 'CloseDay';
  const payload: RawMap = close
    ? { countedCash: change.countedCash ?? expectedCash, note: change.note ?? '', expectedCash }
    : { reason: change.reason ?? '補登漏記的繳費' };
  const input = {
    commandId, kind, leaseEpoch: 1, targets: { dayId, settlementRevision: revision },
    expectedRevisions: { day: dayBefore.revision, settlement: last }, payload,
  };
  // A deliberately invalid payload (no reason, empty note with a difference) has no canonical form;
  // Rules only check the fingerprint's format, so any hex digest exercises the same Rules path.
  let fingerprint = 'f'.repeat(64);
  try { fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input)); } catch { /* invalid on purpose */ }
  const now = serverTimestamp();
  const headAfter: RawMap = { ...headBefore, seq: headBefore.seq + 1, lastCommandId: commandId, updatedAt: now };
  const dayAfter: RawMap = {
    ...dayBefore, status: close ? 'closed' : 'reopened', lastSettlementRevision: revision,
    revision: dayBefore.revision + 1, lastCommandId: commandId, updatedAt: now,
  };
  const settlement: RawMap = {
    dayId, revision, status: close ? 'closed' : 'reopened', totals: dayBefore.totals,
    openingCash: dayBefore.openingCash, expectedCash,
    countedCash: close ? payload.countedCash : null,
    difference: close ? payload.countedCash - expectedCash : null,
    note: close ? payload.note : payload.reason,
    actorUid: actor.uid, actorEmail: actor.email, sourceSeq: headBefore.seq + 1, committedAt: now,
    previousRevision: last, lastCommandId: commandId,
  };
  const command: RawMap = {
    commandId, kind, seq: headBefore.seq + 1, leaseEpoch: 1,
    actor: { uid: actor.uid, email: actor.email }, committedAt: now,
    businessDate: dayId, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
    before: {}, after: {}, reason: close ? null : payload.reason,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload, inputFingerprint: fingerprint,
  };
  const artifacts = { commandId, dayId, revision, command, headBefore, headAfter, dayBefore, dayAfter, previous, settlement, settlementPath: `days/${dayId}/settlements/${revision}` };
  syncSnapshots(artifacts);
  return artifacts;
}

type RawClose = Awaited<ReturnType<typeof rawSettlement>>;

/** Keeps the command before/after snapshots in sync when an attack case edits a projection. */
function syncSnapshots(a: RawClose) {
  a.command.before = { head: a.headBefore, day: a.dayBefore, previousSettlement: a.previous };
  a.command.after = { head: a.headAfter, day: a.dayAfter, settlement: a.settlement };
}

type BatchOptions = { omitDay?: boolean; omitSettlement?: boolean; twinSettlementPath?: string };

function rawBatch(db: Firestore, a: RawClose, options: BatchOptions = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'system/dataHead'), a.headAfter);
  if (!options.omitDay) batch.update(doc(db, `days/${a.dayId}`), a.dayAfter);
  if (!options.omitSettlement) batch.set(doc(db, a.settlementPath), a.settlement);
  if (options.twinSettlementPath) batch.set(doc(db, options.twinSettlementPath), a.settlement);
  batch.set(doc(db, `commands/${a.commandId}`), a.command);
  return batch;
}

async function expectRawDenied(a: RawClose, options: BatchOptions = {}, actor = operatorA) {
  const before = await state();
  await assertFails(rawBatch(authedDb(actor), a, options).commit());
  expect(await state()).toEqual(before);
}

async function revisions() {
  const [student, day] = await Promise.all([read(`students/${studentA}`), read(`days/${today}`)]);
  return { student: student!.revision as number, day: day!.revision as number };
}

async function createPayment(paidAmount: number) {
  const r = await revisions();
  const transactionId = uuid();
  return {
    transactionId,
    result: await writer().commitCommand({
      commandId: uuid(), kind: 'CreatePayment', leaseEpoch: 1,
      targets: { transactionId, studentId: studentA, dayId: today },
      expectedRevisions: { transaction: 0, student: r.student, day: r.day },
      payload: { paidAmount, note: '' },
    }),
  };
}

describeWithEmulator('P11 CloseDay／ReopenDay: repository, receipt and production Rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: {
        rules: readFileSync(rulesPath, 'utf8'),
        host: emulatorHost!.split(':')[0],
        port: Number(emulatorHost!.split(':')[1] || '8080'),
      },
    });
  }, 60_000);

  beforeEach(async () => {
    await env.clearFirestore();
    await seed();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('P11.1 (L05): expected 1,170 and counted 1,160 cannot close without a reason; with one it closes into version 1', async () => {
    const before = await state();
    const noReason = await repository().closeDay(await closeInput({ countedCash: 1160 }));
    expect(noReason).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state()).toEqual(before);
    await expectRawDenied(await rawSettlement('CloseDay', { countedCash: 1160, note: '' }));

    const input = await closeInput({ countedCash: 1160, note: '找零少收 10 元' });
    expect(input.expectedCash).toBe(1170);
    const receipt = ok(await repository().closeDay(input));
    const after = await state();
    expect(after.day).toMatchObject({
      status: 'closed', revision: 7, lastSettlementRevision: 1, lastCommandId: receipt.commandId,
      openingCash: 1000, totals: totals(),
    });
    expect(after.day!.menu).toEqual(before.day!.menu);
    expect(after.settlements['1']).toMatchObject({
      dayId: today, revision: 1, status: 'closed', totals: totals(), openingCash: 1000, expectedCash: 1170,
      countedCash: 1160, difference: -10, note: '找零少收 10 元', actorUid: operatorA.uid, actorEmail: operatorA.email,
      sourceSeq: 1, previousRevision: 0, lastCommandId: receipt.commandId,
    });
    expect(after.settlements['1']!.committedAt).toEqual(after.day!.updatedAt);

    const stored = (await read(`commands/${receipt.commandId}`))!;
    expect(stored).toMatchObject({
      kind: 'CloseDay', businessDate: today, studentId: null, reason: null,
      targets: { dayId: today, settlementRevision: 1 }, expectedRevisions: { day: 6, settlement: 0 },
      payload: { countedCash: 1160, note: '找零少收 10 元', expectedCash: 1170 },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
    expect(stored.before.previousSettlement).toBeNull();
    expect(await repository().readCommand(receipt.commandId)).toMatchObject({ commandId: receipt.commandId, kind: 'CloseDay', seq: 1 });
    const view = await repository().read(today);
    expect(view).toMatchObject({ status: 'closed', expectedCash: 1170, lastSettlementRevision: 1, seq: 1 });
    expect(view!.settlements).toHaveLength(1);
  });

  it('P11.2: a counted amount equal to expected closes without a note', async () => {
    ok(await repository().closeDay(await closeInput({ countedCash: 1170 })));
    expect((await state()).settlements['1']).toMatchObject({ countedCash: 1170, difference: 0, note: '' });
  });

  it('P11.3: a day without a confirmed opening cash cannot be closed', async () => {
    await env.clearFirestore();
    await seed({ openingCash: null });
    const before = await state();
    const refused = await repository().closeDay(await closeInput({ countedCash: 270, note: '無開帳' }));
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state()).toEqual(before);
    const raw = await rawSettlement('CloseDay', { countedCash: 0, note: '無開帳' });
    await expectRawDenied(raw);
    expect((await repository().read(today))?.expectedCash).toBeNull();
  });

  it('P11.4: a second close is DAY_CLOSED; retries return the same receipt; the same ID with other content is refused', async () => {
    const input = await closeInput({ countedCash: 1170 });
    const first = ok(await repository().closeDay(input));
    for (let index = 0; index < 3; index += 1) expect(ok(await repository().closeDay(input))).toEqual(first);
    const again = await repository().closeDay(await closeInput({ countedCash: 1170 }));
    expect(again).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
    const sameIdOtherContent = await repository().closeDay({ ...input, countedCash: 1100, note: '改數' });
    expect(sameIdOtherContent.ok).toBe(false);
    const after = await state();
    expect(after.commandCount).toBe(1);
    expect(Object.keys(after.settlements)).toEqual(['1']);
  });

  it('P11.5 (L06): a close racing a payment ends in one consistent order; the loser changes nothing', async () => {
    const close = await closeInput({ countedCash: 1170 });
    const r = await revisions();
    const transactionId = uuid();
    const [closeResult, paymentResult] = await Promise.all([
      repository().closeDay(close),
      writer().commitCommand({
        commandId: uuid(), kind: 'CreatePayment', leaseEpoch: 1,
        targets: { transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: 0, student: r.student, day: r.day },
        payload: { paidAmount: 30, note: '' },
      }),
    ]);
    expect([closeResult.ok, paymentResult.ok].filter(Boolean)).toHaveLength(1);
    const after = await state();
    expect(after.commandCount).toBe(1);
    if (closeResult.ok) {
      expect(after.day).toMatchObject({ status: 'closed', totals: totals() });
      expect(await read(`transactions/${transactionId}`)).toBeUndefined();
      expect(after.settlements['1']!.totals).toEqual(after.day!.totals);
    } else {
      expect(after.day).toMatchObject({ status: 'open', totals: { ...totals(), activeTransactionCount: 5, retainedReceipts: 230 } });
      expect(after.settlements).toEqual({});
    }
  });

  it('P11.6: on a closed day every business write is refused, and the day status cannot be set directly', async () => {
    const { transactionId, result } = await createPayment(30);
    ok(result);
    ok(await repository().closeDay(await closeInput({ countedCash: 1200 })));
    const before = await state();
    const r = await revisions();
    const tx = (await read(`transactions/${transactionId}`))!;
    const attempts: unknown[] = [
      { kind: 'CreatePayment', targets: { transactionId: uuid(), studentId: studentA, dayId: today },
        expectedRevisions: { transaction: 0, student: r.student, day: r.day }, payload: { paidAmount: 10, note: '' } },
      { kind: 'CreateOrder', targets: { transactionId: uuid(), studentId: studentA, dayId: today },
        expectedRevisions: { transaction: 0, student: r.student, day: r.day },
        payload: { mealPrice: 90, paidAmount: 0, mealKind: 'other', menuRevision: null, otherItemName: '其他', note: '' } },
      { kind: 'CreateCashMovement', targets: { transactionId: uuid(), dayId: today },
        expectedRevisions: { transaction: 0, day: r.day }, payload: { mealPrice: 0, paidAmount: 50, reason: '雜收' } },
      { kind: 'CreateRefund', targets: { transactionId: uuid(), studentId: studentA, dayId: today },
        expectedRevisions: { transaction: 0, student: r.student, day: r.day }, payload: { amount: 10, reason: '退款' } },
      { kind: 'VoidTransaction', targets: { transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day }, payload: { reason: '誤收' } },
      { kind: 'SetOpeningCash', targets: { dayId: today }, expectedRevisions: { day: r.day }, payload: { openingCash: 900 } },
      { kind: 'SetDayMenu', targets: { dayId: today }, expectedRevisions: { day: r.day, headSeq: before.head!.seq },
        payload: { selectionDate: today, itemName: 'Other', price: 80, vendorId: 'p11-vendor', vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null } },
      { kind: 'CorrectOpening', targets: { studentId: studentA, dayId: today },
        expectedRevisions: { student: r.student, day: r.day }, payload: { amount: 50, note: '', reason: '期初抄錯' } },
    ];
    for (const attempt of attempts) {
      const result = await writer().commitCommand({ commandId: uuid(), leaseEpoch: 1, ...(attempt as object) });
      expect(result.ok, JSON.stringify(attempt)).toBe(false);
    }
    expect(await state()).toEqual(before);

    const db = authedDb(operatorA);
    await assertFails(updateDoc(doc(db, `days/${today}`), {
      status: 'open', revision: before.day!.revision + 1, lastCommandId: before.day!.lastCommandId, updatedAt: serverTimestamp(),
    }));
    expect(await state()).toEqual(before);
  });

  it('P11.7: reopen adds version 2, a correction is then allowed, and re-closing adds version 3 without touching 1 or 2', async () => {
    const { transactionId } = await createPayment(30);
    ok(await repository().closeDay(await closeInput({ countedCash: 1200 })));
    const version1 = (await state()).settlements['1'];

    const reopened = ok(await repository().reopenDay(await reopenInput('紙本對帳發現一筆誤收')));
    let current = await state();
    expect(current.day).toMatchObject({ status: 'reopened', lastSettlementRevision: 2, lastCommandId: reopened.commandId });
    expect(current.settlements['2']).toMatchObject({
      revision: 2, status: 'reopened', countedCash: null, difference: null, note: '紙本對帳發現一筆誤收',
      expectedCash: 1200, previousRevision: 1, sourceSeq: 3,
    });
    expect(current.settlements['1']).toEqual(version1);
    expect((await read(`commands/${reopened.commandId}`))!).toMatchObject({ reason: '紙本對帳發現一筆誤收', before: { previousSettlement: version1 } });

    const r = await revisions();
    const tx = (await read(`transactions/${transactionId}`))!;
    ok(await writer().commitCommand({
      commandId: uuid(), kind: 'VoidTransaction', leaseEpoch: 1, targets: { transactionId, studentId: studentA, dayId: today },
      expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day }, payload: { reason: '誤收' },
    }));
    ok(await repository().closeDay(await closeInput({ countedCash: 1170 })));
    current = await state();
    expect(current.day).toMatchObject({ status: 'closed', lastSettlementRevision: 3 });
    expect(current.settlements['3']).toMatchObject({ status: 'closed', expectedCash: 1170, countedCash: 1170, previousRevision: 2 });
    expect(current.settlements['1']).toEqual(version1);
    const view = await repository().read(today);
    expect(view!.settlements.map(version => [version.revision, version.status])).toEqual([[1, 'closed'], [2, 'reopened'], [3, 'closed']]);
  });

  it('P11.8: reopen needs a closed day and a reason; a future day cannot be closed', async () => {
    const before = await state();
    expect(await repository().reopenDay(await reopenInput('理由'))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expectRawDenied(await rawSettlement('ReopenDay'));
    ok(await repository().closeDay(await closeInput({ countedCash: 1170 })));
    expect(await repository().reopenDay(await reopenInput(''))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    await expectRawDenied(await rawSettlement('ReopenDay', { reason: '' }));
    expect((await state()).day!.status).toBe('closed');

    const tomorrow = shiftDate(today, 1);
    await withAdmin(async db => setDoc(doc(db, `days/${tomorrow}`), dayDoc(tomorrow)));
    const futureBefore = await state(tomorrow);
    const future = await repository().closeDay(await closeInput({ countedCash: 1170 }, tomorrow));
    expect(future).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state(tomorrow)).toEqual(futureBefore);
    expect(before.day!.status).toBe('open');
  });

  it('P11.9: legal maximum payloads stay under the expression ceiling, and a raw closure works only for the holder', async () => {
    ok(await repository().closeDay(await closeInput({ countedCash: 1_000_000_000, note: '差'.repeat(500) })));
    ok(await repository().reopenDay(await reopenInput('因'.repeat(500))));
    const raw = await rawSettlement('CloseDay', { countedCash: 1170 });
    await expectRawDenied(raw, {}, operatorB);
    await assertSucceeds(rawBatch(authedDb(operatorA), raw).commit());
    expect((await state()).settlements['3']).toMatchObject({ status: 'closed', countedCash: 1170 });
  });

  it.each<[string, (a: RawClose) => void]>([
    ['the expected cash is not the day formula', a => {
      a.command.payload = { ...a.command.payload, expectedCash: 1160, countedCash: 1160 };
      a.settlement.expectedCash = 1160; a.settlement.countedCash = 1160; a.settlement.difference = 0; syncSnapshots(a);
    }],
    ['the counted cash is negative', a => {
      a.command.payload = { ...a.command.payload, countedCash: -1, note: '負數' };
      a.settlement.countedCash = -1; a.settlement.difference = -1171; a.settlement.note = '負數'; syncSnapshots(a);
    }],
    ['the settlement difference is not counted − expected', a => { a.settlement.difference = 5; syncSnapshots(a); }],
    ['the settlement totals differ from the day', a => { a.settlement.totals = { ...a.settlement.totals, retainedReceipts: 150 }; syncSnapshots(a); }],
    ['the settlement opening cash differs from the day', a => { a.settlement.openingCash = 900; syncSnapshots(a); }],
    ['the settlement status says reopened', a => { a.settlement.status = 'reopened'; syncSnapshots(a); }],
    ['the settlement note differs from the payload', a => { a.settlement.note = 'other'; syncSnapshots(a); }],
    ['the settlement names another actor', a => { a.settlement.actorUid = operatorB.uid; syncSnapshots(a); }],
    ['the settlement source seq is wrong', a => { a.settlement.sourceSeq = 99; syncSnapshots(a); }],
    ['the settlement previous revision is wrong', a => { a.settlement.previousRevision = 1; syncSnapshots(a); }],
    ['the settlement gains an extra field', a => { a.settlement.extra = true; syncSnapshots(a); }],
    ['the settlement is written at another revision path', a => { a.settlementPath = `days/${a.dayId}/settlements/2`; }],
    ['the day totals change', a => { a.dayAfter.totals = { ...a.dayAfter.totals, retainedReceipts: 190 }; syncSnapshots(a); }],
    ['the day opening cash changes', a => { a.dayAfter.openingCash = 990; syncSnapshots(a); }],
    ['the day menu changes', a => { a.dayAfter.menu = null; syncSnapshots(a); }],
    ['the day stays open', a => { a.dayAfter.status = 'open'; syncSnapshots(a); }],
    ['the day settlement pointer is not advanced', a => { a.dayAfter.lastSettlementRevision = 0; syncSnapshots(a); }],
    ['the day revision is not advanced', a => { a.dayAfter.revision = a.dayBefore.revision; syncSnapshots(a); }],
    ['the cash effect is not zero', a => { a.command.cashEffect = { before: 0, after: -10, delta: -10, reasonKind: 'correction', refundAmount: 0 }; }],
    ['the command reason is set', a => { a.command.reason = '理由'; }],
    ['the business date is another day', a => { a.command.businessDate = shiftDate(today, -1); }],
    ['the command names a student', a => { a.command.studentId = studentA; }],
    ['the payload gains an extra key', a => { a.command.payload = { ...a.command.payload, reason: 'x' }; }],
    ['the payload note is too long', a => {
      const note = 'x'.repeat(501);
      a.command.payload = { ...a.command.payload, countedCash: 1160, note };
      a.settlement.countedCash = 1160; a.settlement.difference = -10; a.settlement.note = note; syncSnapshots(a);
    }],
    ['the payload expected cash is forged to equal the counted cash and skip the note', a => {
      a.command.payload = { countedCash: 1160, note: '', expectedCash: 1160 };
      a.settlement.countedCash = 1160; a.settlement.difference = -10; a.settlement.note = ''; syncSnapshots(a);
    }],
    ['the expected settlement revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, settlement: 1 }; }],
    ['the expected day revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, day: 1 }; }],
    ['the target settlement revision skips ahead', a => { a.command.targets = { ...a.command.targets, settlementRevision: 2 }; }],
    ['the before-snapshot invents a previous settlement', a => { a.command.before = { ...a.command.before, previousSettlement: { revision: 0 } }; }],
    ['the before-snapshot lies about the day totals', a => {
      a.command.before = { ...a.command.before, day: { ...a.dayBefore, totals: { ...a.dayBefore.totals, cashierExpense: 0 } } };
    }],
    ['the after-snapshot gains an extra projection', a => { a.command.after = { ...a.command.after, transaction: null }; }],
  ])('P11.10: a raw CloseDay is denied atomically when %s', async (_label, attack) => {
    const raw = await rawSettlement('CloseDay', { countedCash: 1170 });
    attack(raw);
    await expectRawDenied(raw);
  });

  it.each<[string, (a: RawClose) => void]>([
    ['the reopened version carries a counted cash', a => { a.settlement.countedCash = 1170; a.settlement.difference = 0; syncSnapshots(a); }],
    ['the reopened version note is not the reason', a => { a.settlement.note = 'other'; syncSnapshots(a); }],
    ['the command reason differs from the payload', a => { a.command.reason = 'other'; }],
    ['the payload gains an extra key', a => { a.command.payload = { ...a.command.payload, note: '' }; }],
    ['the day becomes open instead of reopened', a => { a.dayAfter.status = 'open'; syncSnapshots(a); }],
    ['the previous settlement snapshot is dropped', a => { a.command.before = { ...a.command.before, previousSettlement: null }; }],
    ['the previous settlement snapshot is altered', a => {
      a.command.before = { ...a.command.before, previousSettlement: { ...a.previous, countedCash: 1100 } };
    }],
  ])('P11.11: a raw ReopenDay is denied atomically when %s', async (_label, attack) => {
    ok(await repository().closeDay(await closeInput({ countedCash: 1170 })));
    const raw = await rawSettlement('ReopenDay', { reason: '補登' });
    attack(raw);
    await expectRawDenied(raw);
  });

  it('P11.12: a closure cannot skip the day or settlement write; versions cannot be edited, deleted or forged', async () => {
    await expectRawDenied(await rawSettlement('CloseDay', { countedCash: 1170 }), { omitDay: true });
    await expectRawDenied(await rawSettlement('CloseDay', { countedCash: 1170 }), { omitSettlement: true });
    // An identical twin version at another path in the same batch is refused.
    await expectRawDenied(await rawSettlement('CloseDay', { countedCash: 1170 }), { twinSettlementPath: `days/${today}/settlements/2` });
    ok(await repository().closeDay(await closeInput({ countedCash: 1170 })));
    const before = await state();
    const db = authedDb(operatorA);
    await assertFails(updateDoc(doc(db, `days/${today}/settlements/1`), { countedCash: 1000, difference: -170 }));
    await assertFails(deleteDoc(doc(db, `days/${today}/settlements/1`)));
    await assertFails(setDoc(doc(db, `days/${today}/settlements/2`), { ...before.settlements['1'], revision: 2, previousRevision: 1 }));
    expect(await state()).toEqual(before);
    // The settlement history is readable only by the current holder.
    await assertSucceeds(getDocs(collection(db, `days/${today}/settlements`)));
    await assertFails(getDocs(collection(authedDb(operatorB), `days/${today}/settlements`)));
  });
});
