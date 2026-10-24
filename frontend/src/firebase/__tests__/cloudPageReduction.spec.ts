// @ts-expect-error Node-only file access loads the real Rules.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../cloudOrderRepository';
import { createCloudReadRepository } from '../cloudReadRepository';
import { meter } from './helpers/firestoreMeter';
import { today } from './helpers/kindScenario';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, shiftDay, uuid } from './helpers/r02Scenario';

/**
 * P16f2 page-level reductions on the production repositories and the real Rules (plan P16f §2 S4, S13): what the orders page
 * reads after one of its own commands, and what a summary reads for a range of days. The orders page used to reload the
 * roster and every transaction of the day after each command (about 340 reads of the 7 that changed).
 */
vi.mock('firebase/firestore', async importOriginal => {
  const { wrapFirestoreMeterModule } = await import('./helpers/firestoreMeter');
  return wrapFirestoreMeterModule(await importOriginal<typeof import('firebase/firestore')>());
});
vi.mock('firebase/firestore/lite', async importOriginal => {
  const { wrapFirestoreLiteMeterModule } = await import('./helpers/firestoreMeter');
  return wrapFirestoreLiteMeterModule(await importOriginal<typeof import('firebase/firestore/lite')>());
});

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_CAPACITY === 'true';
if (required && !emulatorHost) throw new Error('P16f2 page reduction requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');

const OP = R02_OPERATOR;
const STUDENTS = 12;
const ORDERS = 30;
/** The head and lease fences, the day, the transaction, the student: what a refresh may read. */
const REFRESH_READS = 10;
const students = Array.from({ length: STUDENTS }, (_item, index) => uuid(990_000 + index));

let env: RulesTestEnvironment;
let nextId = 70_000;
const id = () => uuid(++nextId);
const epoch = R02_LEASE_EPOCH;

