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
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../../domain/cloudCommands';
import { fingerprintCommandInput, normalizeEnabledCommandInput } from '../../domain/cloudCommandSchema';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository, isBackfilled, listCloudBackfillingDays } from '../cloudDayCloseRepository';

// One-shot hook that runs a real write right after the next server query, so a head change can be made to
// land in the middle of a ledger read (P11c2a.3). Every other query passes through untouched.
const afterQuery = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }));
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDocsFromServer: (async (...args: Parameters<typeof actual.getDocsFromServer>) => {
      const result = await actual.getDocsFromServer(...args);
      const hook = afterQuery.run;
      afterQuery.run = null;
      if (hook) await hook();
      return result;
    }) as typeof actual.getDocsFromServer,
  };
});

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

/** `align: 'auto'` asks the repository's own nearest-opened-day lookup (P11c3); a date or null is sent as given. */
async function closeInput(
  change: { countedCash: number; note?: string; expectedCash?: number; align?: 'auto' | string | null },
  dayId = today,
) {
  const day = (await read(`days/${dayId}`))!;
  const t = day.totals;
  const align = change.align === 'auto' ? (await repository().findNextOpened(dayId)).next?.dayId ?? null : change.align;
  return {
    ...(align !== undefined ? { alignWithDayId: align } : {}),
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
async function rawSettlement(
  kind: 'CloseDay' | 'ReopenDay',
  change: { countedCash?: number; note?: string; reason?: string; dayId?: string; align?: unknown } = {},
  actor = operatorA,
) {
  const commandId = uuid();
  const dayId = change.dayId ?? today;
  const headBefore = (await read('system/dataHead'))!;
  const dayBefore = (await read(`days/${dayId}`))!;
  const last = dayBefore.lastSettlementRevision as number;
  const revision = last + 1;
  const previous = last === 0 ? null : (await read(`days/${dayId}/settlements/${last}`))!;
  const t = dayBefore.totals;
  const expectedCash = (dayBefore.openingCash ?? 0) + t.retainedReceipts + t.cashierIncome - t.cashierExpense - t.accountRefunds;
  const close = kind === 'CloseDay';
  const payload: RawMap = close
    ? {
      countedCash: change.countedCash ?? expectedCash, note: change.note ?? '', expectedCash,
      ...('align' in change ? { alignWithDayId: change.align } : {}),
    }
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
  const commandId = uuid();
  return {
    transactionId,
    commandId,
    result: await writer().commitCommand({
      commandId, kind: 'CreatePayment', leaseEpoch: 1,
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
    const { transactionId, commandId: paymentCommandId, result } = await createPayment(30);
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
      { kind: 'CorrectTransaction', targets: { transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day },
        payload: { mealPrice: 0, paidAmount: 40, amount: 40, note: '', reason: '金額打錯' } },
      { kind: 'CancelKeepDeposit', targets: { transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day }, payload: { reason: '取消' } },
      { kind: 'CancelRefund', targets: { transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day }, payload: { reason: '取消退現' } },
      { kind: 'Undo', targets: { transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day },
        payload: { targetCommandId: paymentCommandId, reason: '送出後立即撤回' } },
      { kind: 'SetOpeningCash', targets: { dayId: today }, expectedRevisions: { day: r.day }, payload: { openingCash: 900 } },
      { kind: 'SetDayMenu', targets: { dayId: today }, expectedRevisions: { day: r.day, headSeq: before.head!.seq },
        payload: { selectionDate: today, itemName: 'Other', price: 80, vendorId: 'p11-vendor', vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null } },
      { kind: 'CorrectOpening', targets: { studentId: studentA, dayId: today },
        expectedRevisions: { student: r.student, day: r.day }, payload: { amount: 50, note: '', reason: '期初抄錯' } },
    ];
    for (const attempt of attempts) {
      const result = await writer().commitCommand({ commandId: uuid(), leaseEpoch: 1, ...(attempt as object) });
      expect(result.ok ? 'ok' : result.error.code, JSON.stringify(attempt)).toBe('DAY_CLOSED');
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
    await assertSucceeds(getDocs(query(collection(db, `days/${today}/settlements`), limit(500))));
    await assertFails(getDocs(query(collection(authedDb(operatorB), `days/${today}/settlements`), limit(500))));
  });

  it('P11.13 (P11b): the overview lists unclosed days up to the lease date and marks past days without business', async () => {
    const zero = { ...totals(), activeTransactionCount: 0, bentoCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0 };
    const noBusiness = shiftDate(today, -3);
    const pastOpen = shiftDate(today, -2);
    const pastMissing = shiftDate(today, -1);
    const closedDay = shiftDate(today, -4);
    const future = shiftDate(today, 2);
    await withAdmin(async db => {
      await setDoc(doc(db, `days/${noBusiness}`), { ...dayDoc(noBusiness, null), totals: zero });
      await setDoc(doc(db, `days/${pastOpen}`), { ...dayDoc(pastOpen, 500), status: 'reopened' });
      await setDoc(doc(db, `days/${pastMissing}`), dayDoc(pastMissing, null));
      await setDoc(doc(db, `days/${closedDay}`), { ...dayDoc(closedDay, 500), status: 'closed' });
      await setDoc(doc(db, `days/${future}`), { ...dayDoc(future, null), totals: zero });
    });
    const overview = await repository().readOverview();
    expect(overview).toMatchObject({ selectionDate: today, goLiveDate: shiftDate(today, -30), seq: 0 });
    expect(overview.unclosedDays.map(day => [day.dayId, day.status, day.kind])).toEqual([
      [noBusiness, 'open', 'no-business'],
      [pastOpen, 'reopened', 'needs-close'],
      [pastMissing, 'open', 'missing-opening'],
      [today, 'open', 'needs-close'],
    ]);
    // A day without opening cash on the lease date itself is not "no business": it still needs opening.
    await withAdmin(async db => setDoc(doc(db, `days/${today}`), { ...dayDoc(today, null), totals: zero }));
    expect((await repository().readOverview()).unclosedDays.at(-1)).toMatchObject({ dayId: today, kind: 'missing-opening' });
    await expect(repository(operatorB).readOverview()).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  // ---- BackfillOpeningCash: a past day that never confirmed its opening cash (contract §10) ----

  const zeroTotals = () => ({ ...totals(), activeTransactionCount: 0, bentoCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0 });

  async function seedPastDay(dayId: string, change: RawMap = {}) {
    await withAdmin(async db => setDoc(doc(db, `days/${dayId}`), { ...dayDoc(dayId, null), ...change }));
  }

  async function backfillInput(openingCash: number, reason: string, dayId: string) {
    const day = (await read(`days/${dayId}`))!;
    return { commandId: uuid(), leaseEpoch: 1, dayId, expectedDayRevision: day.revision, openingCash, reason };
  }

  /** A complete raw SDK BackfillOpeningCash closure, built the same way as the repository. */
  async function rawBackfill(dayId: string, change: { openingCash?: number; reason?: string } = {}, actor = operatorA) {
    const commandId = uuid();
    const headBefore = (await read('system/dataHead'))!;
    const dayBefore = (await read(`days/${dayId}`))!;
    const payload: RawMap = { openingCash: change.openingCash ?? 800, reason: change.reason ?? '當天網路中斷，事後補開帳' };
    const input = {
      commandId, kind: 'BackfillOpeningCash', leaseEpoch: 1, targets: { dayId },
      expectedRevisions: { day: dayBefore.revision }, payload,
    };
    let fingerprint = 'f'.repeat(64);
    try { fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input)); } catch { /* invalid on purpose */ }
    const now = serverTimestamp();
    const headAfter: RawMap = { ...headBefore, seq: headBefore.seq + 1, lastCommandId: commandId, updatedAt: now };
    const dayAfter: RawMap = {
      ...dayBefore, openingCash: payload.openingCash, openedBy: actor.uid, openedAt: now,
      revision: dayBefore.revision + 1, lastCommandId: commandId, updatedAt: now,
    };
    const command: RawMap = {
      commandId, kind: 'BackfillOpeningCash', seq: headBefore.seq + 1, leaseEpoch: 1,
      actor: { uid: actor.uid, email: actor.email }, committedAt: now,
      businessDate: dayId, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
      before: {}, after: {}, reason: payload.reason,
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload, inputFingerprint: fingerprint,
    };
    const artifacts = { commandId, dayId, command, headBefore, headAfter, dayBefore, dayAfter };
    syncBackfill(artifacts);
    return artifacts;
  }

  type RawBackfill = Awaited<ReturnType<typeof rawBackfill>>;

  function syncBackfill(a: RawBackfill) {
    a.command.before = { head: a.headBefore, day: a.dayBefore };
    a.command.after = { head: a.headAfter, day: a.dayAfter };
  }

  function rawBackfillBatch(db: Firestore, a: RawBackfill, options: { omitDay?: boolean } = {}) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'system/dataHead'), a.headAfter);
    if (!options.omitDay) batch.update(doc(db, `days/${a.dayId}`), a.dayAfter);
    batch.set(doc(db, `commands/${a.commandId}`), a.command);
    return batch;
  }

  async function expectBackfillDenied(a: RawBackfill, options: { omitDay?: boolean } = {}, actor = operatorA) {
    const before = await state(a.dayId);
    await assertFails(rawBackfillBatch(authedDb(actor), a, options).commit());
    expect(await state(a.dayId)).toEqual(before);
  }

  it('P11.14 (backfill): a past day with transactions but no opening cash is backfilled with a reason, then closed', async () => {
    const yesterday = shiftDate(today, -1);
    await seedPastDay(yesterday);
    expect((await repository().readOverview()).unclosedDays[0]).toMatchObject({ dayId: yesterday, kind: 'missing-opening' });
    const before = await state(yesterday);

    const input = await backfillInput(800, '當天網路中斷，事後補開帳', yesterday);
    const receipt = ok(await repository().backfillOpening(input));
    const after = await state(yesterday);
    expect(after.day).toMatchObject({
      status: 'open', revision: 7, openingCash: 800, openedBy: operatorA.uid, lastCommandId: receipt.commandId,
      totals: totals(), lastSettlementRevision: 0,
    });
    expect(after.day!.menu).toEqual(before.day!.menu);
    expect(after.day!.openedAt).toEqual(after.day!.updatedAt);
    const stored = (await read(`commands/${receipt.commandId}`))!;
    expect(stored).toMatchObject({
      kind: 'BackfillOpeningCash', businessDate: yesterday, studentId: null, reason: '當天網路中斷，事後補開帳',
      targets: { dayId: yesterday }, expectedRevisions: { day: 6 },
      payload: { openingCash: 800, reason: '當天網路中斷，事後補開帳' },
      actor: { uid: operatorA.uid, email: operatorA.email },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
    expect(stored.before.day.openingCash).toBeNull();
    expect(await repository().readCommand(receipt.commandId)).toMatchObject({ commandId: receipt.commandId, kind: 'BackfillOpeningCash', seq: 1 });

    // Retries return the same receipt; the same ID with other content is refused.
    for (let index = 0; index < 2; index += 1) expect(ok(await repository().backfillOpening(input))).toEqual(receipt);
    expect((await repository().backfillOpening({ ...input, openingCash: 900 })).ok).toBe(false);

    // 800 + receipts 200 + income 50 − expense 80 = 970; the day now closes like any other.
    const read2 = await repository().read(yesterday);
    expect(read2).toMatchObject({ openingCash: 800, expectedCash: 970 });
    expect((await repository().readOverview()).unclosedDays[0]).toMatchObject({ dayId: yesterday, kind: 'needs-close' });
    ok(await repository().closeDay(await closeInput({ countedCash: 970 }, yesterday)));
    expect((await state(yesterday)).settlements['1']).toMatchObject({ status: 'closed', openingCash: 800, expectedCash: 970, difference: 0 });

    // A second backfill is refused once the opening cash exists (and on the closed day).
    const again = await repository().backfillOpening(await backfillInput(500, '重複', yesterday));
    expect(again).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
    expect((await state(yesterday)).commandCount).toBe(2);
  });

  it('P11.15 (backfill): a past day without business can be backfilled and closed at its opening cash', async () => {
    const pastDay = shiftDate(today, -3);
    await seedPastDay(pastDay, { totals: zeroTotals(), status: 'reopened' });
    expect((await repository().readOverview()).unclosedDays[0]).toMatchObject({ dayId: pastDay, kind: 'no-business' });
    ok(await repository().backfillOpening(await backfillInput(0, '那天沒有營業，補 0 元以便關帳', pastDay)));
    expect((await state(pastDay)).day).toMatchObject({ status: 'reopened', openingCash: 0 });
    ok(await repository().closeDay(await closeInput({ countedCash: 0 }, pastDay)));
    expect((await state(pastDay)).day).toMatchObject({ status: 'closed', lastSettlementRevision: 1 });
  });

  it('P11.16 (backfill): the writer refuses today, future, confirmed, closed, unreasoned and oversized backfills', async () => {
    const yesterday = shiftDate(today, -1);
    const future = shiftDate(today, 1);
    const confirmed = shiftDate(today, -2);
    const closedDay = shiftDate(today, -4);
    await seedPastDay(yesterday);
    await seedPastDay(future, { totals: zeroTotals() });
    await seedPastDay(confirmed, { openingCash: 600, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedPastDay(closedDay, { status: 'closed' });
    await withAdmin(async db => setDoc(doc(db, `days/${today}`), dayDoc(today, null)));
    const cases: Array<[string, Promise<CommandResult>, string]> = [
      ['today', repository().backfillOpening(await backfillInput(800, '補', today)), 'INVALID_INPUT'],
      ['future', repository().backfillOpening(await backfillInput(800, '補', future)), 'INVALID_INPUT'],
      ['confirmed', repository().backfillOpening(await backfillInput(800, '補', confirmed)), 'INVALID_INPUT'],
      ['closed', repository().backfillOpening(await backfillInput(800, '補', closedDay)), 'DAY_CLOSED'],
      ['no reason', repository().backfillOpening(await backfillInput(800, '', yesterday)), 'INVALID_INPUT'],
      ['long reason', repository().backfillOpening(await backfillInput(800, 'x'.repeat(501), yesterday)), 'INVALID_INPUT'],
      ['over 20,000', repository().backfillOpening(await backfillInput(20_001, '補', yesterday)), 'INVALID_INPUT'],
      ['negative', repository().backfillOpening(await backfillInput(-1, '補', yesterday)), 'INVALID_INPUT'],
    ];
    const before = await withAdmin(async db => (await getDocs(collection(db, 'days'))).docs.map(item => [item.id, item.data()]));
    for (const [label, pending, code] of cases) {
      expect([label, await pending]).toMatchObject([label, { ok: false, error: { code } }]);
    }
    expect(await withAdmin(async db => (await getDocs(collection(db, 'days'))).docs.map(item => [item.id, item.data()]))).toEqual(before);
    expect((await state()).commandCount).toBe(0);
    // operatorB does not hold the lease.
    expect(await repository(operatorB).backfillOpening(await backfillInput(800, '補', yesterday))).toMatchObject({ ok: false, error: { code: 'LEASE_LOST' } });
  });

  it('P11.17 (backfill): the legal maximum stays under the expression ceiling, and a raw backfill works only for the holder', async () => {
    const yesterday = shiftDate(today, -1);
    await seedPastDay(yesterday, { status: 'reopened', lastSettlementRevision: 2 });
    // operatorB signs a self-consistent closure as itself but does not hold the lease.
    await expectBackfillDenied(await rawBackfill(yesterday, { openingCash: 20_000, reason: '因'.repeat(500) }, operatorB), {}, operatorB);
    const raw = await rawBackfill(yesterday, { openingCash: 20_000, reason: '因'.repeat(500) });
    await expectBackfillDenied(raw, {}, operatorB);
    await assertSucceeds(rawBackfillBatch(authedDb(operatorA), raw).commit());
    expect((await state(yesterday)).day).toMatchObject({ status: 'reopened', openingCash: 20_000, openedBy: operatorA.uid, lastSettlementRevision: 2 });
  });

  it.each<[string, (a: RawBackfill) => void]>([
    ['the payload has no reason', a => { a.command.payload = { openingCash: 800 }; a.command.reason = null; }],
    ['the reason is empty', a => { a.command.payload = { ...a.command.payload, reason: '' }; a.command.reason = ''; }],
    ['the reason is too long', a => { const reason = 'x'.repeat(501); a.command.payload = { ...a.command.payload, reason }; a.command.reason = reason; }],
    ['the command reason differs from the payload', a => { a.command.reason = 'other'; }],
    ['the payload gains an extra key', a => { a.command.payload = { ...a.command.payload, note: '' }; }],
    ['the opening cash is over 20,000', a => { a.command.payload = { ...a.command.payload, openingCash: 20_001 }; a.dayAfter.openingCash = 20_001; syncBackfill(a); }],
    ['the opening cash is negative', a => { a.command.payload = { ...a.command.payload, openingCash: -1 }; a.dayAfter.openingCash = -1; syncBackfill(a); }],
    ['the day opening cash differs from the payload', a => { a.dayAfter.openingCash = 900; syncBackfill(a); }],
    ['the opener is another operator', a => { a.dayAfter.openedBy = operatorB.uid; syncBackfill(a); }],
    ['the opening time is not the commit time', a => { a.dayAfter.openedAt = a.dayBefore.updatedAt; syncBackfill(a); }],
    ['the day totals change', a => { a.dayAfter.totals = { ...a.dayAfter.totals, retainedReceipts: 0 }; syncBackfill(a); }],
    ['the day menu changes', a => { a.dayAfter.menu = null; syncBackfill(a); }],
    ['the day status changes', a => { a.dayAfter.status = 'closed'; syncBackfill(a); }],
    ['the day settlement pointer changes', a => { a.dayAfter.lastSettlementRevision = 1; syncBackfill(a); }],
    ['the day revision is not advanced', a => { a.dayAfter.revision = a.dayBefore.revision; syncBackfill(a); }],
    ['the cash effect is not zero', a => { a.command.cashEffect = { before: 0, after: 800, delta: 800, reasonKind: 'collection', refundAmount: 0 }; }],
    ['the business date is another day', a => { a.command.businessDate = today; }],
    ['the command names a student', a => { a.command.studentId = studentA; }],
    ['the expected day revision is stale', a => { a.command.expectedRevisions = { day: 1 }; }],
    ['the targets gain a key', a => { a.command.targets = { ...a.command.targets, settlementRevision: 1 }; }],
    ['the before-snapshot lies about the opening cash', a => { a.command.before = { ...a.command.before, day: { ...a.dayBefore, openingCash: 0 } }; }],
    ['the after-snapshot gains an extra projection', a => { a.command.after = { ...a.command.after, settlement: null }; }],
  ])('P11.18 (backfill): a raw BackfillOpeningCash is denied atomically when %s', async (_label, attack) => {
    const yesterday = shiftDate(today, -1);
    await seedPastDay(yesterday);
    const raw = await rawBackfill(yesterday);
    attack(raw);
    await expectBackfillDenied(raw);
  });

  it('P11.19 (backfill): Rules refuse a backfill on today, a future, confirmed, closed or pre-go-live day, or without the day write', async () => {
    const future = shiftDate(today, 1);
    const confirmed = shiftDate(today, -2);
    const closedDay = shiftDate(today, -4);
    const beforeGoLive = shiftDate(today, -31);
    const yesterday = shiftDate(today, -1);
    await withAdmin(async db => setDoc(doc(db, `days/${today}`), dayDoc(today, null)));
    await seedPastDay(future, { totals: zeroTotals() });
    await seedPastDay(confirmed, { openingCash: 600, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedPastDay(closedDay, { status: 'closed' });
    await seedPastDay(beforeGoLive);
    await seedPastDay(yesterday);
    await expectBackfillDenied(await rawBackfill(today));
    await expectBackfillDenied(await rawBackfill(future));
    const overwrite = await rawBackfill(confirmed);
    await expectBackfillDenied(overwrite);
    await expectBackfillDenied(await rawBackfill(closedDay));
    await expectBackfillDenied(await rawBackfill(beforeGoLive));
    await expectBackfillDenied(await rawBackfill(yesterday), { omitDay: true });
    // The day write cannot be relabelled as another kind's update either.
    const relabelled = await rawBackfill(yesterday);
    relabelled.command.kind = 'SetOpeningCash';
    await expectBackfillDenied(relabelled);
  });

  // ---- P11c1: ledger anomalies and the opening-difference reason (contract §11) ----

  const REASON = '前一天實點與開帳不同，原因待查';

  async function setOpening(input: { dayId: string; openingCash: number; reason?: string }) {
    const day = (await read(`days/${input.dayId}`))!;
    return writer().commitCommand({
      commandId: uuid(), kind: 'SetOpeningCash', leaseEpoch: 1,
      targets: { dayId: input.dayId }, expectedRevisions: { day: day.revision },
      payload: input.reason === undefined ? { openingCash: input.openingCash } : { openingCash: input.openingCash, reason: input.reason },
    });
  }

  async function closePast(dayId: string, openingCash: number, countedCash: number) {
    await seedPastDay(dayId, { openingCash, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    const note = countedCash === openingCash + 170 ? '' : '實點差額';
    ok(await repository().closeDay(await closeInput({ countedCash, note }, dayId)));
  }

  it('P11c1.1: the ledger reader lists an unclosed past day and both opening mismatches, and nothing for continuous days', async () => {
    const d1 = shiftDate(today, -6);
    const d2 = shiftDate(today, -5);
    const d3 = shiftDate(today, -2);
    await closePast(d1, 500, 700); // expected 670, counted 700
    await closePast(d2, 700, 870); // opens at the last counted cash: no anomaly
    await seedPastDay(d3, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    // today's seeded opening is 1,000.
    const snapshot = await repository().readLedger();
    expect(snapshot).toMatchObject({ today, goLiveDate: shiftDate(today, -30) });
    expect(snapshot.closedDays).toEqual([{ dayId: d1, countedCash: 700, postCloseNet: 0 }, { dayId: d2, countedCash: 870, postCloseNet: 0 }]);
    expect(snapshot.anomalies).toEqual([
      { kind: 'unclosed-past-day', dayId: d3, status: 'open', openingCash: 800, activeTransactionCount: 4 },
      {
        kind: 'opening-mismatch', dayId: d3, openingCash: 800, previousClosedDayId: d2,
        previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: -70, daysApart: 3,
        gapDays: [shiftDate(today, -4), shiftDate(today, -3)], gapDayCount: 2,
      },
      {
        kind: 'opening-mismatch', dayId: today, openingCash: 1000, previousClosedDayId: d2,
        previousCountedCash: 870, previousPostCloseNet: 0, previousEffectiveCash: 870, difference: 130, daysApart: 5,
        gapDays: [shiftDate(today, -4), shiftDate(today, -3), shiftDate(today, -1)], gapDayCount: 3,
      },
    ]);
    await expect(repository(operatorB).readLedger()).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  it('P11c1.2: continuous days, a holiday gap with the same amount, and a go-live day are not anomalies', async () => {
    const d1 = shiftDate(today, -4);
    await closePast(d1, 500, 700);
    // Today opens at 700 after a three-day gap with no business-day documents.
    ok(await setOpening({ dayId: today, openingCash: 700 }));
    expect((await repository().readLedger()).anomalies).toEqual([]);
    // A fresh dataset whose only day is the first one has no previous closed day.
    await env.clearFirestore();
    await seed();
    expect((await repository().readLedger()).anomalies).toEqual([]);
  });

  it('P11c1.3: a reopened day does not count as the last close; the latest closing version is used', async () => {
    const d1 = shiftDate(today, -3);
    const d2 = shiftDate(today, -2);
    await closePast(d1, 500, 700);
    await closePast(d2, 700, 870);
    // Reopen d2 and close again at 900: the latest version (3) is the one that matters.
    ok(await repository().reopenDay(await reopenInput('漏記一筆收入', d2)));
    expect((await repository().readLedger()).anomalies.map(item => [item.kind, item.dayId])).toEqual([
      ['unclosed-past-day', d2], ['opening-mismatch', today],
    ]);
    ok(await repository().closeDay(await closeInput({ countedCash: 900, note: '補記後' }, d2)));
    const snapshot = await repository().readLedger();
    expect(snapshot.closedDays).toEqual([{ dayId: d1, countedCash: 700, postCloseNet: 0 }, { dayId: d2, countedCash: 900, postCloseNet: 0 }]);
    expect(snapshot.anomalies).toEqual([expect.objectContaining({
      kind: 'opening-mismatch', dayId: today, previousClosedDayId: d2, previousCountedCash: 900, previousPostCloseNet: 0, previousEffectiveCash: 900, difference: 100, daysApart: 2,
    })]);
  });

  it('P11c1.4: a past day without business, and today unclosed, are not anomalies', async () => {
    await seedPastDay(shiftDate(today, -3), { totals: zeroTotals() });
    await seedPastDay(shiftDate(today, -2), { totals: zeroTotals(), status: 'reopened' });
    expect((await repository().readLedger()).anomalies).toEqual([]);
  });

  // ---- P11c2a: no 400-day ceiling (contract §11.2) ----

  async function fillQuietDays(goLive: string, from: number, to: number) {
    await withAdmin(async db => {
      await setDoc(doc(db, 'system/dataHead'), {
        schemaVersion: 1, datasetId: 'p11-close-dataset', seq: 0, lastCommandId: null,
        maintenance: false, goLiveDate: goLive, updatedAt: serverTimestamp(),
      });
      for (let start = from; start <= to; start += 400) {
        const batch = writeBatch(db);
        for (let index = start; index <= Math.min(to, start + 399); index += 1) {
          const dayId = shiftDate(today, -index);
          batch.set(doc(db, `days/${dayId}`), { ...dayDoc(dayId, null), totals: zeroTotals() });
        }
        await batch.commit();
      }
    });
  }

  it('P11c2a.1: the anomaly scan reads the recent window in pages plus the unclosed days before it, and reports anomalies found in both', async () => {
    const goLive = shiftDate(today, -500);
    await fillQuietDays(goLive, 1, 150); // plus today's document: 62 days of the window and 88 older unclosed days (under the 200 cap)
    const lateAnomaly = shiftDate(today, -30);
    const oldAnomaly = shiftDate(today, -120);
    await seedPastDay(lateAnomaly, { openingCash: 80, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedPastDay(oldAnomaly, { openingCash: 70, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    const snapshot = await repository().readLedger();
    expect(snapshot.goLiveDate).toBe(goLive);
    expect(snapshot.anomalies).toHaveLength(2);
    expect(snapshot.anomalies).toEqual(expect.arrayContaining([
      { kind: 'unclosed-past-day', dayId: lateAnomaly, status: 'open', openingCash: 80, activeTransactionCount: 4 },
      { kind: 'unclosed-past-day', dayId: oldAnomaly, status: 'open', openingCash: 70, activeTransactionCount: 4 },
    ]));
  });

  it('P11c2a.1b: more than 200 unclosed days before the window is INCOMPLETE_SNAPSHOT instead of a silent partial list', async () => {
    await fillQuietDays(shiftDate(today, -500), 1, 300); // 238 unclosed days before the 62-day window
    await expect(repository().readLedger()).rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
  });

  it('P11c2a.2: the opening form lookup and the SetOpeningCash writer find the previous closed day beyond 400 days back', async () => {
    const goLive = shiftDate(today, -500);
    await withAdmin(async db => setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p11-close-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: goLive, updatedAt: serverTimestamp(),
    }));
    const farClosed = shiftDate(today, -450);
    await closePast(farClosed, 500, 700);
    await fillQuietDays(goLive, 1, 449); // every day between the closed day and today has a quiet document
    const lookup = await repository().findPreviousClosed(today);
    expect(lookup.previous).toEqual({ dayId: farClosed, countedCash: 700, postCloseNet: 0 });
    const vendor = (await import('../cloudDayVendorRepository')).createCloudDayVendorRepository(
      authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) },
    );
    const todayDoc = async () => (await read(`days/${today}`))!;
    const before = await state();
    expect(await vendor.setOpeningCash({
      commandId: uuid(), leaseEpoch: 1, dayId: today, expectedRevision: (await todayDoc()).revision, openingCash: 650,
    })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state()).toEqual(before);
    ok(await vendor.setOpeningCash({
      commandId: uuid(), leaseEpoch: 1, dayId: today, expectedRevision: (await todayDoc()).revision, openingCash: 650, reason: REASON,
    }));
    // Nothing closed before the go-live date: no lookup is needed for the first day.
    expect((await repository().findPreviousClosed(goLive)).previous).toBeNull();
  });

  it('P11c2a.3: a head change in the middle of a read is STALE_SNAPSHOT, for the full scan and for the previous-closed lookup', async () => {
    const goLive = shiftDate(today, -100);
    await fillQuietDays(goLive, 1, 60);
    const advance = async () => {
      const day = (await read(`days/${today}`))!;
      ok(await writer().commitCommand({
        commandId: uuid(), kind: 'SetOpeningCash', leaseEpoch: 1,
        targets: { dayId: today }, expectedRevisions: { day: day.revision }, payload: { openingCash: 1000 + (day.revision % 7) },
      }));
    };
    const ledger = repository();
    afterQuery.run = advance;
    await expect(ledger.readLedger()).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    // A read that starts after the write sees a stable head again.
    expect((await ledger.readLedger()).anomalies).toEqual([]);
    afterQuery.run = advance;
    await expect(ledger.findPreviousClosed(today)).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect((await ledger.findPreviousClosed(today)).previous).toBeNull();
    // The writer maps the same condition to REVISION_CONFLICT instead of sending the command.
    const vendor = (await import('../cloudDayVendorRepository')).createCloudDayVendorRepository(
      authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) },
    );
    const staleDay = (await read(`days/${today}`))!;
    afterQuery.run = advance;
    expect(await vendor.setOpeningCash({
      commandId: uuid(), leaseEpoch: 1, dayId: today, expectedRevision: staleDay.revision, openingCash: 1,
    })).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  });

  // ---- P11c2a: backfilling a gap day (contract §12) ----

  const BF_REASON = '前天停電沒有用系統，事後補登';

  async function seedGapDay(dayId: string, change: RawMap = {}) {
    // The student's opening balance dates from go-live, so the gap day is not before it.
    await withAdmin(async db => updateDoc(doc(db, `students/${studentA}`), { 'openingBalance.asOfDate': shiftDate(today, -30) }));
    await seedPastDay(dayId, { totals: zeroTotals(), ...change });
  }

  async function startBackfill(dayId: string, reason: string = BF_REASON, commandId: string = uuid(), actor = operatorA) {
    const day = (await read(`days/${dayId}`))!;
    return writer(actor).commitCommand({
      commandId, kind: 'StartBackfill', leaseEpoch: 1,
      targets: { dayId }, expectedRevisions: { day: day.revision }, payload: { reason },
    });
  }

  async function dayRevisions(dayId: string) {
    const [student, day] = await Promise.all([read(`students/${studentA}`), read(`days/${dayId}`)]);
    return { student: student!.revision as number, day: day!.revision as number };
  }

  // P13d1: an entry on a marked past day carries its paper number as a fixed prefix of the note (the reason of a cash movement).
  const PAPER_ORDER_NOTE = '紙本A-0001：';
  const PAPER_PAYMENT_NOTE = '紙本A-0002：';
  const PAPER_CASH_REASON = '紙本A-0003：零錢補充';

  async function backfillOrder(dayId: string, commandId: string = uuid(), note: string = PAPER_ORDER_NOTE) {
    const r = await dayRevisions(dayId);
    const transactionId = uuid();
    return {
      transactionId,
      result: await writer().commitCommand({
        commandId, kind: 'CreateOrder', leaseEpoch: 1,
        targets: { transactionId, studentId: studentA, dayId },
        expectedRevisions: { transaction: 0, student: r.student, day: r.day },
        payload: { mealPrice: 90, paidAmount: 0, mealKind: 'bento', menuRevision: 1, otherItemName: null, note },
      }),
    };
  }

  async function backfillPayment(dayId: string, paidAmount = 200, note: string = PAPER_PAYMENT_NOTE) {
    const r = await dayRevisions(dayId);
    const transactionId = uuid();
    const commandId = uuid();
    return {
      transactionId, commandId,
      result: await writer().commitCommand({
        commandId, kind: 'CreatePayment', leaseEpoch: 1,
        targets: { transactionId, studentId: studentA, dayId },
        expectedRevisions: { transaction: 0, student: r.student, day: r.day },
        payload: { paidAmount, note },
      }),
    };
  }

  async function backfillCash(dayId: string, amount = 50, reason: string = PAPER_CASH_REASON) {
    const r = await dayRevisions(dayId);
    const transactionId = uuid();
    return {
      transactionId,
      result: await writer().commitCommand({
        commandId: uuid(), kind: 'CreateCashMovement', leaseEpoch: 1,
        targets: { transactionId, dayId }, expectedRevisions: { transaction: 0, day: r.day },
        payload: { mealPrice: 0, paidAmount: amount, reason },
      }),
    };
  }

  it('P11c2a.4: a gap day is backfilled end to end — opening cash, marker, order, payment, cash movement, then it closes', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap);
    ok(await repository().backfillOpening(await backfillInput(800, '當天整天沒有用系統，事後補開帳', gap)));
    const dayBeforeMarker = (await read(`days/${gap}`))!;

    const commandId = uuid();
    const receipt = ok(await startBackfill(gap, BF_REASON, commandId));
    expect(receipt).toMatchObject({ commandId });
    // The day document is untouched; only the marker, the head and the command are new.
    expect((await read(`days/${gap}`))!).toEqual(dayBeforeMarker);
    expect((await read(`backfillDays/${gap}`))!).toMatchObject({
      dayId: gap, reason: BF_REASON, startedBy: operatorA.uid, commandId,
    });
    const stored = (await read(`commands/${commandId}`))!;
    expect(stored).toMatchObject({
      kind: 'StartBackfill', businessDate: gap, studentId: null, reason: BF_REASON,
      targets: { dayId: gap }, payload: { reason: BF_REASON },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
    expect(stored.after.backfill).toEqual((await read(`backfillDays/${gap}`))!);
    expect(stored.startedAt ?? stored.after.backfill.startedAt).toEqual(stored.committedAt);
    expect(await repository().readCommand(commandId)).toMatchObject({ commandId, kind: 'StartBackfill' });

    // Retries return the same receipt and add nothing; the same ID with another reason is refused.
    const commandCount = (await state(gap)).commandCount;
    for (let index = 0; index < 2; index += 1) expect(ok(await startBackfill(gap, BF_REASON, commandId))).toEqual(receipt);
    expect((await state(gap)).commandCount).toBe(commandCount);
    expect((await startBackfill(gap, '另一個原因', commandId)).ok).toBe(false);

    const order = await backfillOrder(gap);
    const payment = await backfillPayment(gap, 200);
    const cash = await backfillCash(gap, 50);
    ok(order.result);
    ok(payment.result);
    ok(cash.result);
    for (const id of [order.transactionId, payment.transactionId, cash.transactionId]) {
      expect((await read(`transactions/${id}`))!).toMatchObject({ businessDate: gap, status: 'active' });
    }
    expect((await read(`days/${gap}`))!.totals).toMatchObject({ activeTransactionCount: 3, retainedReceipts: 200, cashierIncome: 50 });

    // 800 + receipts 200 + income 50 = 1,050; the day closes like any other.
    // Today is opened with 1,000, so the nearest opened day after the gap is today; make the books meet.
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { openingCash: 1050 }));
    ok(await repository().closeDay(await closeInput({ countedCash: 1050, align: 'auto' }, gap)));
    expect((await state(gap)).settlements['1']).toMatchObject({ status: 'closed', openingCash: 800, expectedCash: 1050, difference: 0 });
    // The marker survives the close.
    expect((await read(`backfillDays/${gap}`))!.commandId).toBe(commandId);
  });

  it('P11c2a.5: without a marker, an order, a payment and a cash movement on a past day are refused and change nothing', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    const before = await state(gap);
    for (const attempt of [backfillOrder(gap), backfillPayment(gap), backfillCash(gap)]) {
      expect(await attempt).toMatchObject({ result: { ok: false, error: { code: 'INVALID_INPUT' } } });
    }
    expect(await state(gap)).toEqual(before);
    expect(await read(`backfillDays/${gap}`)).toBeUndefined();
  });

  it('P11c2a.6: the writer refuses StartBackfill on today, a future day, before go-live, a closed or ever-closed day, a duplicate, and bad input', async () => {
    const gap = shiftDate(today, -2);
    const future = shiftDate(today, 1);
    const beforeGoLive = shiftDate(today, -31);
    const closedDay = shiftDate(today, -4);
    const reopened = shiftDate(today, -5);
    await seedGapDay(gap);
    await seedGapDay(future);
    await seedGapDay(beforeGoLive);
    await seedGapDay(closedDay, { status: 'closed', lastSettlementRevision: 1 });
    await seedGapDay(reopened, { status: 'reopened', lastSettlementRevision: 2 });
    const cases: Array<[string, Promise<CommandResult>, string]> = [
      ['today', startBackfill(today), 'INVALID_INPUT'],
      ['future', startBackfill(future), 'INVALID_INPUT'],
      ['before go-live', startBackfill(beforeGoLive), 'INVALID_INPUT'],
      ['closed', startBackfill(closedDay), 'DAY_CLOSED'],
      ['reopened after a close', startBackfill(reopened), 'DAY_CLOSED'],
      ['no reason', startBackfill(gap, ''), 'INVALID_INPUT'],
      ['long reason', startBackfill(gap, 'x'.repeat(501)), 'INVALID_INPUT'],
    ];
    for (const [label, pending, code] of cases) {
      expect([label, await pending]).toMatchObject([label, { ok: false, error: { code } }]);
    }
    expect((await state()).commandCount).toBe(0);
    expect(await withAdmin(async db => (await getDocs(collection(db, 'backfillDays'))).size)).toBe(0);

    // A stale day version is a revision conflict.
    const day = (await read(`days/${gap}`))!;
    expect(await writer().commitCommand({
      commandId: uuid(), kind: 'StartBackfill', leaseEpoch: 1,
      targets: { dayId: gap }, expectedRevisions: { day: day.revision + 1 }, payload: { reason: BF_REASON },
    })).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    // A day that does not exist.
    expect(await writer().commitCommand({
      commandId: uuid(), kind: 'StartBackfill', leaseEpoch: 1,
      targets: { dayId: shiftDate(today, -9) }, expectedRevisions: { day: 1 }, payload: { reason: BF_REASON },
    })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });

    // A second marker for the same day is refused, and a non-holder cannot start one.
    expect(await startBackfill(gap, BF_REASON, uuid(), operatorB)).toMatchObject({ ok: false, error: { code: 'LEASE_LOST' } });
    ok(await startBackfill(gap));
    expect(await startBackfill(gap)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await withAdmin(async db => (await getDocs(collection(db, 'backfillDays'))).size)).toBe(1);
  });

  it('P11c2a.7: a day that closed after the marker accepts no more backfilled transactions, even once reopened', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    ok(await startBackfill(gap));
    ok((await backfillPayment(gap, 200)).result);
    ok(await repository().closeDay(await closeInput({ countedCash: 1000, align: 'auto' }, gap)));
    ok(await repository().reopenDay(await reopenInput('補登漏掉的繳費', gap)));
    const before = await state(gap);
    expect(before.day).toMatchObject({ status: 'reopened', lastSettlementRevision: 2 });
    // The writer says why: the day was marked, closed and reopened, which is not the same as "never marked".
    for (const attempt of [backfillOrder(gap), backfillPayment(gap), backfillCash(gap)]) {
      expect(await attempt).toMatchObject({
        result: { ok: false, error: { code: 'DAY_CLOSED', message: expect.stringContaining('曾經關過帳') } },
      });
    }
    expect(await state(gap)).toEqual(before);
  });

  it('P11c2a.12: a backfill day opens no refund, undo or refund cancellation; a menu can still be set; a past day can be created', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    ok(await startBackfill(gap));
    const payment = await backfillPayment(gap, 200);
    ok(payment.result);
    const before = await state(gap);

    const r = await dayRevisions(gap);
    const refundTransactionId = uuid();
    expect(await writer().commitCommand({
      commandId: uuid(), kind: 'CreateRefund', leaseEpoch: 1,
      targets: { transactionId: refundTransactionId, studentId: studentA, dayId: gap },
      expectedRevisions: { transaction: 0, student: r.student, day: r.day },
      payload: { amount: 10, reason: '補退款' },
    })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await writer().commitCommand({
      commandId: uuid(), kind: 'Undo', leaseEpoch: 1,
      targets: { transactionId: payment.transactionId, studentId: studentA, dayId: gap },
      expectedRevisions: { transaction: 1, student: r.student, day: r.day },
      payload: { targetCommandId: payment.commandId, reason: '補作廢' },
    })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state(gap)).toEqual(before);

    // The menu of a past day can still be set directly (a bento order needs one) …
    const noMenu = shiftDate(today, -3);
    await seedGapDay(noMenu, { menu: null });
    await withAdmin(async db => setDoc(doc(db, 'vendors/p11-vendor'), {
      vendorId: 'p11-vendor', name: 'Synthetic Vendor', phone: '', note: '', status: 'active', deleted: false,
      createdAt: serverTimestamp(), revision: 1, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
    }));
    const headSeq = ((await read('system/dataHead'))!.seq) as number;
    const menuResult = await writer().commitCommand({
      commandId: uuid(), kind: 'SetDayMenu', leaseEpoch: 1,
      targets: { dayId: noMenu }, expectedRevisions: { day: (await read(`days/${noMenu}`))!.revision, headSeq },
      payload: { selectionDate: today, itemName: 'Synthetic Meal', price: 90, vendorId: 'p11-vendor', vendorNameSnapshot: 'Synthetic Vendor', inheritedFromDate: null },
    });
    expect(menuResult).toMatchObject({ ok: true });
    expect((await read(`days/${noMenu}`))!.menu).toMatchObject({ itemName: 'Synthetic Meal', price: 90 });

    // … and a past day that does not exist yet can be created with EnsureDay, no marker needed.
    const missing = shiftDate(today, -4);
    ok(await writer().commitCommand({
      commandId: uuid(), kind: 'EnsureDay', leaseEpoch: 1,
      targets: { dayId: missing }, expectedRevisions: { day: 0 }, payload: { businessDate: missing },
    }));
    expect((await read(`days/${missing}`))!).toMatchObject({ status: 'open', openingCash: null, lastSettlementRevision: 0 });
    expect(await read(`backfillDays/${missing}`)).toBeUndefined();
  });

  it('P11c2b.1: the repository creates a missing past day, confirms its opening cash and marks it, one command each; the day then lists as backfilling', async () => {
    const gap = shiftDate(today, -3);
    const doneAlready = shiftDate(today, -2);
    await withAdmin(async db => updateDoc(doc(db, `students/${studentA}`), { 'openingBalance.asOfDate': shiftDate(today, -30) }));
    await seedGapDay(doneAlready, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    expect(await repository().read(gap)).toBeNull();
    const options = { currentUser: () => fakeCurrentUser(operatorA) };
    expect(await listCloudBackfillingDays(authedDb(operatorA), options)).toEqual([]);

    const ensureId = uuid();
    ok(await repository().ensureDay({ commandId: ensureId, leaseEpoch: 1, dayId: gap }));
    const created = await repository().read(gap);
    expect(created).toMatchObject({ status: 'open', openingCash: null, lastSettlementRevision: 0 });
    // A repeat of the same command is a replay of the stored receipt, not a second day.
    ok(await repository().ensureDay({ commandId: ensureId, leaseEpoch: 1, dayId: gap }));

    ok(await repository().backfillOpening({
      commandId: uuid(), leaseEpoch: 1, dayId: gap, expectedDayRevision: created!.revision, openingCash: 800, reason: BF_REASON,
    }));
    const opened = await repository().read(gap);
    expect(opened).toMatchObject({ openingCash: 800 });
    expect(await repository().readBackfillDay(gap)).toBeNull();

    ok(await repository().startBackfill({ commandId: uuid(), leaseEpoch: 1, dayId: gap, expectedDayRevision: opened!.revision, reason: BF_REASON }));
    expect(await repository().readBackfillDay(gap)).toMatchObject({ dayId: gap, reason: BF_REASON, startedBy: operatorA.uid });
    expect(await repository().startBackfill({
      commandId: uuid(), leaseEpoch: 1, dayId: gap, expectedDayRevision: opened!.revision, reason: BF_REASON,
    })).toMatchObject({ ok: false });

    ok(await repository().startBackfill({
      commandId: uuid(), leaseEpoch: 1, dayId: doneAlready, expectedDayRevision: (await read(`days/${doneAlready}`))!.revision, reason: BF_REASON,
    }));
    expect((await listCloudBackfillingDays(authedDb(operatorA), options)).map(day => day.dayId)).toEqual([gap, doneAlready]);

    // Closing a marked day removes it from the list of days that still take transactions after a reopen.
    ok(await repository().closeDay(await closeInput({ countedCash: 800, align: 'auto' }, gap)));
    ok(await repository().reopenDay(await reopenInput('補登漏掉的繳費', gap)));
    expect((await listCloudBackfillingDays(authedDb(operatorA), options)).map(day => day.dayId)).toEqual([doneAlready]);
  });

  it('P11c2a.13: the reader shows which unclosed days are being backfilled, and marks only the later-created transactions', async () => {
    const gap = shiftDate(today, -2);
    const plainPast = shiftDate(today, -3);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedGapDay(plainPast, { openingCash: 700, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    expect(await repository().readBackfillDay(gap)).toBeNull();
    expect((await repository().readOverview()).unclosedDays.map(day => [day.dayId, day.backfill])).toEqual([
      [plainPast, null], [gap, null], [today, null],
    ]);

    ok(await startBackfill(gap));
    const order = await backfillOrder(gap);
    ok(order.result);
    const marker = await repository().readBackfillDay(gap);
    expect(marker).toMatchObject({ dayId: gap, reason: BF_REASON, startedBy: operatorA.uid });
    expect(marker!.startedAt).toBeInstanceOf(Date);
    const overview = await repository().readOverview();
    expect(overview.unclosedDays.map(day => [day.dayId, day.backfill?.reason ?? null])).toEqual([
      [plainPast, null], [gap, BF_REASON], [today, null],
    ]);

    const raw = (await read(`transactions/${order.transactionId}`))!;
    expect(isBackfilled({ businessDate: raw.businessDate, createdAt: raw.createdAt.toDate() }, marker)).toBe(true);
    // An ordinary transaction of today, or one of a day without a marker, is never backfilled.
    expect(isBackfilled({ businessDate: today, createdAt: raw.createdAt.toDate() }, null)).toBe(false);
    expect(isBackfilled({ businessDate: raw.businessDate, createdAt: raw.createdAt.toDate() }, null)).toBe(false);
    await expect(repository().readBackfillDay('not-a-date')).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });

  // One positive case per transaction kind, so the Rules headroom probe can measure each path alone.
  it.each<[string, (dayId: string) => Promise<{ result: CommandResult }>]>([
    ['order', dayId => backfillOrder(dayId)],
    ['payment', dayId => backfillPayment(dayId, 200)],
    ['cash movement', dayId => backfillCash(dayId, 50)],
  ])('P11c2a.14: a backfilled %s on a marked past day passes the production Rules in one commit', async (_label, create) => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await withAdmin(async db => setDoc(doc(db, `backfillDays/${gap}`), {
      dayId: gap, reason: BF_REASON, startedBy: operatorA.uid, startedAt: serverTimestamp(), commandId: uuid(),
    }));
    ok((await create(gap)).result);
    expect((await read(`days/${gap}`))!.totals.activeTransactionCount).toBe(1);
  });

  // ---- P13d1: the paper number of every backfilled entry (fixed note prefix, spec §7) ----

  async function markedGap() {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await withAdmin(async db => setDoc(doc(db, `backfillDays/${gap}`), {
      dayId: gap, reason: BF_REASON, startedBy: operatorA.uid, startedAt: serverTimestamp(), commandId: uuid(),
    }));
    return gap;
  }

  const MISSING_REFS = ['', '前天停電補登', '備註 紙本A-0001：', '紙本：沒有編號'];
  const MALFORMED_REFS = [
    '紙本A 1：空白', '紙本A_1：底線', '紙本A1:半形冒號', ' 紙本A1：前面有空白', '紙本' + 'a'.repeat(21) + '：太長', '紙本甲乙：中文編號', '紙本A1',
  ];

  it.each<[string, (dayId: string, text: string) => Promise<{ result: CommandResult }>]>([
    ['order', (dayId, text) => backfillOrder(dayId, uuid(), text)],
    ['payment', (dayId, text) => backfillPayment(dayId, 200, text)],
    ['cash movement', (dayId, text) => backfillCash(dayId, 50, text)],
  ])('P13d1.1: a backfilled %s without a well-formed paper number is refused and changes nothing', async (_label, create) => {
    const gap = await markedGap();
    const before = await state(gap);
    for (const text of [...MISSING_REFS, ...MALFORMED_REFS]) {
      const attempt = await create(gap, text);
      expect(attempt.result, JSON.stringify(text)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(await state(gap)).toEqual(before);
  });

  it('P13d1.2: a well-formed number is stored in the row note (the reason of a cash movement), 20 characters and a multi-line remark included', async () => {
    const gap = await markedGap();
    const longRef = '紙本' + 'Z'.repeat(20) + '：';
    const order = await backfillOrder(gap, uuid(), '紙本A-0123：前天斷線補登');
    const payment = await backfillPayment(gap, 200, longRef);
    const cash = await backfillCash(gap, 50, '紙本B-9：第一行\n第二行');
    for (const created of [order, payment, cash]) ok(created.result);
    expect((await read(`transactions/${order.transactionId}`))!.note).toBe('紙本A-0123：前天斷線補登');
    expect((await read(`transactions/${payment.transactionId}`))!.note).toBe(longRef);
    expect((await read(`transactions/${cash.transactionId}`))!.note).toBe('紙本B-9：第一行\n第二行');
  });

  it('P13d1.3: today needs no paper number, and accepts one', async () => {
    const create = async (kind: 'CreatePayment' | 'CreateCashMovement', payload: RawMap) => {
      const transactionId = uuid();
      const r = await revisions();
      return {
        transactionId,
        result: await writer().commitCommand({
          commandId: uuid(), kind, leaseEpoch: 1,
          targets: kind === 'CreatePayment' ? { transactionId, studentId: studentA, dayId: today } : { transactionId, dayId: today },
          expectedRevisions: kind === 'CreatePayment' ? { transaction: 0, student: r.student, day: r.day } : { transaction: 0, day: r.day },
          payload,
        } as never),
      };
    };
    const plain = await create('CreatePayment', { paidAmount: 100, note: '' });
    const prefixed = await create('CreatePayment', { paidAmount: 100, note: '紙本A-0007：斷線期間' });
    const cashPlain = await create('CreateCashMovement', { mealPrice: 0, paidAmount: 50, reason: '零錢補充' });
    const cashPrefixed = await create('CreateCashMovement', { mealPrice: 0, paidAmount: 50, reason: '紙本A-0008：零錢補充' });
    for (const created of [plain, prefixed, cashPlain, cashPrefixed]) ok(created.result);
    expect((await read(`transactions/${plain.transactionId}`))!.note).toBe('');
    expect((await read(`transactions/${prefixed.transactionId}`))!.note).toBe('紙本A-0007：斷線期間');
    expect((await read(`transactions/${cashPlain.transactionId}`))!.note).toBe('零錢補充');
    expect((await read(`transactions/${cashPrefixed.transactionId}`))!.note).toBe('紙本A-0008：零錢補充');
  });

  it('P13d1.4: a correction keeps the paper number — the text after it changes, the number itself cannot be dropped or replaced', async () => {
    const gap = await markedGap();
    const payment = await backfillPayment(gap, 200, '紙本A-0002：原本備註');
    const cash = await backfillCash(gap, 50, '紙本A-0003：零錢補充');
    ok(payment.result);
    ok(cash.result);
    const correct = async (transactionId: string, studentId: string, payload: RawMap) => {
      const tx = (await read(`transactions/${transactionId}`))!;
      const r = await dayRevisions(gap);
      return writer().commitCommand({
        commandId: uuid(), kind: 'CorrectTransaction', leaseEpoch: 1,
        targets: { transactionId, studentId, dayId: gap },
        expectedRevisions: studentId === '__cashier__' ? { transaction: tx.revision, day: r.day } : { transaction: tx.revision, student: r.student, day: r.day },
        payload: { reason: '補登更正', ...payload },
      } as never);
    };
    const paymentPayload = (note: string) => ({ mealPrice: 0, paidAmount: 150, amount: 150, note });
    const cashPayload = (note: string) => ({ mealPrice: 0, paidAmount: 60, amount: 60, note });
    const before = await state(gap);
    for (const note of ['原本備註', '', '紙本A-0009：原本備註', '紙本A-0002', '紙本A 2：原本備註']) {
      expect(await correct(payment.transactionId, studentA, paymentPayload(note)), JSON.stringify(note)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    for (const note of ['零錢補充', '紙本A-0010：零錢補充']) {
      expect(await correct(cash.transactionId, '__cashier__', cashPayload(note)), JSON.stringify(note)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(await state(gap)).toEqual(before);

    ok(await correct(payment.transactionId, studentA, paymentPayload('紙本A-0002：金額更正為 150')));
    ok(await correct(cash.transactionId, '__cashier__', cashPayload('紙本A-0003：零錢補充，金額更正')));
    expect((await read(`transactions/${payment.transactionId}`))!).toMatchObject({ note: '紙本A-0002：金額更正為 150', paidAmount: 150, revision: 2 });
    expect((await read(`transactions/${cash.transactionId}`))!).toMatchObject({ note: '紙本A-0003：零錢補充，金額更正', revision: 2 });

    // A void only flips the status; the paper number stays on the row.
    const tx = (await read(`transactions/${payment.transactionId}`))!;
    const r = await dayRevisions(gap);
    ok(await writer().commitCommand({
      commandId: uuid(), kind: 'VoidTransaction', leaseEpoch: 1,
      targets: { transactionId: payment.transactionId, studentId: studentA, dayId: gap },
      expectedRevisions: { transaction: tx.revision, student: r.student, day: r.day }, payload: { reason: '紙本作廢' },
    }));
    expect((await read(`transactions/${payment.transactionId}`))!).toMatchObject({ status: 'voided', note: '紙本A-0002：金額更正為 150' });
  });

  it('P13d1.5: a row without a paper number is corrected as freely as before; once a number is on the row it stays', async () => {
    const created = await createPayment(100);
    ok(created.result);
    const correct = async (note: string) => {
      const current = (await read(`transactions/${created.transactionId}`))!;
      const r = await revisions();
      return writer().commitCommand({
        commandId: uuid(), kind: 'CorrectTransaction', leaseEpoch: 1,
        targets: { transactionId: created.transactionId, studentId: studentA, dayId: today },
        expectedRevisions: { transaction: current.revision, student: r.student, day: r.day },
        payload: { mealPrice: 0, paidAmount: 100, amount: 100, note, reason: '備註更正' },
      });
    };
    ok(await correct('改過的備註'));
    ok(await correct('紙本A-0011：事後補上號碼'));
    expect(await correct('')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    ok(await correct('紙本A-0011：只改後面的字'));
    expect((await read(`transactions/${created.transactionId}`))!).toMatchObject({ note: '紙本A-0011：只改後面的字', revision: 4 });
  });

  type RawStart = Awaited<ReturnType<typeof rawStartBackfill>>;

  /** A complete raw SDK StartBackfill closure, built the same way as the repository. */
  async function rawStartBackfill(dayId: string, change: { reason?: string } = {}, actor = operatorA) {
    const commandId = uuid();
    const headBefore = (await read('system/dataHead'))!;
    const dayBefore = (await read(`days/${dayId}`))!;
    const payload: RawMap = { reason: change.reason ?? BF_REASON };
    const input = {
      commandId, kind: 'StartBackfill', leaseEpoch: 1, targets: { dayId },
      expectedRevisions: { day: dayBefore.revision }, payload,
    };
    let fingerprint = 'f'.repeat(64);
    try { fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input)); } catch { /* invalid on purpose */ }
    const now = serverTimestamp();
    const headAfter: RawMap = { ...headBefore, seq: headBefore.seq + 1, lastCommandId: commandId, updatedAt: now };
    const marker: RawMap = { dayId, reason: payload.reason, startedBy: actor.uid, startedAt: now, commandId };
    const command: RawMap = {
      commandId, kind: 'StartBackfill', seq: headBefore.seq + 1, leaseEpoch: 1,
      actor: { uid: actor.uid, email: actor.email }, committedAt: now,
      businessDate: dayId, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
      before: {}, after: {}, reason: payload.reason,
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload, inputFingerprint: fingerprint,
    };
    const artifacts = { commandId, dayId, command, headBefore, headAfter, dayBefore, marker };
    syncStart(artifacts);
    return artifacts;
  }

  function syncStart(a: RawStart) {
    a.command.before = { head: a.headBefore, day: a.dayBefore, backfill: null };
    a.command.after = { head: a.headAfter, day: a.dayBefore, backfill: a.marker };
  }

  function rawStartBatch(db: Firestore, a: RawStart, options: { omitMarker?: boolean; omitHead?: boolean } = {}) {
    const batch = writeBatch(db);
    if (!options.omitHead) batch.update(doc(db, 'system/dataHead'), a.headAfter);
    if (!options.omitMarker) batch.set(doc(db, `backfillDays/${a.dayId}`), a.marker);
    batch.set(doc(db, `commands/${a.commandId}`), a.command);
    return batch;
  }

  async function expectStartDenied(a: RawStart, options: { omitMarker?: boolean; omitHead?: boolean } = {}, actor = operatorA) {
    const before = await state(a.dayId);
    const markers = await withAdmin(async db => (await getDocs(collection(db, 'backfillDays'))).size);
    await assertFails(rawStartBatch(authedDb(actor), a, options).commit());
    expect(await state(a.dayId)).toEqual(before);
    expect(await withAdmin(async db => (await getDocs(collection(db, 'backfillDays'))).size)).toBe(markers);
  }

  it('P11c2a.8: the legal maximum StartBackfill works through a raw batch only for the holder', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap);
    const raw = await rawStartBackfill(gap, { reason: '因'.repeat(500) });
    await expectStartDenied(await rawStartBackfill(gap, { reason: '因'.repeat(500) }, operatorB), {}, operatorB);
    await assertSucceeds(rawStartBatch(authedDb(operatorA), raw).commit());
    expect((await read(`backfillDays/${gap}`))!).toMatchObject({ dayId: gap, startedBy: operatorA.uid });
  });

  it.each<[string, (a: RawStart) => void, { omitMarker?: boolean; omitHead?: boolean }?]>([
    ['the payload has no reason', a => { a.command.payload = {}; a.command.reason = null; }],
    ['the reason is empty', a => { a.command.payload = { reason: '' }; a.command.reason = ''; a.marker.reason = ''; syncStart(a); }],
    ['the reason is too long', a => { const reason = 'x'.repeat(501); a.command.payload = { reason }; a.command.reason = reason; a.marker.reason = reason; syncStart(a); }],
    ['the command reason differs from the payload', a => { a.command.reason = 'other'; }],
    ['the marker reason differs from the payload', a => { a.marker.reason = 'tampered'; syncStart(a); }],
    ['the payload gains an extra key', a => { a.command.payload = { ...a.command.payload, note: '' }; }],
    ['the marker names another starter', a => { a.marker.startedBy = operatorB.uid; syncStart(a); }],
    ['the marker start time is not the commit time', a => { a.marker.startedAt = a.dayBefore.updatedAt; syncStart(a); }],
    ['the marker command ID is another command', a => { a.marker.commandId = uuid(); syncStart(a); }],
    ['the marker names another day', a => { a.marker.dayId = shiftDate(today, -3); syncStart(a); }],
    ['the marker gains an extra field', a => { a.marker.extra = true; syncStart(a); }],
    ['the day changes inside the command', a => { a.command.after = { ...a.command.after, day: { ...a.dayBefore, openingCash: 5 } }; }],
    ['the cash effect is not zero', a => { a.command.cashEffect = { before: 0, after: 800, delta: 800, reasonKind: 'collection', refundAmount: 0 }; }],
    ['the business date is another day', a => { a.command.businessDate = today; }],
    ['the command names a student', a => { a.command.studentId = studentA; }],
    ['the expected day revision is stale', a => { a.command.expectedRevisions = { day: 1 }; }],
    ['the targets gain a key', a => { a.command.targets = { ...a.command.targets, settlementRevision: 1 }; }],
    ['the before-snapshot claims an existing marker', a => { a.command.before = { ...a.command.before, backfill: a.marker }; }],
    ['the command is relabelled as BackfillOpeningCash', a => { a.command.kind = 'BackfillOpeningCash'; }],
    ['the command is relabelled as SetOpeningCash', a => { a.command.kind = 'SetOpeningCash'; }],
    ['the marker is written without the command', () => undefined, { omitMarker: false }],
  ])('P11c2a.9: a raw StartBackfill is denied atomically when %s', async (label, attack, options) => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap);
    const raw = await rawStartBackfill(gap);
    attack(raw);
    if (label === 'the marker is written without the command') {
      // A marker created outside a StartBackfill command (no command document in the batch).
      const holder = authedDb(operatorA);
      await assertFails(setDoc(doc(holder, `backfillDays/${gap}`), raw.marker));
      expect(await read(`backfillDays/${gap}`)).toBeUndefined();
      return;
    }
    await expectStartDenied(raw, options);
  });

  it('P11c2a.10: Rules refuse StartBackfill on today, a future, a closed, an ever-closed or a pre-go-live day, and on a duplicate', async () => {
    const gap = shiftDate(today, -2);
    const future = shiftDate(today, 1);
    const beforeGoLive = shiftDate(today, -31);
    const closedDay = shiftDate(today, -4);
    const reopened = shiftDate(today, -5);
    await seedGapDay(gap);
    await seedGapDay(future);
    await seedGapDay(beforeGoLive);
    await seedGapDay(closedDay, { status: 'closed', lastSettlementRevision: 1 });
    await seedGapDay(reopened, { status: 'reopened', lastSettlementRevision: 2 });
    await expectStartDenied(await rawStartBackfill(today));
    await expectStartDenied(await rawStartBackfill(future));
    await expectStartDenied(await rawStartBackfill(beforeGoLive));
    await expectStartDenied(await rawStartBackfill(closedDay));
    await expectStartDenied(await rawStartBackfill(reopened));
    await expectStartDenied(await rawStartBackfill(gap), { omitHead: true });
    // The marker exists once; a second raw one for the same day is refused.
    ok(await startBackfill(gap));
    await expectStartDenied(await rawStartBackfill(gap));
  });

  it('P11c2a.11: a marker can be neither edited nor deleted nor created by hand, by the holder or anyone else', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap);
    ok(await startBackfill(gap));
    const marker = (await read(`backfillDays/${gap}`))!;
    const holder = authedDb(operatorA);
    await assertFails(updateDoc(doc(holder, `backfillDays/${gap}`), { reason: '改掉原因' }));
    await assertFails(updateDoc(doc(holder, `backfillDays/${gap}`), { startedBy: operatorB.uid }));
    await assertFails(deleteDoc(doc(holder, `backfillDays/${gap}`)));
    await assertFails(setDoc(doc(holder, `backfillDays/${gap}`), { ...marker, reason: '覆蓋' }));
    await assertFails(setDoc(doc(holder, `backfillDays/${shiftDate(today, -3)}`), { ...marker, dayId: shiftDate(today, -3) }));
    await assertFails(deleteDoc(doc(authedDb(operatorB), `backfillDays/${gap}`)));
    expect(await read(`backfillDays/${gap}`)).toEqual(marker);
    // Only the lease holder can read markers.
    await assertSucceeds(getDoc(doc(holder, `backfillDays/${gap}`)));
    await assertFails(getDoc(doc(authedDb(operatorB), `backfillDays/${gap}`)));
    await assertSucceeds(getDocs(query(collection(holder, 'backfillDays'), limit(500))));
    await assertFails(getDocs(query(collection(authedDb(operatorB), 'backfillDays'), limit(500))));
  });

  // ---- P11c3: a back-filled day closes aligned with the next opened day (contract §14) ----

  /** A marked gap day with opening 800 and receipts 200 (expected 1,000), then a day opened with `nextOpening`. */
  async function seedAlignedScene(options: { nextOpening?: number | null } = {}) {
    const gap = shiftDate(today, -3);
    const next = shiftDate(today, -1);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    const nextOpening = options.nextOpening === undefined ? 1000 : options.nextOpening;
    await seedPastDay(next, {
      totals: zeroTotals(), openingCash: nextOpening,
      openedBy: nextOpening === null ? null : operatorA.uid, openedAt: nextOpening === null ? null : serverTimestamp(),
    });
    ok(await startBackfill(gap));
    ok((await backfillPayment(gap, 200)).result);
    return { gap, next };
  }

  it('P11c3.1: the nearest opened day after the gap is found, and a close that meets its opening cash goes through; a retry returns the same receipt', async () => {
    const { gap, next } = await seedAlignedScene();
    expect((await repository().findNextOpened(gap)).next).toEqual({ dayId: next, openingCash: 1000 });
    const input = await closeInput({ countedCash: 1000, align: next }, gap);
    const receipt = ok(await repository().closeDay(input));
    const stored = (await read(`commands/${receipt.commandId}`))!;
    expect(stored).toMatchObject({
      kind: 'CloseDay', businessDate: gap, reason: null,
      payload: { countedCash: 1000, note: '', expectedCash: 1000, alignWithDayId: next },
    });
    expect((await state(gap)).settlements['1']).toMatchObject({ status: 'closed', openingCash: 800, expectedCash: 1000, countedCash: 1000, difference: 0 });
    // The day keeps its marker and the aligned day is untouched.
    expect((await read(`backfillDays/${gap}`))!.dayId).toBe(gap);
    expect((await read(`days/${next}`))!.openingCash).toBe(1000);
    const commandCount = (await state(gap)).commandCount;
    for (let index = 0; index < 2; index += 1) expect(ok(await repository().closeDay(input))).toEqual(receipt);
    expect((await state(gap)).commandCount).toBe(commandCount);
    expect(await repository().readCommand(receipt.commandId)).toMatchObject({ kind: 'CloseDay' });
  });

  it('P11c3.2: with no opened day after the gap, a null alignment closes it at the expected cash', async () => {
    const gap = shiftDate(today, -3);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    ok(await startBackfill(gap));
    ok((await backfillPayment(gap, 200)).result);
    // Today is the only later day, and it has no confirmed opening cash yet.
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { openingCash: null, openedBy: null, openedAt: null }));
    expect((await repository().findNextOpened(gap)).next).toBeNull();
    const receipt = ok(await repository().closeDay(await closeInput({ countedCash: 1000, align: null }, gap)));
    expect((await read(`commands/${receipt.commandId}`))!.payload).toEqual({ countedCash: 1000, note: '', expectedCash: 1000, alignWithDayId: null });
    expect((await state(gap)).settlements['1']).toMatchObject({ status: 'closed', difference: 0 });
  });

  it('P11c3.3: the writer refuses a farther opened day, a null when a later day is opened, and an alignment that no longer matches', async () => {
    const { gap, next } = await seedAlignedScene();
    const before = await state(gap);
    // `today` also has 1,000 as its opening cash, so Rules alone would accept it; the writer does not.
    const farther = await repository().closeDay(await closeInput({ countedCash: 1000, align: today }, gap));
    expect(farther).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT', message: expect.stringContaining(next) } });
    const none = await repository().closeDay(await closeInput({ countedCash: 1000, align: null }, gap));
    expect(none).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT', message: expect.stringContaining(next) } });
    expect(await state(gap)).toEqual(before);
    // The automatic lookup finds the nearest day by itself.
    ok(await repository().closeDay(await closeInput({ countedCash: 1000, align: 'auto' }, gap)));
  });

  it('P11c3.4: the writer refuses a marked day without an alignment, an ordinary day with one, and any difference on a marked day', async () => {
    const { gap, next } = await seedAlignedScene();
    const before = await state(gap);
    expect(await repository().closeDay(await closeInput({ countedCash: 1000 }, gap))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await repository().closeDay(await closeInput({ countedCash: 990, note: '少十元', align: next }, gap))).toMatchObject({ ok: false });
    expect(await repository().closeDay(await closeInput({ countedCash: 1000, align: next, expectedCash: 990 }, gap))).toMatchObject({ ok: false });
    expect(await state(gap)).toEqual(before);
    const ordinary = await state(today);
    expect(await repository().closeDay(await closeInput({ countedCash: 1170, align: null }, today)))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringContaining('沒有回填標記') } });
    expect(await state(today)).toEqual(ordinary);
  });

  it('P11c3.5: the books must meet — a gap that is short of the next opening cash cannot close until a cash movement fills it', async () => {
    const { gap, next } = await seedAlignedScene({ nextOpening: 1050 });
    expect(await repository().closeDay(await closeInput({ countedCash: 1000, align: next }, gap)))
      .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringContaining('開帳現金') } });
    expect(await repository().closeDay(await closeInput({ countedCash: 1050, align: next }, gap))).toMatchObject({ ok: false });
    ok((await backfillCash(gap, 50)).result);
    ok(await repository().closeDay(await closeInput({ countedCash: 1050, align: next }, gap)));
    expect((await state(gap)).settlements['1']).toMatchObject({ openingCash: 800, expectedCash: 1050, countedCash: 1050, difference: 0 });
  });

  it('P11c3.6: an ordinary day closes exactly as before — a difference with a note passes, an alignment key is refused', async () => {
    ok(await repository().closeDay(await closeInput({ countedCash: 1160, note: '少十元' })));
    expect((await state()).settlements['1']).toMatchObject({ countedCash: 1160, difference: -10, note: '少十元' });
    expect((await read(`commands/${(await state()).day!.lastCommandId}`))!.payload).toEqual({ countedCash: 1160, note: '少十元', expectedCash: 1170 });
  });

  describe('P11c3.7: Rules on a raw CloseDay of a marked day', () => {
    it('accepts the aligned close and the null close, only for the holder', async () => {
      const { gap, next } = await seedAlignedScene();
      const ok1 = await rawSettlement('CloseDay', { dayId: gap, align: next });
      await expectRawDenied(ok1, {}, operatorB);
      await assertSucceeds(rawBatch(authedDb(operatorA), ok1).commit());
      expect((await state(gap)).settlements['1']).toMatchObject({ status: 'closed', countedCash: 1000 });
      // The same raw closure with a null alignment on another marked day.
      const other = shiftDate(today, -5);
      await seedGapDay(other, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
      ok(await startBackfill(other));
      ok((await backfillPayment(other, 200)).result);
      const nullAlign = await rawSettlement('CloseDay', { dayId: other, align: null });
      await assertSucceeds(rawBatch(authedDb(operatorA), nullAlign).commit());
      expect((await read(`commands/${nullAlign.commandId}`))!.payload.alignWithDayId).toBeNull();
    });

    it.each<[string, (scene: { gap: string; next: string }) => Promise<{ change: Parameters<typeof rawSettlement>[1]; attack?: (a: RawClose) => void }>]>([
      // The next day opens with 990, so the count meets it and only "difference is zero" can refuse the close.
      ['the difference is not zero, even with a note and a matching alignment', async ({ gap, next }) => ({
        change: { dayId: gap, align: next, countedCash: 990, note: '少十元' },
      })],
      ['the difference is not zero, even with a note and a null alignment', async ({ gap }) => ({
        change: { dayId: gap, align: null, countedCash: 990, note: '少十元' },
      })],
      ['the aligned amount does not match the next opening cash', async ({ gap, next }) => ({
        change: { dayId: gap, align: next, countedCash: 1000 },
        attack: () => { /* the next day is edited below */ },
      })],
      ['the alignment day is the day itself', async ({ gap }) => ({ change: { dayId: gap, align: gap } })],
      // The earlier day has the same opening cash as the count, so only the "later than the day" check can refuse it.
      ['the alignment day is before the day', async ({ gap }) => ({ change: { dayId: gap, align: shiftDate(gap, -1) } })],
      ['the alignment day does not exist', async ({ gap }) => ({ change: { dayId: gap, align: shiftDate(today, -2) } })],
      ['the alignment day has no confirmed opening cash', async ({ gap }) => ({ change: { dayId: gap, align: today } })],
      ['the alignment is a number', async ({ gap }) => ({ change: { dayId: gap, align: 20261018 } })],
      ['the alignment is a path into another collection', async ({ gap, next }) => ({ change: { dayId: gap, align: `${next}/settlements/1` } })],
      ['the alignment is undefined-by-omission on a marked day', async ({ gap }) => ({ change: { dayId: gap } })],
    ])('denies atomically when %s', async (label, build) => {
      const scene = await seedAlignedScene();
      if (label.startsWith('the difference is not zero, even with a note and a matching')) {
        await withAdmin(async db => updateDoc(doc(db, `days/${scene.next}`), { openingCash: 990 }));
      }
      if (label.startsWith('the aligned amount')) {
        await withAdmin(async db => updateDoc(doc(db, `days/${scene.next}`), { openingCash: 950 }));
      }
      if (label.startsWith('the alignment day is before')) {
        await seedPastDay(shiftDate(scene.gap, -1), {
          totals: zeroTotals(), openingCash: 1000, openedBy: operatorA.uid, openedAt: serverTimestamp(),
        });
      }
      if (label.startsWith('the alignment is a path')) {
        // A settlement document of the next day carries the same openingCash: only the date-shape check refuses the path.
        await withAdmin(async db => setDoc(doc(db, `days/${scene.next}/settlements/1`), { openingCash: 1000 }));
      }
      if (label.startsWith('the alignment day has no confirmed')) {
        await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { openingCash: null, openedBy: null, openedAt: null }));
      }
      const { change, attack } = await build(scene);
      const raw = await rawSettlement('CloseDay', change);
      attack?.(raw);
      await expectRawDenied(raw);
    });

    it('denies aligning with the day itself when its own opening cash equals the count', async () => {
      // No receipts: expected cash = opening cash = 800, so the self-alignment passes every check but "later than the day".
      const gap = shiftDate(today, -3);
      await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
      ok(await startBackfill(gap));
      await expectRawDenied(await rawSettlement('CloseDay', { dayId: gap, align: gap }));
      await assertSucceeds(rawBatch(authedDb(operatorA), await rawSettlement('CloseDay', { dayId: gap, align: null })).commit());
    });

    it('denies an alignment key on an ordinary day, and a forged before-snapshot on a marked day', async () => {
      const ordinary = await rawSettlement('CloseDay', { countedCash: 1170, align: null });
      await expectRawDenied(ordinary);
      const { gap, next } = await seedAlignedScene();
      const forged = await rawSettlement('CloseDay', { dayId: gap, align: next });
      forged.command.before = { ...forged.command.before, day: { ...forged.dayBefore, openingCash: 900 } };
      await expectRawDenied(forged);
      const extra = await rawSettlement('CloseDay', { dayId: gap, align: next });
      extra.command.payload = { ...extra.command.payload, extra: 1 };
      await expectRawDenied(extra);
    });
  });

  it('P11c3.8: the legal maximum aligned close (500-character note, opening of 20,000) passes Rules for the holder', async () => {
    const gap = shiftDate(today, -3);
    const next = shiftDate(today, -1);
    await seedGapDay(gap, { openingCash: 20_000, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedPastDay(next, { totals: zeroTotals(), openingCash: 20_000, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    ok(await startBackfill(gap));
    const raw = await rawSettlement('CloseDay', { dayId: gap, align: next, note: '備'.repeat(500) });
    await expectRawDenied(raw, {}, operatorB);
    await assertSucceeds(rawBatch(authedDb(operatorA), raw).commit());
    expect((await state(gap)).settlements['1']).toMatchObject({ countedCash: 20_000, note: '備'.repeat(500), difference: 0 });
  });

  it('P11c3.10: re-closing a reopened marked day still passes — the CloseDay rules stay within the document-access limits at their busiest', async () => {
    // Accesses on the command rule: lease, operator, head ×2, day ×2, previous settlement, settlement n, alignment day = 9; the day rule adds the marker lookup.
    const { gap, next } = await seedAlignedScene();
    ok(await repository().closeDay(await closeInput({ countedCash: 1000, align: next }, gap)));
    ok(await repository().reopenDay(await reopenInput('漏登一筆收支', gap)));
    ok(await repository().closeDay(await closeInput({ countedCash: 1000, align: 'auto' }, gap)));
    expect((await state(gap)).settlements['3']).toMatchObject({ status: 'closed', countedCash: 1000, difference: 0 });
    // A raw closure through the same path (version 4 after another reopen) is accepted only for the holder.
    ok(await repository().reopenDay(await reopenInput('再漏登一筆', gap)));
    const raw = await rawSettlement('CloseDay', { dayId: gap, align: next });
    await expectRawDenied(raw, {}, operatorB);
    await assertSucceeds(rawBatch(authedDb(operatorA), raw).commit());
    expect((await state(gap)).settlements['5']).toMatchObject({ status: 'closed' });
  });

  it('P11c3.9 (#513 review): a day that closed and reopened without ever being marked says "no backfill marker", not just "closed before"', async () => {
    const gap = shiftDate(today, -2);
    await seedGapDay(gap, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp(), status: 'reopened', lastSettlementRevision: 2 });
    const before = await state(gap);
    for (const attempt of [backfillOrder(gap), backfillPayment(gap), backfillCash(gap)]) {
      const { result } = await attempt;
      expect(result).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED', message: expect.stringContaining('沒有回填標記') } });
    }
    expect(await state(gap)).toEqual(before);
  });

  it('P11c1.6: SetOpeningCash with a reason succeeds, retries return the same receipt, and the reason is stored on the command only', async () => {
    const day = (await read(`days/${today}`))!;
    const input = {
      commandId: uuid(), kind: 'SetOpeningCash' as const, leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: day.revision }, payload: { openingCash: 700, reason: REASON },
    };
    const receipt = ok(await writer().commitCommand(input));
    const stored = (await read(`commands/${receipt.commandId}`))!;
    expect(stored).toMatchObject({ kind: 'SetOpeningCash', reason: REASON, payload: { openingCash: 700, reason: REASON } });
    expect((await read(`days/${today}`))!).toMatchObject({ openingCash: 700 });
    expect(Object.keys((await read(`days/${today}`))!).sort()).toEqual(Object.keys(day).sort());
    for (let index = 0; index < 2; index += 1) expect(ok(await writer().commitCommand(input))).toEqual(receipt);
    expect(await writer().commitCommand({ ...input, payload: { openingCash: 700, reason: 'other' } })).toMatchObject({ ok: false });
    expect(await repository().readCommand(receipt.commandId)).toMatchObject({ kind: 'SetOpeningCash', commandId: receipt.commandId });
    expect((await state()).commandCount).toBe(1);
  });

  it('P11c1.7: SetOpeningCash without a reason still works (old clients), with command reason null', async () => {
    const receipt = ok(await writer().commitCommand({
      commandId: uuid(), kind: 'SetOpeningCash', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: (await read(`days/${today}`))!.revision }, payload: { openingCash: 650 },
    }));
    expect((await read(`commands/${receipt.commandId}`))!).toMatchObject({ reason: null, payload: { openingCash: 650 } });
  });

  it('P11c1.8: the legal maximum SetOpeningCash (20,000 with a 500-character reason) passes Rules', async () => {
    const reason = '因'.repeat(500);
    ok(await writer().commitCommand({
      commandId: uuid(), kind: 'SetOpeningCash', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: (await read(`days/${today}`))!.revision }, payload: { openingCash: 20_000, reason },
    }));
    expect((await read(`days/${today}`))!).toMatchObject({ openingCash: 20_000 });
  });

  /** A complete raw SetOpeningCash closure; attacks edit it before commit. */
  async function rawSetOpening(change: { payload?: RawMap; reason?: string | null } = {}, actor = operatorA) {
    const commandId = uuid();
    const headBefore = (await read('system/dataHead'))!;
    const dayBefore = (await read(`days/${today}`))!;
    const payload: RawMap = change.payload ?? { openingCash: 700, reason: REASON };
    const input = {
      commandId, kind: 'SetOpeningCash', leaseEpoch: 1, targets: { dayId: today },
      expectedRevisions: { day: dayBefore.revision }, payload,
    };
    let fingerprint = 'f'.repeat(64);
    try { fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input)); } catch { /* invalid on purpose */ }
    const now = serverTimestamp();
    const headAfter: RawMap = { ...headBefore, seq: headBefore.seq + 1, lastCommandId: commandId, updatedAt: now };
    const dayAfter: RawMap = {
      ...dayBefore, openingCash: payload.openingCash, revision: dayBefore.revision + 1, lastCommandId: commandId, updatedAt: now,
    };
    const command: RawMap = {
      commandId, kind: 'SetOpeningCash', seq: headBefore.seq + 1, leaseEpoch: 1,
      actor: { uid: actor.uid, email: actor.email }, committedAt: now,
      businessDate: today, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
      before: { head: headBefore, day: dayBefore }, after: { head: headAfter, day: dayAfter },
      reason: change.reason === undefined ? (payload.reason ?? null) : change.reason,
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload, inputFingerprint: fingerprint,
    };
    return { commandId, command, headAfter, dayAfter };
  }

  type RawSetOpening = Awaited<ReturnType<typeof rawSetOpening>>;

  function rawSetOpeningBatch(db: Firestore, a: RawSetOpening) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'system/dataHead'), a.headAfter);
    batch.update(doc(db, `days/${today}`), a.dayAfter);
    batch.set(doc(db, `commands/${a.commandId}`), a.command);
    return batch;
  }

  it('P11c1.9: a raw SetOpeningCash with a reason works, and the plain form still works', async () => {
    await assertSucceeds(rawSetOpeningBatch(authedDb(operatorA), await rawSetOpening()).commit());
    await assertSucceeds(rawSetOpeningBatch(authedDb(operatorA), await rawSetOpening({ payload: { openingCash: 710 } })).commit());
  });

  it.each<[string, { payload?: RawMap; reason?: string | null }]>([
    ['the reason is empty', { payload: { openingCash: 700, reason: '' }, reason: '' }],
    ['the reason is 501 characters', { payload: { openingCash: 700, reason: 'x'.repeat(501) }, reason: 'x'.repeat(501) }],
    ['the reason is not a string', { payload: { openingCash: 700, reason: 5 }, reason: 5 as unknown as string }],
    ['the reason is null in the payload', { payload: { openingCash: 700, reason: null }, reason: null }],
    ['the command reason differs from the payload reason', { reason: '另一個原因' }],
    ['the command reason is null although the payload has one', { reason: null }],
    ['the command reason is set although the payload has none', { payload: { openingCash: 700 }, reason: REASON }],
    ['the payload gains an extra key', { payload: { openingCash: 700, reason: REASON, note: '' } }],
    ['the payload has only an extra key', { payload: { openingCash: 700, note: REASON }, reason: null }],
  ])('P11c1.10: Rules refuse a raw SetOpeningCash when %s', async (_label, change) => {
    const attack = await rawSetOpening(change);
    const before = await state();
    await assertFails(rawSetOpeningBatch(authedDb(operatorA), attack).commit());
    expect(await state()).toEqual(before);
  });

  it('P11c1.11: the writer refuses a differing opening without a reason, accepts it with one, and needs none when equal', async () => {
    const d1 = shiftDate(today, -2);
    await closePast(d1, 500, 700);
    const day = async () => (await read(`days/${today}`))!;
    const base = { commandId: uuid(), leaseEpoch: 1, dayId: today };
    const vendor = (await import('../cloudDayVendorRepository')).createCloudDayVendorRepository(
      authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) },
    );
    const before = await state();
    for (const reason of [undefined, '', '   ']) {
      expect(await vendor.setOpeningCash({
        ...base, commandId: uuid(), expectedRevision: (await day()).revision, openingCash: 650, ...(reason === undefined ? {} : { reason }),
      })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(await state()).toEqual(before);
    // The same amount as the last close needs no reason.
    ok(await vendor.setOpeningCash({ ...base, commandId: uuid(), expectedRevision: (await day()).revision, openingCash: 700 }));
    // A different amount with a reason is accepted; surrounding spaces are trimmed.
    const receipt = ok(await vendor.setOpeningCash({
      ...base, commandId: uuid(), expectedRevision: (await day()).revision, openingCash: 650, reason: `  ${REASON}  `,
    }));
    expect((await read(`commands/${receipt.commandId}`))!).toMatchObject({ reason: REASON, payload: { openingCash: 650, reason: REASON } });
    expect(await vendor.setOpeningCash({
      ...base, commandId: uuid(), expectedRevision: (await day()).revision, openingCash: 650, reason: 'x'.repeat(501),
    })).toMatchObject({ ok: false });
  });

  it('P11c1.12: without any closed day the writer needs no reason; a non-holder is refused', async () => {
    const vendor = (await import('../cloudDayVendorRepository')).createCloudDayVendorRepository(
      authedDb(operatorA), { currentUser: () => fakeCurrentUser(operatorA) },
    );
    ok(await vendor.setOpeningCash({
      commandId: uuid(), leaseEpoch: 1, dayId: today, expectedRevision: (await read(`days/${today}`))!.revision, openingCash: 1234,
    }));
    const other = (await import('../cloudDayVendorRepository')).createCloudDayVendorRepository(
      authedDb(operatorB), { currentUser: () => fakeCurrentUser(operatorB) },
    );
    expect(await other.setOpeningCash({
      commandId: uuid(), leaseEpoch: 1, dayId: today, expectedRevision: (await read(`days/${today}`))!.revision, openingCash: 1,
    })).toMatchObject({ ok: false, error: { code: 'LEASE_LOST' } });
  });
  // ---- P11c4a: post-close entries on a closed day (contract §15) ----

  const PC_REASON = '關帳後發現少收的零錢，補記一筆收入';

  /** A closed past day: opening 1,000, no activity, so it closed at 1,000. */
  async function seedClosedDay(dayId: string, change: RawMap = {}) {
    await seedGapDay(dayId, { status: 'closed', lastSettlementRevision: 1, openingCash: 1000, openedBy: operatorA.uid, openedAt: serverTimestamp(), ...change });
  }

  async function recordEntry(
    dayId: string,
    change: { direction?: 'income' | 'expense'; amount?: number; reason?: string; commandId?: string; day?: number; settlement?: number } = {},
    actor = operatorA,
  ) {
    const day = (await read(`days/${dayId}`))!;
    return writer(actor).commitCommand({
      commandId: change.commandId ?? uuid(), kind: 'RecordPostCloseEntry', leaseEpoch: 1,
      targets: { dayId },
      expectedRevisions: { day: change.day ?? day.revision, settlement: change.settlement ?? day.lastSettlementRevision },
      payload: { direction: change.direction ?? 'expense', amount: change.amount ?? 50, reason: change.reason ?? PC_REASON },
    });
  }

  type RawEntry = Awaited<ReturnType<typeof rawPostClose>>;

  /** A complete raw SDK RecordPostCloseEntry closure, built the same way as the repository. */
  async function rawPostClose(
    dayId: string,
    change: { direction?: 'income' | 'expense'; amount?: number; reason?: string } = {},
    actor = operatorA,
  ) {
    const commandId = uuid();
    const headBefore = (await read('system/dataHead'))!;
    const dayBefore = (await read(`days/${dayId}`))!;
    const payload: RawMap = {
      direction: change.direction ?? 'expense', amount: change.amount ?? 50, reason: change.reason ?? PC_REASON,
    };
    const input = {
      commandId, kind: 'RecordPostCloseEntry', leaseEpoch: 1, targets: { dayId },
      expectedRevisions: { day: dayBefore.revision, settlement: dayBefore.lastSettlementRevision }, payload,
    };
    let fingerprint = 'f'.repeat(64);
    try { fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input)); } catch { /* invalid on purpose */ }
    const now = serverTimestamp();
    const headAfter: RawMap = { ...headBefore, seq: headBefore.seq + 1, lastCommandId: commandId, updatedAt: now };
    const entry: RawMap = {
      entryId: commandId, dayId, settlementRevision: dayBefore.lastSettlementRevision,
      direction: payload.direction, amount: payload.amount, reason: payload.reason,
      createdBy: actor.uid, createdAt: now, commandId,
    };
    const command: RawMap = {
      commandId, kind: 'RecordPostCloseEntry', seq: headBefore.seq + 1, leaseEpoch: 1,
      actor: { uid: actor.uid, email: actor.email }, committedAt: now,
      businessDate: dayId, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
      before: {}, after: {}, reason: payload.reason,
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload, inputFingerprint: fingerprint,
    };
    const artifacts = { commandId, dayId, command, headBefore, headAfter, dayBefore, entry };
    syncPostClose(artifacts);
    return artifacts;
  }

  function syncPostClose(a: RawEntry) {
    a.command.before = { head: a.headBefore, day: a.dayBefore, postCloseEntry: null };
    a.command.after = { head: a.headAfter, day: a.dayBefore, postCloseEntry: a.entry };
  }

  type PostCloseBatch = { omitEntry?: boolean; omitHead?: boolean; omitCommand?: boolean; entryPath?: string; copyPath?: string; touchDay?: RawMap };

  function rawPostCloseBatch(db: Firestore, a: RawEntry, options: PostCloseBatch = {}) {
    const batch = writeBatch(db);
    if (!options.omitHead) batch.update(doc(db, 'system/dataHead'), a.headAfter);
    if (!options.omitEntry) batch.set(doc(db, options.entryPath ?? `postCloseEntries/${a.commandId}`), a.entry);
    // A copy of the entry under another document ID would be counted twice.
    if (options.copyPath) batch.set(doc(db, options.copyPath), a.entry);
    if (options.touchDay) batch.update(doc(db, `days/${a.dayId}`), options.touchDay);
    if (!options.omitCommand) batch.set(doc(db, `commands/${a.commandId}`), a.command);
    return batch;
  }

  async function entryCount() {
    return withAdmin(async db => (await getDocs(collection(db, 'postCloseEntries'))).size);
  }

  async function expectPostCloseDenied(a: RawEntry, options: PostCloseBatch = {}, actor = operatorA) {
    const before = await state(a.dayId);
    const entries = await entryCount();
    await assertFails(rawPostCloseBatch(authedDb(actor), a, options).commit());
    expect(await state(a.dayId)).toEqual(before);
    expect(await entryCount()).toBe(entries);
  }

  it('P11c4.1: a closed day takes a marked entry without touching the day; a retry returns the same receipt', async () => {
    const monday = shiftDate(today, -3);
    await seedClosedDay(monday);
    const dayBefore = (await read(`days/${monday}`))!;
    const headBefore = (await read('system/dataHead'))!;
    const commandId = uuid();
    const receipt = ok(await recordEntry(monday, { commandId }));
    expect(receipt).toMatchObject({ commandId });
    // The day document and its settlements are exactly as before; the head moved one step.
    expect((await read(`days/${monday}`))!).toEqual(dayBefore);
    expect((await read('system/dataHead'))!.seq).toBe(headBefore.seq + 1);
    expect((await read(`postCloseEntries/${commandId}`))!).toMatchObject({
      entryId: commandId, dayId: monday, settlementRevision: 1, direction: 'expense', amount: 50,
      reason: PC_REASON, createdBy: operatorA.uid, commandId,
    });
    expect((await read(`commands/${commandId}`))!).toMatchObject({
      kind: 'RecordPostCloseEntry', businessDate: monday, studentId: null, reason: PC_REASON,
      payload: { direction: 'expense', amount: 50, reason: PC_REASON },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
    expect(await repository().readCommand(commandId)).toMatchObject({ commandId, kind: 'RecordPostCloseEntry' });
    const commandCount = (await state(monday)).commandCount;
    for (let index = 0; index < 2; index += 1) expect(ok(await recordEntry(monday, { commandId }))).toEqual(receipt);
    expect((await state(monday)).commandCount).toBe(commandCount);
    expect(await entryCount()).toBe(1);
    // The same command ID with another payload is a different request and is refused.
    expect((await recordEntry(monday, { commandId, amount: 60 })).ok).toBe(false);
    expect(await entryCount()).toBe(1);
  });

  it('P11c4.2: the writer refuses an open or reopened day, a stale revision, bad amounts and reasons, a missing day and a non-holder', async () => {
    const closed = shiftDate(today, -3);
    const open = shiftDate(today, -4);
    const reopened = shiftDate(today, -5);
    const missing = shiftDate(today, -6);
    await seedClosedDay(closed);
    await seedGapDay(open, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedGapDay(reopened, { status: 'reopened', lastSettlementRevision: 2, openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    const stale = (await read(`days/${closed}`))!;
    const outcomes: Array<[string, Promise<CommandResult>, string]> = [
      ['open day', recordEntry(open, { settlement: 0 }), 'INVALID_INPUT'],
      ['open day claiming a settlement', recordEntry(open, { settlement: 1 }), 'REVISION_CONFLICT'],
      ['reopened day', recordEntry(reopened), 'INVALID_INPUT'],
      ['today', recordEntry(today, { settlement: 0 }), 'INVALID_INPUT'],
      ['missing day', recordEntry(missing, { day: 1, settlement: 1 }), 'INVALID_INPUT'],
      ['stale day revision', recordEntry(closed, { day: stale.revision - 1 }), 'REVISION_CONFLICT'],
      ['stale settlement revision', recordEntry(closed, { settlement: 2 }), 'REVISION_CONFLICT'],
      ['zero amount', recordEntry(closed, { amount: 0 }), 'INVALID_INPUT'],
      ['too large amount', recordEntry(closed, { amount: 20_001 }), 'INVALID_INPUT'],
      ['fractional amount', recordEntry(closed, { amount: 10.5 }), 'INVALID_INPUT'],
      ['no reason', recordEntry(closed, { reason: '' }), 'INVALID_INPUT'],
      ['long reason', recordEntry(closed, { reason: 'x'.repeat(501) }), 'INVALID_INPUT'],
      ['spaces-only reason', recordEntry(closed, { reason: '   ' }), 'INVALID_INPUT'],
      ['tab-and-newline reason', recordEntry(closed, { reason: '\t\n' }), 'INVALID_INPUT'],
      ['bad direction', recordEntry(closed, { direction: 'refund' as unknown as 'income' }), 'INVALID_INPUT'],
      ['not the holder', recordEntry(closed, {}, operatorB), 'LEASE_LOST'],
    ];
    const results = await Promise.all(outcomes.map(([, promise]) => promise));
    outcomes.forEach(([label, , code], index) => {
      expect(results[index], `${label}: ${JSON.stringify(results[index])}`).toMatchObject({ ok: false, error: { code } });
    });
    expect(await entryCount()).toBe(0);
  });

  it('P11c4.3: the legal maximum entry (20,000, 500-character reason) passes Rules through a raw batch only for the holder', async () => {
    const monday = shiftDate(today, -3);
    await seedClosedDay(monday);
    const options = { direction: 'income' as const, amount: 20_000, reason: '因'.repeat(500) };
    await expectPostCloseDenied(await rawPostClose(monday, options, operatorB), {}, operatorB);
    await assertSucceeds(rawPostCloseBatch(authedDb(operatorA), await rawPostClose(monday, options)).commit());
    expect(await entryCount()).toBe(1);
  });

  // 只有空白的原因：長度檢查會通過；Rules 擋 ASCII 空白（trim 只處理 ASCII），schema 同樣只擋 ASCII 空白。
  // schema、備份與讀取都不可比 Rules 嚴格（見 cloudBackup.spec 的 Unicode 空白案例）。
  const setReason = (a: RawEntry, reason: string): void => {
    a.command.payload = { ...a.command.payload, reason };
    a.command.reason = reason;
    a.entry.reason = reason;
    syncPostClose(a);
  };

  it.each<[string, (a: RawEntry) => void, PostCloseBatch?]>([
    ['the amount is zero', a => { a.command.payload = { ...a.command.payload, amount: 0 }; a.entry.amount = 0; syncPostClose(a); }],
    ['the amount is above 20,000', a => { a.command.payload = { ...a.command.payload, amount: 20_001 }; a.entry.amount = 20_001; syncPostClose(a); }],
    ['the amount is fractional', a => { a.command.payload = { ...a.command.payload, amount: 1.5 }; a.entry.amount = 1.5; syncPostClose(a); }],
    ['the direction is unknown', a => { a.command.payload = { ...a.command.payload, direction: 'refund' }; a.entry.direction = 'refund'; syncPostClose(a); }],
    ['the reason is empty', a => { a.command.payload = { ...a.command.payload, reason: '' }; a.command.reason = ''; a.entry.reason = ''; syncPostClose(a); }],
    ['the reason is too long', a => { const reason = 'x'.repeat(501); a.command.payload = { ...a.command.payload, reason }; a.command.reason = reason; a.entry.reason = reason; syncPostClose(a); }],
    ['the reason is only spaces', a => { setReason(a, '   '); }],
    ['the reason is only a tab and a newline', a => { setReason(a, '\t\n'); }],
    ['the reason is only carriage returns and spaces', a => { setReason(a, ' \r\n\t\r'); }],
    ['the command reason differs from the payload reason', a => { a.command.reason = 'other'; }],
    ['the command reason is null', a => { a.command.reason = null; }],
    ['the entry reason differs from the payload', a => { a.entry.reason = 'tampered'; syncPostClose(a); }],
    ['the entry amount differs from the payload', a => { a.entry.amount = 51; syncPostClose(a); }],
    ['the entry direction differs from the payload', a => { a.entry.direction = 'income'; syncPostClose(a); }],
    ['the entry names another settlement revision', a => { a.entry.settlementRevision = 2; syncPostClose(a); }],
    ['the entry names another day', a => { a.entry.dayId = shiftDate(today, -4); syncPostClose(a); }],
    ['the entry names another creator', a => { a.entry.createdBy = operatorB.uid; syncPostClose(a); }],
    ['the entry time is not the commit time', a => { a.entry.createdAt = a.dayBefore.updatedAt; syncPostClose(a); }],
    ['the entry command ID is another command', a => { a.entry.commandId = uuid(); syncPostClose(a); }],
    ['the entry ID is another ID', a => { a.entry.entryId = uuid(); syncPostClose(a); }],
    ['the entry gains an extra field', a => { a.entry.extra = true; syncPostClose(a); }],
    ['the payload gains an extra key', a => { a.command.payload = { ...a.command.payload, note: '' }; }],
    ['the day changes inside the command', a => { a.command.after = { ...a.command.after, day: { ...a.dayBefore, revision: a.dayBefore.revision + 1 } }; }],
    ['the cash effect is not zero', a => { a.command.cashEffect = { before: 0, after: 50, delta: 50, reasonKind: 'payout', refundAmount: 0 }; }],
    ['the business date is another day', a => { a.command.businessDate = today; }],
    ['the command names a student', a => { a.command.studentId = studentA; }],
    ['the expected day revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, day: 1 }; }],
    ['the expected settlement revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, settlement: 0 }; }],
    ['the targets gain a key', a => { a.command.targets = { ...a.command.targets, settlementRevision: 1 }; }],
    ['the before-snapshot claims an existing entry', a => { a.command.before = { ...a.command.before, postCloseEntry: a.entry }; }],
    ['the command is relabelled as StartBackfill', a => { a.command.kind = 'StartBackfill'; }],
    ['the command is relabelled as CreateCashMovement', a => { a.command.kind = 'CreateCashMovement'; }],
    ['the entry is written at another path', () => undefined, { entryPath: 'postCloseEntries/0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b' }],
    ['the entry is written without the command', () => undefined, { omitCommand: true }],
    ['the command is written without the entry', () => undefined, { omitEntry: true }],
    ['the head is not advanced', () => undefined, { omitHead: true }],
  ])('P11c4.4: a raw RecordPostCloseEntry is denied atomically when %s', async (_label, attack, options) => {
    const monday = shiftDate(today, -3);
    await seedClosedDay(monday);
    const raw = await rawPostClose(monday);
    attack(raw);
    await expectPostCloseDenied(raw, options);
  });

  it('P11c4.5: Rules refuse an entry on an open or reopened day, a day before go-live, and a day touched in the same batch', async () => {
    const open = shiftDate(today, -4);
    const reopened = shiftDate(today, -5);
    const beforeGoLive = shiftDate(today, -31);
    const closed = shiftDate(today, -3);
    await seedGapDay(open, { openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedGapDay(reopened, { status: 'reopened', lastSettlementRevision: 2, openingCash: 800, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    await seedClosedDay(beforeGoLive);
    await seedClosedDay(closed);
    await expectPostCloseDenied(await rawPostClose(open));
    await expectPostCloseDenied(await rawPostClose(reopened));
    await expectPostCloseDenied(await rawPostClose(beforeGoLive));
    await expectPostCloseDenied(await rawPostClose(today));
    // Writing the day alongside the entry (status, revision, totals) is refused: only the entry may land.
    const raw = await rawPostClose(closed);
    await expectPostCloseDenied(raw, { touchDay: { revision: raw.dayBefore.revision + 1, lastCommandId: raw.commandId, updatedAt: serverTimestamp() } });
    await expectPostCloseDenied(await rawPostClose(closed), { touchDay: { status: 'open', revision: 7, lastCommandId: 'x', updatedAt: serverTimestamp() } });
    // The entry lives only at postCloseEntries/{commandId}: a second copy under another ID, or the only copy under
    // another ID, is refused (a copy would double the entry's effect on the effective closing cash).
    await expectPostCloseDenied(await rawPostClose(closed), { copyPath: `postCloseEntries/${uuid()}` });
    await expectPostCloseDenied(await rawPostClose(closed), { entryPath: `postCloseEntries/${uuid()}` });
  });

  it('P11c4.6: an entry can be neither edited nor deleted nor created by hand, and only the holder reads them', async () => {
    const monday = shiftDate(today, -3);
    await seedClosedDay(monday);
    const commandId = uuid();
    ok(await recordEntry(monday, { commandId }));
    const entry = (await read(`postCloseEntries/${commandId}`))!;
    const holder = authedDb(operatorA);
    await assertFails(updateDoc(doc(holder, `postCloseEntries/${commandId}`), { amount: 1 }));
    await assertFails(updateDoc(doc(holder, `postCloseEntries/${commandId}`), { reason: '改掉原因' }));
    await assertFails(deleteDoc(doc(holder, `postCloseEntries/${commandId}`)));
    await assertFails(setDoc(doc(holder, `postCloseEntries/${commandId}`), { ...entry, amount: 1 }));
    const handmade = uuid();
    await assertFails(setDoc(doc(holder, `postCloseEntries/${handmade}`), { ...entry, entryId: handmade, commandId: handmade }));
    await assertFails(deleteDoc(doc(authedDb(operatorB), `postCloseEntries/${commandId}`)));
    expect(await read(`postCloseEntries/${commandId}`)).toEqual(entry);
    await assertSucceeds(getDoc(doc(holder, `postCloseEntries/${commandId}`)));
    await assertFails(getDoc(doc(authedDb(operatorB), `postCloseEntries/${commandId}`)));
    await assertSucceeds(getDocs(query(collection(holder, 'postCloseEntries'), limit(500))));
    await assertFails(getDocs(query(collection(authedDb(operatorB), 'postCloseEntries'), limit(500))));
  });

  // ---- P11c4a: effective closing cash end to end ----

  const mismatchDays = (snapshot: { anomalies: Array<{ kind: string; dayId: string }> }) =>
    snapshot.anomalies.filter(item => item.kind === 'opening-mismatch').map(item => item.dayId);

  it('P11c4.7: the Q2 example — Monday closes at 1,000, Wednesday opens at 950, a 50 expense entry on Monday removes the mismatch', async () => {
    const monday = shiftDate(today, -3);
    const wednesday = shiftDate(today, -1);
    await closePast(monday, 830, 1000);
    await seedPastDay(wednesday, { openingCash: 950, openedBy: operatorA.uid, openedAt: serverTimestamp() });
    // Today also opened at 950 (Wednesday is not closed, so Monday is still the last closed day for both).
    await withAdmin(async db => updateDoc(doc(db, `days/${today}`), { openingCash: 950 }));
    const before = await repository().readLedger();
    expect(mismatchDays(before)).toEqual([wednesday, today]);
    expect(before.anomalies.find(item => item.kind === 'opening-mismatch')).toMatchObject({ difference: -50, previousPostCloseNet: 0, previousEffectiveCash: 1000 });
    ok(await recordEntry(monday, { direction: 'expense', amount: 50, reason: '星期一漏記買零錢' }));
    const after = await repository().readLedger();
    expect(mismatchDays(after)).toEqual([]);
    expect(after.closedDays).toEqual([{ dayId: monday, countedCash: 1000, postCloseNet: -50 }]);
    // The opening default for the next day uses the effective cash too.
    expect((await repository().findPreviousClosed(wednesday)).previous).toEqual({ dayId: monday, countedCash: 1000, postCloseNet: -50 });
    // The wrong direction makes the gap larger, not smaller; entries add up.
    ok(await recordEntry(monday, { direction: 'income', amount: 80, reason: '補記少收的零錢' }));
    const income = await repository().readLedger();
    expect(income.anomalies.find(item => item.kind === 'opening-mismatch')).toMatchObject({ difference: -80, previousPostCloseNet: 30, previousEffectiveCash: 1030 });
  });

  it('P11c4.8: after a reopen and re-close the old entry is history only; the new one counts', async () => {
    const day = shiftDate(today, -3);
    await closePast(day, 500, 700);
    ok(await recordEntry(day, { direction: 'income', amount: 20, reason: '第一版關帳後補記' }));
    const first = await repository().read(day);
    expect(first).toMatchObject({ status: 'closed', lastSettlementRevision: 1, effectiveCash: 720 });
    expect(first?.postCloseEntries.map(entry => [entry.settlementRevision, entry.direction, entry.amount])).toEqual([[1, 'income', 20]]);
    ok(await repository().reopenDay(await reopenInput('重新點算', day)));
    expect((await repository().read(day))?.effectiveCash).toBeNull(); // a reopened day has no closing cash
    ok(await repository().closeDay(await closeInput({ countedCash: 705, note: '重新點算' }, day)));
    const second = await repository().read(day);
    expect(second).toMatchObject({ status: 'closed', lastSettlementRevision: 3, effectiveCash: 705 });
    expect(second?.postCloseEntries.map(entry => entry.settlementRevision)).toEqual([1]);
    expect((await repository().readLedger()).closedDays).toEqual([{ dayId: day, countedCash: 705, postCloseNet: 0 }]);
    ok(await recordEntry(day, { direction: 'expense', amount: 10, reason: '第二版關帳後補記' }));
    expect(await repository().read(day)).toMatchObject({ effectiveCash: 695 });
    // The old entry is refused against the new version, and the retry of the first command stays idempotent.
    const stale = await recordEntry(day, { settlement: 1 });
    expect(stale).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('P11c4.9: a day with more than one page of entries is read completely; an entry for a missing settlement version fails closed', async () => {
    const day = shiftDate(today, -3);
    await closePast(day, 500, 700);
    await withAdmin(async db => {
      for (let index = 0; index < 205; index += 1) {
        const entryId = uuid();
        await setDoc(doc(db, `postCloseEntries/${entryId}`), {
          entryId, dayId: day, settlementRevision: 1, direction: index % 5 === 0 ? 'income' : 'expense', amount: 1,
          reason: '大量補記', createdBy: operatorA.uid, createdAt: serverTimestamp(), commandId: entryId,
        });
      }
    });
    const view = await repository().read(day);
    expect(view?.postCloseEntries).toHaveLength(205);
    expect(view?.effectiveCash).toBe(700 + 41 - 164);
    const snapshot = await repository().readLedger();
    expect(snapshot.closedDays).toEqual([{ dayId: day, countedCash: 700, postCloseNet: 41 - 164 }]);
    const bad = uuid();
    await withAdmin(async db => setDoc(doc(db, `postCloseEntries/${bad}`), {
      entryId: bad, dayId: day, settlementRevision: 2, direction: 'income', amount: 1, reason: '指向不存在的版本',
      createdBy: operatorA.uid, createdAt: serverTimestamp(), commandId: bad,
    }));
    await expect(repository().read(day)).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
});
