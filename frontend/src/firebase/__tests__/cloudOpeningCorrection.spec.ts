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
import type { CommandResult } from '../../domain/cloudCommands';
import { fingerprintCommandInput, normalizeEnabledCommandInput } from '../../domain/cloudCommandSchema';
import { createCloudStudentRepository, type CorrectCloudOpeningInput } from '../cloudStudentRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_OPENING === 'true';
if (required && !emulatorHost) throw new Error('P10b opening-correction Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);

const operatorA = { uid: 'p10b-opening-a', email: 'p10b-opening-a@example.test', displayName: 'Synthetic Opening A', active: true };
const operatorB = { uid: 'p10b-opening-b', email: 'p10b-opening-b@example.test', displayName: 'Synthetic Opening B', active: true };
const studentA = '33333333-3333-4333-8333-333333333333';
const studentB = '44444444-4444-4444-8444-444444444444';
const seedCommandId = '00000000-0000-4000-8000-00000000000b';

let env: RulesTestEnvironment;
let today = '';
let openingDate = '';

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
  return createCloudStudentRepository(authedDb(operator), { currentUser: () => fakeCurrentUser(operator) });
}

/** studentA: opening 100 on the opening date, later meals and payments leave the balance at 250. */
function student(studentId: string, code: string, opening: number, balance: number) {
  return {
    studentId, studentCode: code, displayName: `Synthetic ${code}`, aliases: [], status: 'active',
    openingBalance: { amount: opening, asOfDate: openingDate, note: '舊帳本', createdAt: serverTimestamp() },
    currentBalance: balance, createdAt: serverTimestamp(), revision: 3,
    lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

function totals() {
  return {
    activeTransactionCount: 2, bentoCount: 1, otherMealCount: 0, mealTotal: 90,
    retainedReceipts: 240, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
  };
}

function dayDoc(date: string, status: 'open' | 'closed' | 'reopened' = 'open') {
  return {
    status, revision: 4,
    menu: {
      businessDate: date, itemName: 'Synthetic Meal', price: 90, vendorId: 'p10b-vendor',
      vendorNameSnapshot: 'Synthetic Vendor', updatedAt: serverTimestamp(), revision: 1, inheritedFromDate: null,
    },
    openingCash: 500, openedBy: operatorA.uid, openedAt: serverTimestamp(),
    totals: totals(),
    lastSettlementRevision: status === 'open' ? 0 : status === 'closed' ? 1 : 2,
    lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

async function seed(options: { day?: 'open' | 'closed' | 'reopened' | 'missing' } = {}) {
  today = taipeiDate(new Date());
  openingDate = shiftDate(today, -5);
  await withAdmin(async db => {
    await setDoc(doc(db, `operators/${operatorA.uid}`), { ...operatorA, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, `operators/${operatorB.uid}`), { ...operatorB, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: operatorA.uid, epoch: 1, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p10b-opening-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: shiftDate(today, -30), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `students/${studentA}`), student(studentA, '001', 100, 250));
    await setDoc(doc(db, 'studentCodes/001'), { studentId: studentA, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    await setDoc(doc(db, `students/${studentB}`), { ...student(studentB, '002', 0, 0), status: 'inactive' });
    await setDoc(doc(db, 'studentCodes/002'), { studentId: studentB, lastCommandId: seedCommandId, updatedAt: serverTimestamp() });
    const day = options.day ?? 'open';
    if (day !== 'missing') await setDoc(doc(db, `days/${openingDate}`), dayDoc(openingDate, day));
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

async function state() {
  return withAdmin(async db => {
    const [head, day, a, b, commands] = await Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${openingDate}`)),
      getDoc(doc(db, `students/${studentA}`)),
      getDoc(doc(db, `students/${studentB}`)),
      getDocs(collection(db, 'commands')),
    ]);
    return { head: head.data(), day: day.data(), studentA: a.data(), studentB: b.data(), commandCount: commands.size };
  });
}

/** Builds the F3 input from the server's current revisions, exactly as the students page would. */
async function correctionInput(studentId: string, change: { amount: number; note?: string; reason?: string }): Promise<CorrectCloudOpeningInput> {
  const studentDoc = (await read(`students/${studentId}`))!;
  const dayDocument = (await read(`days/${studentDoc.openingBalance.asOfDate}`))!;
  return {
    commandId: uuid(), leaseEpoch: 1, studentId, dayId: studentDoc.openingBalance.asOfDate,
    expectedStudentRevision: studentDoc.revision, expectedDayRevision: dayDocument.revision,
    amount: change.amount, note: change.note ?? studentDoc.openingBalance.note, reason: change.reason ?? '對帳發現期初少記',
  };
}

/** A complete raw SDK CorrectOpening closure, built the same way as the repository. */
async function rawCorrection(studentId: string, change: { amount: number; note?: string }, actor = operatorA) {
  const commandId = uuid();
  const [headBefore, studentBefore] = await Promise.all([read('system/dataHead'), read(`students/${studentId}`)]) as RawMap[];
  const dayId = studentBefore.openingBalance.asOfDate as string;
  const dayBefore = (await read(`days/${dayId}`))!;
  const payload = { amount: change.amount, note: change.note ?? studentBefore.openingBalance.note, reason: '對帳發現期初少記' };
  const input = {
    commandId, kind: 'CorrectOpening' as const, leaseEpoch: 1,
    targets: { studentId, dayId },
    expectedRevisions: { student: studentBefore.revision, day: dayBefore.revision },
    payload,
  };
  const fingerprint = await fingerprintCommandInput(normalizeEnabledCommandInput(input));
  const now = serverTimestamp();
  const headAfter: RawMap = { ...headBefore, seq: headBefore.seq + 1, lastCommandId: commandId, updatedAt: now };
  const studentAfter: RawMap = {
    ...studentBefore,
    openingBalance: { ...studentBefore.openingBalance, amount: payload.amount, note: payload.note },
    currentBalance: studentBefore.currentBalance - studentBefore.openingBalance.amount + payload.amount,
    revision: studentBefore.revision + 1, lastCommandId: commandId, updatedAt: now,
  };
  const dayAfter: RawMap = { ...dayBefore, revision: dayBefore.revision + 1, lastCommandId: commandId, updatedAt: now };
  const command: RawMap = {
    commandId, kind: 'CorrectOpening', seq: headBefore.seq + 1, leaseEpoch: 1,
    actor: { uid: actor.uid, email: actor.email }, committedAt: now,
    businessDate: dayId, studentId, targets: input.targets, expectedRevisions: input.expectedRevisions,
    before: {}, after: {}, reason: payload.reason,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload, inputFingerprint: fingerprint,
  };
  const artifacts = { commandId, studentId, dayId, command, headBefore, headAfter, studentBefore, studentAfter, dayBefore, dayAfter };
  syncSnapshots(artifacts);
  return artifacts;
}

type RawCorrection = Awaited<ReturnType<typeof rawCorrection>>;

/** Keeps the command before/after snapshots in sync when an attack case edits a projection. */
function syncSnapshots(a: RawCorrection) {
  a.command.before = { head: a.headBefore, student: a.studentBefore, day: a.dayBefore };
  a.command.after = { head: a.headAfter, student: a.studentAfter, day: a.dayAfter };
}

type BatchOptions = { omitDay?: boolean; omitStudent?: boolean };

function rawBatch(db: Firestore, a: RawCorrection, options: BatchOptions = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'system/dataHead'), a.headAfter);
  if (!options.omitStudent) batch.update(doc(db, `students/${a.studentId}`), a.studentAfter);
  if (!options.omitDay) batch.update(doc(db, `days/${a.dayId}`), a.dayAfter);
  batch.set(doc(db, `commands/${a.commandId}`), a.command);
  return batch;
}

async function expectRawDenied(a: RawCorrection, options: BatchOptions = {}, actor = operatorA) {
  const before = await state();
  await assertFails(rawBatch(authedDb(actor), a, options).commit());
  expect(await state()).toEqual(before);
}

describeWithEmulator('P10b CorrectOpening (F3): repository, receipt and production Rules', () => {
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

  it('P10b.1 (F3): correcting the opening 100 to 80 moves the balance 250 to 230 on the original date with zero cash', async () => {
    const before = await state();
    const input = await correctionInput(studentA, { amount: 80, note: '核對紙本後更正', reason: '期初抄錯 20 元' });
    const receipt = ok(await repository().correctOpening(input));
    const after = await state();

    expect(after.studentA).toMatchObject({
      currentBalance: 230, revision: 4, lastCommandId: receipt.commandId,
      openingBalance: { amount: 80, asOfDate: openingDate, note: '核對紙本後更正' },
    });
    expect(after.studentA!.openingBalance.createdAt).toEqual(before.studentA!.openingBalance.createdAt);
    expect(after.studentA!.createdAt).toEqual(before.studentA!.createdAt);
    expect(after.studentA!.status).toBe('active');
    // The day only records the change: totals, menu, opening cash and status stay as they were.
    expect(after.day).toMatchObject({ revision: 5, lastCommandId: receipt.commandId, status: 'open', openingCash: 500, totals: totals() });
    expect(after.day!.menu).toEqual(before.day!.menu);
    expect(after.studentB).toEqual(before.studentB);

    const stored = (await read(`commands/${receipt.commandId}`))!;
    expect(stored).toMatchObject({
      kind: 'CorrectOpening', businessDate: openingDate, studentId: studentA, reason: '期初抄錯 20 元',
      targets: { studentId: studentA, dayId: openingDate }, expectedRevisions: { student: 3, day: 4 },
      payload: { amount: 80, note: '核對紙本後更正', reason: '期初抄錯 20 元' },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
    expect(stored.before.student.openingBalance.amount).toBe(100);
    expect(stored.before.student.currentBalance).toBe(250);
    expect(stored.after.student.currentBalance).toBe(230);

    const readBack = await repository().readCommand(receipt.commandId);
    expect(readBack).toMatchObject({ commandId: receipt.commandId, kind: 'CorrectOpening', seq: 1 });
  });

  it('P10b.2: changing only the note is allowed; changing nothing is refused before any write', async () => {
    const receipt = ok(await repository().correctOpening(await correctionInput(studentA, { amount: 100, note: '補上來源' })));
    expect((await state()).studentA).toMatchObject({ currentBalance: 250, openingBalance: { amount: 100, note: '補上來源' }, lastCommandId: receipt.commandId });

    const before = await state();
    const unchanged = await repository().correctOpening(await correctionInput(studentA, { amount: 100, note: '補上來源' }));
    expect(unchanged).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state()).toEqual(before);
  });

  it('P10b.3: a missing opening day is refused; after EnsureDay the correction commits', async () => {
    await env.clearFirestore();
    await seed({ day: 'missing' });
    expect(await repository().readOpeningDay(openingDate)).toBeNull();
    const studentDoc = (await read(`students/${studentA}`))!;
    const before = await state();
    const refused = await repository().correctOpening({
      commandId: uuid(), leaseEpoch: 1, studentId: studentA, dayId: openingDate,
      expectedStudentRevision: studentDoc.revision, expectedDayRevision: 1, amount: 80, note: '', reason: '期初抄錯',
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(await state()).toEqual(before);

    ok(await repository().ensureOpeningDay({ commandId: uuid(), leaseEpoch: 1, dayId: openingDate }));
    const day = await repository().readOpeningDay(openingDate);
    expect(day).toEqual({ dayId: openingDate, revision: 1, status: 'open' });
    ok(await repository().correctOpening(await correctionInput(studentA, { amount: 80 })));
    expect((await state()).studentA?.currentBalance).toBe(230);
  });

  it('P10b.4 (F3): a closed opening day is refused; after a reopen the correction commits', async () => {
    await env.clearFirestore();
    await seed({ day: 'closed' });
    const before = await state();
    const closed = await repository().correctOpening(await correctionInput(studentA, { amount: 80 }));
    expect(closed).toMatchObject({ ok: false, error: { code: 'DAY_CLOSED' } });
    expect(await state()).toEqual(before);
    await expectRawDenied(await rawCorrection(studentA, { amount: 80 }));

    await withAdmin(async db => updateDoc(doc(db, `days/${openingDate}`), { status: 'reopened', lastSettlementRevision: 2 }));
    ok(await repository().correctOpening(await correctionInput(studentA, { amount: 80 })));
    expect((await state()).day).toMatchObject({ status: 'reopened', revision: 5, totals: totals() });
  });

  it('P10b.5: an inactive student can still have the opening corrected and stays inactive', async () => {
    ok(await repository().correctOpening(await correctionInput(studentB, { amount: -40, note: '欠款補登' })));
    expect((await state()).studentB).toMatchObject({ status: 'inactive', currentBalance: -40, openingBalance: { amount: -40, note: '欠款補登' } });
  });

  it('P10b.6: stale student or day revisions are revision conflicts; retries apply once; the same ID with other content is refused', async () => {
    const stale = await correctionInput(studentA, { amount: 80 });
    const staleStudent = await repository().correctOpening({ ...stale, expectedStudentRevision: stale.expectedStudentRevision - 1 });
    expect(staleStudent).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    const staleDay = await repository().correctOpening({ ...stale, expectedDayRevision: stale.expectedDayRevision + 1 });
    expect(staleDay).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });

    const input = await correctionInput(studentA, { amount: 80 });
    const first = ok(await repository().correctOpening(input));
    for (let index = 0; index < 5; index += 1) {
      expect(ok(await repository().correctOpening(input))).toEqual(first);
    }
    expect((await state())).toMatchObject({ commandCount: 1, studentA: { currentBalance: 230, revision: 4 } });
    const differentContent = await repository().correctOpening({ ...input, amount: 70 });
    expect(differentContent.ok).toBe(false);
    expect((await state()).studentA?.currentBalance).toBe(230);
  });

  it('P10b.7: legal maximum payloads (500-char note and reason, −1e9 amount) stay under the expression ceiling', async () => {
    ok(await repository().correctOpening(await correctionInput(studentA, {
      amount: -1_000_000_000, note: '備'.repeat(500), reason: '因'.repeat(500),
    })));
    expect((await state()).studentA?.currentBalance).toBe(-999_999_850);
  });

  it('P10b.8: a raw SDK closure commits for the holder and is denied for a non-holder', async () => {
    const raw = await rawCorrection(studentA, { amount: 80 });
    await expectRawDenied(raw, {}, operatorB);
    await assertSucceeds(rawBatch(authedDb(operatorA), raw).commit());
    expect((await state()).studentA?.currentBalance).toBe(230);
  });

  it.each<[string, (a: RawCorrection) => void]>([
    ['the opening date moves', a => { a.studentAfter.openingBalance = { ...a.studentAfter.openingBalance, asOfDate: today }; syncSnapshots(a); }],
    ['the opening creation time changes', a => { a.studentAfter.openingBalance = { ...a.studentAfter.openingBalance, createdAt: serverTimestamp() }; syncSnapshots(a); }],
    ['the opening gains an extra field', a => { a.studentAfter.openingBalance = { ...a.studentAfter.openingBalance, source: 'x' }; syncSnapshots(a); }],
    ['the opening amount differs from the payload', a => { a.studentAfter.openingBalance = { ...a.studentAfter.openingBalance, amount: 70 }; a.studentAfter.currentBalance = 220; syncSnapshots(a); }],
    ['the opening note differs from the payload', a => { a.studentAfter.openingBalance = { ...a.studentAfter.openingBalance, note: 'other' }; syncSnapshots(a); }],
    ['the balance is not adjusted', a => { a.studentAfter.currentBalance = a.studentBefore.currentBalance; syncSnapshots(a); }],
    ['the balance is adjusted twice', a => { a.studentAfter.currentBalance -= 20; syncSnapshots(a); }],
    ['the balance is reset to the new opening', a => { a.studentAfter.currentBalance = 80; syncSnapshots(a); }],
    ['the student status changes in the same write', a => { a.studentAfter.status = 'inactive'; syncSnapshots(a); }],
    ['the student name changes in the same write', a => { a.studentAfter.displayName = 'Renamed'; syncSnapshots(a); }],
    ['the student revision is not advanced', a => { a.studentAfter.revision = a.studentBefore.revision; syncSnapshots(a); }],
    ['the day totals change', a => { a.dayAfter.totals = { ...a.dayAfter.totals, retainedReceipts: 220 }; syncSnapshots(a); }],
    ['the day opening cash changes', a => { a.dayAfter.openingCash = 480; syncSnapshots(a); }],
    ['the day status changes', a => { a.dayAfter.status = 'closed'; syncSnapshots(a); }],
    ['the day revision is not advanced', a => { a.dayAfter.revision = a.dayBefore.revision; syncSnapshots(a); }],
    ['the cash effect is not zero', a => { a.command.cashEffect = { before: 0, after: -20, delta: -20, reasonKind: 'correction', refundAmount: 0 }; }],
    ['the command reason is null', a => { a.command.reason = null; }],
    ['the command reason differs from the payload', a => { a.command.reason = 'different'; }],
    ['the payload reason is empty', a => { a.command.payload = { ...a.command.payload, reason: '' }; a.command.reason = ''; }],
    ['the payload gains an extra key', a => { a.command.payload = { ...a.command.payload, asOfDate: today }; }],
    ['the payload note is too long', a => {
      const note = 'x'.repeat(501);
      a.command.payload = { ...a.command.payload, note };
      a.studentAfter.openingBalance = { ...a.studentAfter.openingBalance, note };
      syncSnapshots(a);
    }],
    ['the business date is not the opening date', a => { a.command.businessDate = today; }],
    ['the command claims another student', a => { a.command.studentId = studentB; }],
    ['the targets name another day', a => { a.command.targets = { ...a.command.targets, dayId: today }; }],
    ['the targets drop the day', a => { a.command.targets = { studentId: a.studentId }; }],
    ['the expected student revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, student: 1 }; }],
    ['the expected day revision is stale', a => { a.command.expectedRevisions = { ...a.command.expectedRevisions, day: 1 }; }],
    ['the before-snapshot lies about the old opening', a => {
      a.command.before = { ...a.command.before, student: { ...a.studentBefore, openingBalance: { ...a.studentBefore.openingBalance, amount: 60 } } };
    }],
    ['the opening does not change at all', a => {
      a.command.payload = { ...a.command.payload, amount: a.studentBefore.openingBalance.amount };
      a.studentAfter.openingBalance = { ...a.studentBefore.openingBalance };
      a.studentAfter.currentBalance = a.studentBefore.currentBalance;
      syncSnapshots(a);
    }],
    ['the before-snapshot gains an extra projection', a => { a.command.before = { ...a.command.before, transaction: null }; }],
    ['the after-snapshot gains an extra projection', a => { a.command.after = { ...a.command.after, transaction: null }; }],
    ['the after-snapshot lies about the new balance', a => {
      a.command.after = { ...a.command.after, student: { ...a.studentAfter, currentBalance: 999 } };
    }],
  ])('P10b.9 (F3): a raw SDK correction is denied atomically when %s', async (_label, attack) => {
    const raw = await rawCorrection(studentA, { amount: 80 });
    attack(raw);
    await expectRawDenied(raw);
  });

  it('P10b.10: a raw closure cannot skip the student or day write, and nothing changes the opening without CorrectOpening', async () => {
    await expectRawDenied(await rawCorrection(studentA, { amount: 80 }), { omitStudent: true });
    await expectRawDenied(await rawCorrection(studentA, { amount: 80 }), { omitDay: true });
    // A raw closure on a day other than the opening date is refused: the asOfDate stays the anchor.
    await withAdmin(async db => setDoc(doc(db, `days/${today}`), dayDoc(today)));
    const elsewhere = await rawCorrection(studentA, { amount: 80 });
    const todayBefore = (await read(`days/${today}`))!;
    elsewhere.dayId = today;
    elsewhere.dayBefore = todayBefore;
    elsewhere.dayAfter = { ...todayBefore, revision: todayBefore.revision + 1, lastCommandId: elsewhere.commandId, updatedAt: serverTimestamp() };
    elsewhere.command.targets = { studentId: studentA, dayId: today };
    elsewhere.command.businessDate = today;
    elsewhere.command.expectedRevisions = { student: elsewhere.studentBefore.revision, day: todayBefore.revision };
    syncSnapshots(elsewhere);
    await expectRawDenied(elsewhere);

    // A second day with identical content cannot ride along on the same command.
    const twinDate = shiftDate(openingDate, 1);
    await withAdmin(async adminDb => setDoc(doc(adminDb, `days/${twinDate}`), (await getDoc(doc(adminDb, `days/${openingDate}`))).data()!));
    const twin = await rawCorrection(studentA, { amount: 80 });
    const twinBefore = await state();
    const twinDb = authedDb(operatorA);
    const twinBatch = rawBatch(twinDb, twin);
    twinBatch.update(doc(twinDb, `days/${twinDate}`), twin.dayAfter);
    await assertFails(twinBatch.commit());
    expect(await state()).toEqual(twinBefore);
    expect(await read(`days/${twinDate}`)).toEqual(await read(`days/${openingDate}`));

    // An EditStudent closure that also rewrites the opening is refused by the student rule.
    const before = await state();
    const db = authedDb(operatorA);
    const commandId = uuid();
    const studentBefore = before.studentA as RawMap;
    const input = {
      commandId, kind: 'EditStudent' as const, leaseEpoch: 1, targets: { studentId: studentA },
      expectedRevisions: { student: studentBefore.revision }, payload: { displayName: 'Renamed' },
    };
    const headAfter = { ...before.head, seq: before.head!.seq + 1, lastCommandId: commandId, updatedAt: serverTimestamp() };
    const studentAfter = {
      ...studentBefore, displayName: 'Renamed', openingBalance: { ...studentBefore.openingBalance, amount: 80 },
      currentBalance: 230, revision: studentBefore.revision + 1, lastCommandId: commandId, updatedAt: serverTimestamp(),
    };
    const batch = writeBatch(db);
    batch.update(doc(db, 'system/dataHead'), headAfter);
    batch.update(doc(db, `students/${studentA}`), studentAfter);
    batch.set(doc(db, `commands/${commandId}`), {
      commandId, kind: 'EditStudent', seq: before.head!.seq + 1, leaseEpoch: 1,
      actor: { uid: operatorA.uid, email: operatorA.email }, committedAt: serverTimestamp(),
      businessDate: null, studentId: studentA, targets: input.targets, expectedRevisions: input.expectedRevisions,
      before: { head: before.head, student: studentBefore }, after: { head: headAfter, student: studentAfter },
      reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload: input.payload, inputFingerprint: await fingerprintCommandInput(normalizeEnabledCommandInput(input)),
    });
    await assertFails(batch.commit());
    expect(await state()).toEqual(before);
  });

  it('P10b.11: an opening cannot be rewritten by a direct student update, even by the holder', async () => {
    const db = authedDb(operatorA);
    const before = await state();
    await assertFails(updateDoc(doc(db, `students/${studentA}`), {
      openingBalance: { ...before.studentA!.openingBalance, amount: 80 }, currentBalance: 230,
      revision: before.studentA!.revision + 1, updatedAt: serverTimestamp(),
    }));
    expect(await state()).toEqual(before);
  });
});
