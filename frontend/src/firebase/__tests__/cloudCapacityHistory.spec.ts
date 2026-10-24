// @ts-expect-error Node-only file access loads the real Rules, the checked-in cost table and the page sizes.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, doc, getDoc, getDocs, query, setDoc, where, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LEDGER_WINDOW_DAYS } from '../../maintenance/capacityGate';
import { readAuthorizationCalls, type CostTable, type Linear } from '../../maintenance/capacityModel';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository, createCloudLedgerReader } from '../cloudDayCloseRepository';
import { createCloudDayVendorRepository } from '../cloudDayVendorRepository';
import { createCloudOrderRepository } from '../cloudOrderRepository';
import { createCloudReadRepository } from '../cloudReadRepository';
import { meter } from './helpers/firestoreMeter';
import { today } from './helpers/kindScenario';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, shiftDay, uuid } from './helpers/r02Scenario';

/**
 * P16e history scale (plan P16e item 1; run locally with `npm run capacity:history`, not in CI: it writes thousands of commands).
 * The P16d table prices a load per unit of each dimension from fixtures of a few dozen units; the two-year gate extrapolates
 * those prices to 730 closed days, a student of 500 transactions and a day of 500 transactions. This spec builds those sizes with
 * the production writer on the real Rules and measures the loads at production page sizes, so that the extrapolation is checked
 * against a measurement of the full size: the table must not price a load below what it cost (that would hide cost from the
 * gate; the run noise of 4 is allowed), nor more than 25 % (plus 30, for the pages of the fixed part, which are priced conservatively) above it (that would mean
 * the fit is far from the truth).
 * `EASYORDER_P16_HISTORY_DAYS` sets the closed days (730), `EASYORDER_P16_HISTORY_TX` the transactions of the student and of the day (500).
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
const enabled = process.env.EASYORDER_P16_HISTORY === 'true';
const describeWithEmulator = emulatorHost && enabled ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');
const DAYS = Number(process.env.EASYORDER_P16_HISTORY_DAYS ?? 730);
const TRANSACTIONS = Number(process.env.EASYORDER_P16_HISTORY_TX ?? 500);
const reportPath = process.env.EASYORDER_P16_HISTORY_REPORT;
const costs = JSON.parse(readFileSync(`${process.cwd()}/../docs/ops/p16-capacity-costs.json`, 'utf8') as string) as CostTable;

const OP = R02_OPERATOR;
/** The run noise of the P16d fit (`loadFit.ts`): reads of the settlement that a scan after a settlement command also reads. */
const NOISE = 4;
const studentS = uuid(970_000);
const studentT = uuid(970_001);
const vendorId = uuid(970_500);
const closedDay = (index: number) => shiftDay(today, -3 - index);
const versionDay = shiftDay(today, -2);
// older than every closed day, so that it does not take part in any day's alignment
const historyDay = shiftDay(today, -DAYS - 5);

let env: RulesTestEnvironment;
let app: Firestore;
let nextId = 50_000;
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
const countOf = (path: string) => admin(async db => (await getDocs(collection(db, path))).size);

/** The table's price of a load at the units given: client reads and Rules authorization calls. */
function priced(name: string, units: Record<string, number>): { reads: number; authorization: number } {
  const operation = costs.operations[name]!;
  const at = (linear: Linear) => linear.fixed + Object.entries(linear.perUnit).reduce((sum, [dimension, perUnit]) => sum + perUnit * (units[dimension] ?? 0), 0);
  return { reads: at(operation.reads), authorization: at(operation.readAuthorization) };
}