function dbFor(identity: { uid: string; email: string }): Firestore {
  return env.authenticatedContext(identity.uid, {
    email: identity.email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}
async function admin<T>(run: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async context => { result = await run(context.firestore() as unknown as Firestore); });
  return result;
}
const read = async (path: string) => (await admin(async db => (await getDoc(doc(db, path))).data())) as Record<string, number & string>;

describeWithEmulator('P16f2 page reduction: the orders page after a command, and the summary of a range', () => {
  const user = operatorUser();
  const current = { currentUser: () => user };
  let app: Firestore;
  let writer: ReturnType<typeof createCloudCommandRepository>;
  let orders: ReturnType<typeof createCloudOrderRepository>;
  let closing: ReturnType<typeof createCloudDayCloseRepository>;
  let reads: ReturnType<typeof createCloudReadRepository>;
  let studentCursor = 0;

  const ok = (result: CommandResult, label: string): CommandReceipt => {
    if (!result.ok) throw new Error(`P16f2 scenario: ${label} failed ${JSON.stringify(result)}`);
    return result.receipt;
  };
  const touchLease = () => admin(async db => { await setDoc(doc(db, 'system/accessLease'), { holderUid: OP.uid, epoch, updatedAt: Timestamp.now() }); });
  const revisions = async (studentId: string, dayId: string) => ({ student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${dayId}`)).revision });
  const nextStudent = () => students[studentCursor++ % STUDENTS]!;
  const createOrder = async (studentId = nextStudent()) => {
    const rev = await revisions(studentId, today);
    const transactionId = id();
    return { studentId, transactionId, receipt: ok(await orders.createOrder({ commandId: id(), transactionId, leaseEpoch: epoch, studentId, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100, menuRevision: null, otherItemName: 'x', note: '' }), 'CreateOrder') };
  };
  const mutate = async (transactionId: string, studentId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => {
    const tx = await read(`transactions/${transactionId}`);
    return ok(await orders.mutateTransaction({ commandId: id(), leaseEpoch: epoch, transactionId, studentId, dayId: today,
      expectedTransactionRevision: tx.revision, expectedStudentRevision: studentId === '__cashier__' ? null : (await read(`students/${studentId}`)).revision,
      expectedDayRevision: (await read(`days/${today}`)).revision, ...spec } as CloudTransactionMutationInput), spec.kind);
  };
  /** Runs `command` after a snapshot, then measures the refresh with its receipt and compares it with a full reload. */
  const refreshAfter = async (command: () => Promise<CommandReceipt>) => {
    await touchLease();
    const before = await orders.loadSnapshot();
    const receipt = await command();
    const { result: refreshed, report } = await meter.measure(() => orders.refreshSnapshot(before, receipt), app);
    localStorage.clear();
    const full = await orders.loadSnapshot();
    expect(refreshed).not.toBeNull();
    expect(refreshed).toEqual(full);
    expect(report.billedReads, 'reads of a refresh').toBeLessThanOrEqual(REFRESH_READS);
    return { report, full };
  };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(`${process.cwd()}/../firestore.rules`, 'utf8') },
    });
    await seedEmptySource(env, 'anonymous-p16f2-pages');
    await admin(async db => { await setDoc(doc(db, 'system/dataHead'), { goLiveDate: '2025-01-01' }, { merge: true }); });
    app = dbFor(OP);
    writer = createCloudCommandRepository(app, current);
    orders = createCloudOrderRepository(app, current);
    closing = createCloudDayCloseRepository(app, current);
    reads = createCloudReadRepository(app, current);

    ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: 0 }, payload: { businessDate: today } }), 'EnsureDay');
    ok(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: (await read(`days/${today}`)).revision }, payload: { openingCash: 1000, reason: 'P16f2 fixture' } }), 'SetOpeningCash');
    for (const [index, studentId] of students.entries()) {
      ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: epoch, targets: { studentId },
        expectedRevisions: { student: 0 }, payload: { studentCode: String(870_000 + index), displayName: `P16f2 student ${index}`, aliases: [],
          openingBalance: { amount: 500, asOfDate: '2025-01-01', note: '' } } }), 'CreateStudent');
    }
    for (let index = 0; index < ORDERS; index += 1) await createOrder();
  }, 300_000);

  afterAll(async () => { await env?.cleanup(); });

  it('refreshes after an order with the student, the day and the transaction only, and equals a full reload', async () => {
    const { full } = await refreshAfter(async () => (await createOrder()).receipt);
    expect(full.transactions.length).toBeGreaterThan(ORDERS);
  });

  it('refreshes after a payment, a cash movement and a refund', async () => {
    await refreshAfter(async () => {
      const studentId = nextStudent();
      const rev = await revisions(studentId, today);
      return ok(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId, dayId: today,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, paidAmount: 30, note: '' }), 'CreatePayment');
    });
    await refreshAfter(async () => ok(await orders.createCashMovement({ commandId: id(), transactionId: id(), leaseEpoch: epoch, dayId: today,
      expectedDayRevision: (await read(`days/${today}`)).revision, direction: 'expense', amount: 7, reason: 'P16f2 fixture' }), 'CreateCashMovement'));
    await refreshAfter(async () => {
      const studentId = nextStudent();
      const rev = await revisions(studentId, today);
      return ok(await orders.createRefund({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId, dayId: today,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, amount: 5, reason: 'P16f2 fixture' }), 'CreateRefund');
    });
  });

  it('refreshes after a void, a correction and an undo of a transaction that is already on the page', async () => {
    const first = await createOrder();
    await refreshAfter(() => mutate(first.transactionId, first.studentId, { kind: 'VoidTransaction', payload: { reason: 'P16f2 fixture' } }));
    const second = await createOrder();
    await refreshAfter(() => mutate(second.transactionId, second.studentId, {
      kind: 'Undo', payload: { targetCommandId: second.receipt.commandId, reason: '送出後立即撤回' } }));
  });

  it('gives up (null, the page reloads) when the sequence is not the next one or the head has moved since the receipt', async () => {
    await touchLease();
    const before = await orders.loadSnapshot();
    const first = await createOrder();
    const second = await createOrder();
    // two commands since the snapshot: neither receipt is the one after it
    expect(await orders.refreshSnapshot(before, first.receipt)).toBeNull();
    expect(await orders.refreshSnapshot(before, second.receipt)).toBeNull();
    // the head has moved on after a receipt that was the next one
    const next = await orders.loadSnapshot();
    const third = await createOrder();
    await createOrder();
    expect(await orders.refreshSnapshot(next, third.receipt)).toBeNull();
  });

  it('gives up when the receipt belongs to another day than the snapshot shows', async () => {
    await touchLease();
    const before = await orders.loadSnapshot();
    const placed = await createOrder();
    const elsewhere = { ...placed.receipt, targets: { ...placed.receipt.targets, dayId: shiftDay(today, -1) } };
    expect(await orders.refreshSnapshot(before, elsewhere)).toBeNull();
  });

  it('reads the summary of a week for the days and their latest settlement only', async () => {
    const days = Array.from({ length: 7 }, (_item, index) => shiftDay(today, -(index + 1)));
    // three of them are back-filled and closed, each with a reopened-and-closed history
    for (const [index, dayId] of days.slice(0, 3).entries()) {
      await touchLease();
      ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch, targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId } }), 'EnsureDay');
      ok(await closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId, expectedDayRevision: (await read(`days/${dayId}`)).revision, openingCash: 1000, reason: 'P16f2 fixture' }), 'BackfillOpeningCash');
      ok(await writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: epoch, targets: { dayId },
        expectedRevisions: { day: (await read(`days/${dayId}`)).revision }, payload: { reason: 'P16f2 fixture' } }), 'StartBackfill');
      const day = await read(`days/${dayId}`);
      const expected = (await closing.read(dayId))!.expectedCash!;
      ok(await closing.closeDay({ commandId: id(), leaseEpoch: epoch, dayId, expectedDayRevision: day.revision,
        expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected, note: '', alignWithDayId: index === 0 ? today : days[index - 1]! }), 'CloseDay');
    }
    await touchLease();
    const range = { kind: 'custom' as const, startDate: days.at(-1)!, endDate: days[0]! };
    const { result: summary, report } = await meter.measure(() => reads.readSummary({ range, leaseEpoch: epoch }), app);
    localStorage.clear();
    expect(summary.days).toHaveLength(7);
    expect(summary.days.filter(day => day.status === 'closed')).toHaveLength(3);
    // a day and its latest settlement: two reads a closed day, one a day that does not exist, and the fixed part
    expect(report.billedReads).toBeLessThanOrEqual(7 * 2 + 10);
  });
});