describeWithEmulator('P16e history scale: the table against the full size', () => {
  const user = operatorUser();
  const current = { currentUser: () => user };
  const results: Array<Record<string, unknown>> = [];
  let writer: ReturnType<typeof createCloudCommandRepository>;
  let closing: ReturnType<typeof createCloudDayCloseRepository>;
  let orders: ReturnType<typeof createCloudOrderRepository>;
  /** The lease lasts five minutes: renew it, as the heartbeat does, before every write of this long run. */
  const touchLease = () => admin(async db => { await setDoc(doc(db, 'system/accessLease'), { holderUid: OP.uid, epoch, updatedAt: Timestamp.now() }); });
  const ok = (result: { ok: boolean }, label: string) => { if (!result.ok) throw new Error(`P16e history: ${label} failed ${JSON.stringify(result)}`); };

  const commit = async (kind: 'EnsureDay' | 'BackfillOpeningCash' | 'StartBackfill', dayId: string, payload: Record<string, unknown>) => {
    await touchLease();
    const day = kind === 'EnsureDay' ? 0 : (await read(`days/${dayId}`)).revision;
    if (kind === 'BackfillOpeningCash') {
      ok(await closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId, expectedDayRevision: day, openingCash: 1000, reason: 'P16e fixture' }), kind);
      return;
    }
    ok(await writer.commitCommand({ commandId: id(), kind, leaseEpoch: epoch, targets: { dayId }, expectedRevisions: { day }, payload } as never), kind);
  };
  const closeBackfilled = async (dayId: string, alignWithDayId: string) => {
    await touchLease();
    const day = await read(`days/${dayId}`);
    const expected = (await closing.read(dayId))!.expectedCash!;
    ok(await closing.closeDay({ commandId: id(), leaseEpoch: epoch, dayId, expectedDayRevision: day.revision,
      expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected, note: '', alignWithDayId }), 'CloseDay');
  };
  const openBackfill = async (dayId: string) => {
    await commit('EnsureDay', dayId, { businessDate: dayId });
    await commit('BackfillOpeningCash', dayId, {});
    await commit('StartBackfill', dayId, { reason: 'P16e fixture' });
  };
  const order = async (studentId: string, dayId: string, note: string) => {
    await touchLease();
    const student = (await read(`students/${studentId}`)).revision;
    const day = (await read(`days/${dayId}`)).revision;
    ok(await orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId, dayId,
      expectedStudentRevision: student, expectedDayRevision: day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
      menuRevision: null, otherItemName: 'x', note }), 'CreateOrder');
  };
  /** One run of a load at production page sizes: client reads and authorization calls. */
  const measure = async (name: string, units: Record<string, number>, run: () => Promise<unknown>, only = true, alsoPriced: string[] = []) => {
    meter.start(only ? app : undefined);
    await run();
    const report = meter.stop();
    localStorage.clear();
    const auth = readAuthorizationCalls(report.reads);
    const measured = { reads: report.billedReads, authorization: auth.documents + auth.queries };
    const parts = [priced(name, units), ...alsoPriced.map(other => priced(other, {}))];
    const model = { reads: parts.reduce((sum, part) => sum + part.reads, 0), authorization: parts.reduce((sum, part) => sum + part.authorization, 0) };
    const byKey: Record<string, number> = {};
    for (const event of report.reads) byKey[`${event.form} ${event.key}`] = (byKey[`${event.form} ${event.key}`] ?? 0) + event.billed;
    results.push({ load: name, units, measured, model, byKey });
    // the table must not price below what the load cost (but for the run noise of a few reads: a scan that follows a settlement
    // also reads it), and not far above it
    expect(model.reads, `${name} client reads: model ${model.reads} vs measured ${measured.reads}`).toBeGreaterThanOrEqual(measured.reads - NOISE);
    expect(model.reads, `${name} client reads are within 25 %`).toBeLessThanOrEqual(measured.reads * 1.25 + 30);
    expect(model.authorization, `${name} authorization: model ${model.authorization} vs measured ${measured.authorization}`).toBeGreaterThanOrEqual(measured.authorization - NOISE);
    expect(model.authorization, `${name} authorization is within 25 %`).toBeLessThanOrEqual(measured.authorization * 1.25 + 30);
  };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(`${process.cwd()}/../firestore.rules`, 'utf8') },
    });
    await seedEmptySource(env, 'anonymous-p16e-history');
    await admin(async db => { await setDoc(doc(db, 'system/dataHead'), { goLiveDate: '2024-01-01' }, { merge: true }); });
    await admin(async db => { await setDoc(doc(db, 'system/accessLease'), { holderUid: OP.uid, epoch, updatedAt: Timestamp.now() }); });
    app = dbFor(OP);
    writer = createCloudCommandRepository(app, current);
    closing = createCloudDayCloseRepository(app, current);
    orders = createCloudOrderRepository(app, current);
    await commit('EnsureDay', today, { businessDate: today });
    ok(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: (await read(`days/${today}`)).revision }, payload: { openingCash: 1000, reason: 'P16e fixture' } }), 'SetOpeningCash');
    for (const [index, studentId] of [studentS, studentT].entries()) {
      ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: epoch, targets: { studentId },
        expectedRevisions: { student: 0 }, payload: { studentCode: String(860_000 + index), displayName: `P16e student ${index}`, aliases: [], openingBalance: { amount: 0, asOfDate: '2024-01-01', note: '' } } }), 'CreateStudent');
    }
    ok(await writer.commitCommand({ commandId: id(), kind: 'SaveVendor', leaseEpoch: epoch, targets: { vendorId }, expectedRevisions: { vendor: 0 },
      payload: { vendorId, name: 'P16e vendor', phone: '', note: '', status: 'active' } }), 'SaveVendor');
    // the oldest day stays open as a back-filled day for the student's history; the day before today is the newest closed day
    await openBackfill(historyDay);
    await openBackfill(versionDay);
    await closeBackfilled(versionDay, today);
  }, 300_000);
  afterAll(async () => {
    if (reportPath) writeFileSync(reportPath, `${JSON.stringify({ days: DAYS, transactions: TRANSACTIONS, results }, null, 2)}\n`);
    await env.cleanup();
  });

  it(`builds ${DAYS} closed days (back-filled, each closed and aligned with the next)`, async () => {
    for (let index = 0; index < DAYS; index += 1) {
      await openBackfill(closedDay(index));
      await closeBackfilled(closedDay(index), index === 0 ? versionDay : closedDay(index - 1));
    }
    expect(await countOf('days')).toBeGreaterThanOrEqual(DAYS);
  }, 6 * 60 * 60_000);

  it(`measures the loads that grow with closed days at ${DAYS} days`, async () => {
    const students = await countOf('students');
    // the unclosed past day is the one the student's history is on; closedDay counts the days this fixture closed in a row
    const unclosed = 1;
    const closedDays = DAYS;
    // the first scan of a page that has just started (a Firestore instance of its own: nothing cached), then the same page again
    // P16f2 S3: the scan reads the last 62 days and the days still open, so of the 730 closed days it counts the 62 of the window
    const scanned = Math.min(closedDays, LEDGER_WINDOW_DAYS);
    await measure('load.ledgerScanCold', { closedDay: scanned, openDay: unclosed }, () => createCloudLedgerReader(dbFor(OP), current).read(), false, ['load.ledgerLookup']);
    const warm = createCloudLedgerReader(app, current);
    await warm.read();
    await measure('load.ledgerScan', { closedDay: scanned, openDay: unclosed }, () => warm.read(), true, ['load.ledgerLookup']);
    // none of this fixture's days has a menu, so the vendors page scans every closed day here (the worst case the table covers; with
    // a menu in the first 32-day window the gate counts 32)
    await measure('load.dayVendors', { vendor: 1, closedDay: closedDays, openDay: unclosed }, () => createCloudDayVendorRepository(app, current).loadSnapshot());
    await measure('load.orders', { student: students, dayTransaction: 0, openDay: unclosed }, () => orders.loadSnapshot());
    await measure('load.dayCloseOverview', { openDay: unclosed }, () => closing.readOverview());
  }, 600_000);

  it(`builds a student with ${TRANSACTIONS} transactions on another day, and measures the loads of the student`, async () => {
    for (let index = 0; index < TRANSACTIONS; index += 1) await order(studentS, historyDay, `紙本P16E-${index}：x`);
    const reads = createCloudReadRepository(app, current);
    const onToday = { kind: 'today' as const, startDate: today, endDate: today };
    // P16f1: the history of one account reads that student's transactions of the range (none yet: the TRANSACTIONS orders are on another
    // day) and the audit of a student reads the newest page of 100 commands, whatever the length of the history
    await measure('load.accountHistory', { student: await countOf('students'), dayTransaction: 0, studentTransaction: 0, studentRangeTransaction: 0 }, () => reads.readAccountHistory({ range: onToday, studentId: studentS, leaseEpoch: epoch }));
    await measure('load.auditStudent', { studentTransaction: Math.min(TRANSACTIONS, 100) }, () => reads.readAudit({ studentId: studentS, leaseEpoch: epoch }));
  }, 6 * 60 * 60_000);

  it(`builds a day with ${TRANSACTIONS} transactions, and measures the loads of the day`, async () => {
    for (let index = 0; index < TRANSACTIONS; index += 1) await order(studentT, today, '');
    const reads = createCloudReadRepository(app, current);
    const onToday = { kind: 'today' as const, startDate: today, endDate: today };
    const students = await countOf('students');
    await measure('load.orders', { student: students, dayTransaction: TRANSACTIONS, openDay: 1 }, () => orders.loadSnapshot());
    // the commands dated today that are no orders: the day's opening and its opening cash
    const commandsToday = await admin(async db => (await getDocs(query(collection(db, 'commands'), where('businessDate', '==', today)))).size);
    await measure('load.auditDay', { dayTransaction: TRANSACTIONS, dayCommand: commandsToday - TRANSACTIONS }, () => reads.readAudit({ dayId: today, leaseEpoch: epoch }));
    // P16f1: the report reads the transactions of the range and, for the accounts of the range, nothing before it (the balances are worked
    // back from currentBalance): studentT (the day's orders) and, with one order of today, studentS (its TRANSACTIONS orders of the history
    // day are outside the range) are two accounts; the report of one student reads that student's transactions of the range only
    await order(studentS, today, '');
    const inRange = TRANSACTIONS + 1;
    await measure('load.report', { student: students, rangeAccount: 2, dayTransaction: inRange - 2, studentTransaction: 0 }, () => reads.readReport({ range: onToday, studentId: null, leaseEpoch: epoch }));
    await measure('load.reportStudent', { student: students, dayTransaction: 0, studentTransaction: 0, studentRangeTransaction: 0 }, () => reads.readReport({ range: onToday, studentId: studentS, leaseEpoch: epoch }));
    // every command of the student was committed today in this fixture, so the newest-first read stops only at the first one: all of them
    await measure('load.auditRangeStudent', { studentTransaction: TRANSACTIONS + 1 }, () => reads.readAuditRange({ range: onToday, studentId: studentS, leaseEpoch: epoch }));
  }, 6 * 60 * 60_000);
});
