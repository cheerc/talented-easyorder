// @ts-expect-error Node-only file access loads the real Rules, the checked-in cost table and the repositories' page-size constants.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp, collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALL_COMMAND_KINDS, type BusinessCommandKind } from '../../domain/cloudCommands';
import { readAuthorizationCalls, type CostTable, type OperationCost, type RulesKindCost } from '../../maintenance/capacityModel';
import { fitLoad, type FitPhase, type FitSample, type FitState } from '../../maintenance/loadFit';
import { acquireLease, getLeaseStatus, releaseLease, renewLease, subscribeLease } from '../activeAccountLease';
import { createCloudBackupCommandRepository } from '../cloudBackupCommandRepository';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository, createCloudLedgerReader } from '../cloudDayCloseRepository';
import { createCloudDayVendorRepository } from '../cloudDayVendorRepository';
import { createCloudOrderRepository } from '../cloudOrderRepository';
import { createCloudReadRepository } from '../cloudReadRepository';
import { createCloudReportActionRepository } from '../cloudReportActionRepository';
import { listCloudStudents } from '../cloudStudentRepository';
import { buildKindSteps, today, type KindScenarioDeps } from './helpers/kindScenario';
import { meter, type MeterReport } from './helpers/firestoreMeter';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, shiftDay, uuid } from './helpers/r02Scenario';

/**
 * P16d: what every operation costs in Firestore reads and writes, measured at the SDK boundary on the real Rules and the real
 * production repositories (plan R8, R14). The 27 command kinds run the same steps as the P16b matrix; the lease operations run
 * the production lease functions. The loads that grow with history run on a fixture that grows one dimension at a time
 * (students, vendors, orders of the day, ..., each in its own phase while the others stay constant), so that a load's cost is
 * attributed to the collection that causes it (`maintenance/loadFit.ts`). The result is compared with the checked-in
 * `docs/ops/p16-capacity-costs.json`: a change of cost has to change the table in the same PR.
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
if (required && !emulatorHost) throw new Error('P16d capacity gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');
const reportPath = process.env.EASYORDER_P16_REPORT;
/** Where to write the table this run measured (to regenerate the checked-in file); unset in CI. */
const writeCostsPath = process.env.EASYORDER_P16_WRITE_COSTS;
const costsFile = `${process.cwd()}/../docs/ops/p16-capacity-costs.json`;
/** Where to write the query shapes this run recorded; unset in CI. */
const writeShapesPath = process.env.EASYORDER_P16_WRITE_SHAPES;
const shapesFile = `${process.cwd()}/../docs/ops/p16-query-shapes.json`;

const OP = R02_OPERATOR;
const OTHER = { uid: 'p16d-other-operator', email: 'p16d-other@example.test', active: true };
/** Units a dimension grows by in one step of its phase; every phase has three steps. */
const STEP = 6;
const STEPS_PER_PHASE = 3;

let env: RulesTestEnvironment;
let app: Firestore;
let epoch = R02_LEASE_EPOCH;
let nextId = 20_000;
const id = () => uuid(++nextId);

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
const adminData = (path: string) => admin(async db => (await getDoc(doc(db, path))).data());
const adminCount = (path: string, ...constraints: Array<[string, '==', string | null]>) => admin(async db => (
  await getDocs(query(collection(db, path), ...constraints.map(([field, op, value]) => where(field, op, value))))).size);
const setBase = (patch: Record<string, unknown> = {}) => admin(async db => {
  await setDoc(doc(db, `operators/${OP.uid}`), { ...OP });
  await setDoc(doc(db, 'system/accessLease'), { holderUid: OP.uid, epoch, updatedAt: Timestamp.now(), ...patch });
});

// ---- what a measurement turns into -----------------------------------------------------------------------------------------

interface Measured {
  reads: number;
  authDocuments: number;
  authQueries: number;
  writes: number;
  deletes: number;
  readsByKey: Record<string, number>;
  writesByKey: Record<string, number>;
  queries: Array<{ collection: string; where: string[]; orderBy: string[]; limit: number | null; cursor: boolean; documents: number }>;
}

function summarize(report: MeterReport): Measured {
  const auth = readAuthorizationCalls(report.reads);
  const readsByKey: Record<string, number> = {};
  for (const event of report.reads) readsByKey[`${event.form} ${event.key}`] = (readsByKey[`${event.form} ${event.key}`] ?? 0) + event.billed;
  const writesByKey: Record<string, number> = {};
  for (const write of report.writes) writesByKey[`${write.kind} ${write.key}`] = (writesByKey[`${write.kind} ${write.key}`] ?? 0) + 1;
  return {
    reads: report.billedReads, authDocuments: auth.documents, authQueries: auth.queries,
    writes: report.billedWrites, deletes: report.billedDeletes, readsByKey, writesByKey,
    queries: report.reads.filter(event => event.form === 'query' && event.shape).map(event => ({ ...event.shape!, documents: event.documents })),
  };
}

const operations = new Map<string, OperationCost>();
const queryShapes = new Map<string, Measured['queries']>();

function fixedOperation(name: string, measured: Measured, extra: Partial<OperationCost> = {}): void {
  const auth = measured.authDocuments + measured.authQueries;
  operations.set(name, {
    reads: { fixed: measured.reads, perUnit: {} },
    readAuthorization: { fixed: auth, perUnit: {} },
    // A read request is authorized on its own (its two or fewer distinct documents), so nothing is shared between requests.
    readAuthorizationDeduped: { fixed: auth, perUnit: {} },
    writes: measured.writes, deletes: measured.deletes,
    ...extra,
    detail: { reads: measured.readsByKey, writes: measured.writesByKey },
  });
  if (measured.queries.length > 0) queryShapes.set(name, measured.queries);
}

// ---- the Rules commit closure of the commands and of the lease (the p05 ledger) --------------------------------------------

/**
 * Rules access calls of the commit request, no cache, per command kind, from `docs/ops/p05-rules-budget.md` (the appendix
 * named in `source`). A kind with no per-kind figure there gets the platform cap of 20 per request, which is an upper bound
 * because Firestore refuses a request over it. Distinct documents are derived from what the step wrote (below).
 */
const P05_COMMIT_ACCESS_CALLS: Record<BusinessCommandKind, { calls: number; source: string }> = {
  EnsureDay: { calls: 11, source: 'p05 EnsureDay 11/20' },
  SetDayMenu: { calls: 17, source: 'p05 P07 inherited menu 17/20 (direct vendor 14/20)' },
  SetOpeningCash: { calls: 11, source: 'p05 P07 11/20' },
  SaveVendor: { calls: 11, source: 'p05 P07 11/20' },
  RemoveVendor: { calls: 11, source: 'p05 P07 11/20' },
  CreateStudent: { calls: 15, source: 'p05 P06b 15/20' },
  ChangeStudentCode: { calls: 20, source: 'p05 P06b 20/20' },
  EditStudent: { calls: 11, source: 'p05 P06b 11/20' },
  SetStudentStatus: { calls: 11, source: 'p05 P06b 11/20' },
  CorrectOpening: { calls: 15, source: 'p05 P10b 15/20' },
  CreateOrder: { calls: 19, source: 'p05 P05 19/20' },
  CreatePayment: { calls: 19, source: 'p05 P05 19/20' },
  CreateCashMovement: { calls: 15, source: 'p05 P09a 15/20' },
  CreateRefund: { calls: 19, source: 'p05 P09b 19/20' },
  CorrectTransaction: { calls: 19, source: 'p05 P10a student row 19/20 (counter-cash row 15/20)' },
  VoidTransaction: { calls: 19, source: 'p05 P10a student row 19/20 (counter-cash row 15/20)' },
  CancelKeepDeposit: { calls: 19, source: 'p05 P10a student row 19/20' },
  CancelRefund: { calls: 19, source: 'p05 P10a student row 19/20' },
  Undo: { calls: 19, source: 'p05 P10a student row 19/20 (counter-cash row 15/20)' },
  CloseDay: { calls: 16, source: 'p05 P11c3 marked day with dated alignment 16/20 (ordinary day 15/20)' },
  ReopenDay: { calls: 16, source: 'p05 P11c3 same shape as CloseDay, 16/20 as the upper bound' },
  BackfillOpeningCash: { calls: 10, source: 'p05 P11b 10/20' },
  StartBackfill: { calls: 20, source: 'platform cap 20/20: p05 has no per-kind figure' },
  RecordPostCloseEntry: { calls: 11, source: 'p05 P11c4a 11/20' },
  RecordExport: { calls: 7, source: 'p05 P12b 7/20' },
  RecordPrint: { calls: 7, source: 'p05 P12b 7/20' },
  RecordBackup: { calls: 20, source: 'platform cap 20/20: p05 has no per-kind figure' },
};

/** Lease changes: operator `get` + `exists` + `existsAfter` on the update and 3 more on the event create; a renew reads the operator once (p05 P13c1). */
const LEASE_COMMIT: Record<'acquire' | 'takeover' | 'release' | 'renew', RulesKindCost> = {
  acquire: { commitAccessCalls: 6, commitDistinctDocuments: 3, source: 'p05 P13c1: lease update 3 + accessEvents create 3' },
  takeover: { commitAccessCalls: 6, commitDistinctDocuments: 3, source: 'p05 P13c1: lease update 3 + accessEvents create 3' },
  release: { commitAccessCalls: 6, commitDistinctDocuments: 3, source: 'p05 P13c1: lease update 3 + accessEvents create 3' },
  renew: { commitAccessCalls: 1, commitDistinctDocuments: 1, source: 'p05 P13c1: renew reads the operator once' },
};

// ---- fitting a load to a line ---------------------------------------------------------------------------------------------

/** The page-size constant of a repository, read from its source so that the table cannot drift from it. */
function pageSizeOf(file: string, name: string): number {
  const text = readFileSync(`${process.cwd()}/src/firebase/${file}`, 'utf8') as string;
  const found = new RegExp(`const ${name} = (\\d+);`).exec(text);
  if (!found) throw new Error(`P16d: ${file} has no constant ${name}`);
  return Number(found[1]);
}

// ---- the specification -----------------------------------------------------------------------------------------------------

describeWithEmulator('P16d capacity: reads and writes per operation, measured on the real Rules', () => {
  const user = operatorUser();
  const current = { currentUser: () => user };
  let writer: ReturnType<typeof createCloudCommandRepository>;
  let orders: ReturnType<typeof createCloudOrderRepository>;
  let closing: ReturnType<typeof createCloudDayCloseRepository>;
  let backups: ReturnType<typeof createCloudBackupRepository>;
  let backupReceipts: ReturnType<typeof createCloudBackupCommandRepository>;
  let reports: ReturnType<typeof createCloudReportActionRepository>;

  const ok = (result: { ok: boolean }, label: string) => {
    if (!result.ok) throw new Error(`P16d scenario: ${label} failed ${JSON.stringify(result)}`);
  };
  const read = async (path: string) => (await adminData(path)) as Record<string, number & string>;
  const headSeq = async () => (await read('system/dataHead')).seq as number;
  const revisions = async (studentId: string, dayId: string) => ({
    student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${dayId}`)).revision,
  });

  const buildRepositories = (pageSize?: number) => {
    const options = pageSize === undefined ? current : { ...current, pageSize };
    writer = createCloudCommandRepository(app, current);
    orders = createCloudOrderRepository(app, options);
    closing = createCloudDayCloseRepository(app, current);
    backups = createCloudBackupRepository(app, { currentUid: () => OP.uid, ...(pageSize === undefined ? {} : { pageSize }) });
    backupReceipts = createCloudBackupCommandRepository(app, current);
    reports = createCloudReportActionRepository(app, current);
  };

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(`${process.cwd()}/../firestore.rules`, 'utf8') },
    });
    await seedEmptySource(env, 'anonymous-p16d-capacity');
    app = dbFor(OP);
    buildRepositories();
  }, 180_000);
  afterAll(async () => { await env.cleanup(); });

  // ---- A. the 27 command kinds: one committed command each, through the same steps as the matrix ----
  describe('commands', () => {
    const deps: KindScenarioDeps = {
      get writer() { return writer; },
      get orders() { return orders; },
      get closing() { return closing; },
      get backups() { return backups; },
      get backupReceipts() { return backupReceipts; },
      get reports() { return reports; },
      get epoch() { return epoch; },
      backupPassword: 'p16d-capacity-password',
      read, id, ok, headSeq, revisions,
    };
    for (const step of buildKindSteps(deps)) {
      it(`command.${step.kind}`, async () => {
        await setBase();
        if (step.setup) await step.setup();
        const { result, report } = await meter.measure(step.run, app);
        localStorage.clear();
        ok(result as { ok: boolean }, `${step.kind}`);
        const measured = summarize(report);
        // The writes of a command are the command, the data head and its projections; the Rules touch each distinct document once.
        expect(measured.writesByKey[`set commands/*`], `${step.kind} writes one command`).toBe(1);
        expect(measured.writesByKey['update system/dataHead'], `${step.kind} advances the head`).toBe(1);
        fixedOperation(`command.${step.kind}`, measured);
      }, 180_000);
    }
  });

  // ---- B. the lease ----
  describe('lease', () => {
    it('acquire, renew, status, listener, release and takeover', async () => {
      const nextEpoch = async () => ((await read('system/accessLease')).epoch as number);
      // acquire: the lease is vacant
      await setBase({ holderUid: null });
      let at = await nextEpoch();
      let { result, report } = await meter.measure(() => acquireLease(app, OP.uid, at, OP.email), app);
      expect(result.status).toBe('acquired');
      fixedOperation('lease.acquire', summarize(report), { rulesCommit: LEASE_COMMIT.acquire });
      epoch = await nextEpoch();

      // renew
      ({ result, report } = await meter.measure(() => renewLease(app, OP.uid, epoch), app));
      expect(result.status).toBe('acquired');
      fixedOperation('lease.renew', summarize(report), { rulesCommit: LEASE_COMMIT.renew });

      // status (a plain server read of the lease)
      const status = await meter.measure(() => getLeaseStatus(app, OP.uid), app);
      fixedOperation('lease.status', summarize(status.report));

      // the lease listener: the initial snapshot, then one snapshot per renew of the holder (the leader page of the two pages)
      const seen: unknown[] = [];
      const stop = await meter.measure(async () => {
        const unsubscribe = subscribeLease(app, OP.uid, state => seen.push(state));
        const waitFor = async (count: number) => { for (let i = 0; i < 200 && seen.length < count; i += 1) await new Promise(resolve => setTimeout(resolve, 25)); };
        await waitFor(1);
        const first = seen.length;
        await renewLease(app, OP.uid, epoch);
        await waitFor(first + 1);
        unsubscribe();
        return { first, afterRenew: seen.length };
      }, app);
      expect(stop.result.first).toBeGreaterThanOrEqual(1);
      const listenerReads = stop.report.reads.filter(event => event.form === 'listener-doc').length;
      // one snapshot for the first state and one for the changed `updatedAt`; the renew's own reads are the renew's cost
      expect(listenerReads).toBe(2);
      const initialAndChange = summarize({ ...stop.report, reads: stop.report.reads.filter(event => event.form === 'listener-doc'), writes: [], billedReads: listenerReads, billedWrites: 0, billedDeletes: 0 });
      fixedOperation('lease.listenerSnapshot', { ...initialAndChange, reads: 1, authDocuments: 1, authQueries: 0, readsByKey: { 'listener-doc system/accessLease': 1 } });

      // release, then a takeover of a lease that another operator let expire
      ({ report } = await meter.measure(() => releaseLease(app, OP.uid, epoch, OP.email), app));
      fixedOperation('lease.release', summarize(report), { rulesCommit: LEASE_COMMIT.release });
      await admin(async db => { await setDoc(doc(db, `operators/${OTHER.uid}`), { ...OTHER }); });
      await setBase({ holderUid: OTHER.uid, updatedAt: Timestamp.fromMillis(Date.now() - 10 * 60_000), epoch: await nextEpoch() });
      at = await nextEpoch();
      ({ result, report } = await meter.measure(() => acquireLease(app, OP.uid, at, OP.email), app));
      expect(result.status).toBe('acquired');
      fixedOperation('lease.takeover', summarize(report), { rulesCommit: LEASE_COMMIT.takeover });
      epoch = await nextEpoch();
    }, 120_000);

    it('the operator document listener of the sign-in (authService.ts: one onSnapshot on operators/{uid})', async () => {
      const { report } = await meter.measure(async () => {
        let seen = false;
        const unsubscribe = onSnapshot(doc(app, `operators/${OP.uid}`), () => { seen = true; });
        for (let i = 0; i < 200 && !seen; i += 1) await new Promise(resolve => setTimeout(resolve, 25));
        unsubscribe();
        return seen;
      }, app);
      expect(report.billedReads).toBe(1);
      fixedOperation('listener.operatorDocument', summarize(report));
    });
  });

  // ---- C. loads that grow with history: the fixture grows one dimension at a time ----
  describe('loads', () => {
    // The fixture grows ten dimensions, each in its own phase (`phases` below). The `rangeAccount` phase adds an order of today by an account
    // that had none, so a step of it is one account of the range with one transaction in it (the report's cost of a new account, with
    // that transaction): its slope is the account's own cost plus that of a transaction of the range, which the gate takes into account.
    // The pool of accounts it draws from is created with the base, so that the roster does not grow in it. A load declares the dimensions it depends on;
    // `loadFit` rejects a load that changes with one it does not declare, so the declarations cannot be incomplete.
    const closedDay = (index: number) => shiftDay(today, -3 - index);
    const openPastDay = (index: number) => shiftDay(today, -60 - index);
    // studentS owns the history that spans other days (the `studentTransaction` dimension); studentT places today's orders (the
    // `dayTransaction` dimension), so that neither collection is counted for the other
    const studentS = uuid(950_000);
    const studentT = uuid(950_101);
    // a back-filled day that stays open: studentS's orders of other days go there
    const historyDay = shiftDay(today, -40);
    // the day with its own settlement versions is the newest closed day, so that the summary range always contains it
    const versionDay = shiftDay(today, -2);
    const onToday = { kind: 'today' as const, startDate: today, endDate: today };
    let studentsMade = 0;
    let vendorsMade = 0;
    let closedMade = 0;
    let openPastMade = 0;
    let historyMade = 0;
    // the students that exist before the phases start (studentS, studentT and the pool below), and the pool of accounts that the
    // `rangeAccount` phase brings into today's range one at a time (each with one order of today)
    const createdStudents: string[] = [];
    const POOL = STEPS_PER_PHASE * STEP;
    let rangeMade = 0;

    const create = async (label: string, run: () => Promise<{ ok: boolean }>) => ok(await run(), label);

    // ---- growing the fixture, one dimension ----
    const addStudent = async () => {
      const studentId = studentsMade === 0 ? studentS : uuid(950_100 + studentsMade);
      createdStudents.push(studentId);
      await create('CreateStudent', () => writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: epoch,
        targets: { studentId }, expectedRevisions: { student: 0 },
        payload: { studentCode: String(840_000 + studentsMade), displayName: `P16d student ${studentsMade}`, aliases: [], openingBalance: { amount: 0, asOfDate: '2025-01-01', note: '' } } }));
      studentsMade += 1;
    };
    const addVendor = async () => {
      const vendorId = uuid(950_500 + vendorsMade);
      await create('SaveVendor', () => writer.commitCommand({ commandId: id(), kind: 'SaveVendor', leaseEpoch: epoch,
        targets: { vendorId }, expectedRevisions: { vendor: 0 },
        payload: { vendorId, name: `P16d vendor ${vendorsMade}`, phone: '', note: '', status: 'active' } }));
      vendorsMade += 1;
    };
    const placeOrder = async (studentId: string, dayId: string, note: string) => {
      const rev = await revisions(studentId, dayId);
      await create('CreateOrder', () => orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId, dayId,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
        menuRevision: null, otherItemName: 'x', note }));
    };
    /** An order of today by studentT. */
    const addOrder = () => placeOrder(studentT, today, '');
    /** An order of today by studentS: a transaction of that student in the range of a report, an account history or an audit of today. */
    const addStudentTodayOrder = () => placeOrder(studentS, today, '');
    /** An order of today by an account that had none: a new account in the range of the report. */
    const addRangeAccount = async () => {
      await placeOrder(createdStudents[2 + rangeMade]!, today, '');
      rangeMade += 1;
    };
    /** An order of studentS on the back-filled history day (the Rules want the paper number as the prefix of its note). */
    const addStudentOrder = async () => {
      await placeOrder(studentS, historyDay, `紙本P16D-${historyMade}：x`);
      historyMade += 1;
    };
    /** A command dated today that is no transaction. */
    const addDayCommand = async () => {
      await create('RecordPrint', async () => reports.recordPrint({ commandId: id(), leaseEpoch: epoch, range: { kind: 'custom', startDate: today, endDate: today },
        scope: { studentId: null }, sourceSeq: await headSeq(), printType: 'ledger-original', businessDate: today }));
    };
    /** A back-filled day, opened and started. */
    const openBackfill = async (dayId: string) => {
      await create('EnsureDay', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
        targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId } }));
      await create('BackfillOpeningCash', async () => closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId,
        expectedDayRevision: (await read(`days/${dayId}`)).revision, openingCash: 1000, reason: 'P16d fixture' }));
      await create('StartBackfill', async () => writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: epoch,
        targets: { dayId }, expectedRevisions: { day: (await read(`days/${dayId}`)).revision }, payload: { reason: 'P16d fixture' } }));
    };
    /** A back-filled day, opened, started and closed; its close is aligned with the nearest later opened day. */
    const backfillDay = async (dayId: string, alignWithDayId: string) => {
      await openBackfill(dayId);
      await closeBackfilled(dayId, alignWithDayId);
    };
    const closeBackfilled = (dayId: string, alignWithDayId: string) => create('CloseDay', async () => {
      const day = await read(`days/${dayId}`);
      const expected = (await closing.read(dayId))!.expectedCash!;
      return closing.closeDay({ commandId: id(), leaseEpoch: epoch, dayId, expectedDayRevision: day.revision,
        expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected, note: '', alignWithDayId });
    });
    const addClosedDay = async () => {
      await backfillDay(closedDay(closedMade), closedMade === 0 ? versionDay : closedDay(closedMade - 1));
      closedMade += 1;
    };
    const addOpenDay = async () => {
      await create('EnsureDay', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
        targets: { dayId: openPastDay(openPastMade) }, expectedRevisions: { day: 0 }, payload: { businessDate: openPastDay(openPastMade) } }));
      openPastMade += 1;
    };
    /** Two settlement versions: a reopen and a close of the day that has its own versions. */
    const addVersions = async () => {
      await create('ReopenDay', async () => {
        const day = await read(`days/${versionDay}`);
        return closing.reopenDay({ commandId: id(), leaseEpoch: epoch, dayId: versionDay, expectedDayRevision: day.revision,
          expectedSettlementRevision: day.lastSettlementRevision, reason: 'P16d fixture' });
      });
      await closeBackfilled(versionDay, today);
    };
    /** Two access events: a release and an acquire (the lease ends held, at a higher epoch). */
    const addAccessEvents = async () => {
      expect(await releaseLease(app, OP.uid, epoch, OP.email)).toBe(true);
      epoch = (await read('system/accessLease')).epoch as number;
      expect((await acquireLease(app, OP.uid, epoch, OP.email)).status).toBe('acquired');
      epoch = (await read('system/accessLease')).epoch as number;
    };

    const phases: Array<{ dimension: string; unitsPerStep: number; add: () => Promise<void> }> = [
      { dimension: 'student', unitsPerStep: 1, add: addStudent },
      { dimension: 'vendor', unitsPerStep: 1, add: addVendor },
      { dimension: 'dayTransaction', unitsPerStep: 1, add: addOrder },
      { dimension: 'rangeAccount', unitsPerStep: 1, add: addRangeAccount },
      { dimension: 'studentTransaction', unitsPerStep: 1, add: addStudentOrder },
      { dimension: 'studentRangeTransaction', unitsPerStep: 1, add: addStudentTodayOrder },
      { dimension: 'dayCommand', unitsPerStep: 1, add: addDayCommand },
      { dimension: 'closedDay', unitsPerStep: 1, add: addClosedDay },
      { dimension: 'openDay', unitsPerStep: 1, add: addOpenDay },
      { dimension: 'settlementVersion', unitsPerStep: 2, add: addVersions },
      { dimension: 'accessEvent', unitsPerStep: 2, add: addAccessEvents },
    ];

    // ---- the loads ----
    interface LoadSpec {
      name: string;
      /** The dimensions the load depends on. */
      dimensions: string[];
      /** Whether the repository has a page-size seam (it is then run at two page sizes). */
      paged: boolean;
      /** The page size the repository uses in production. */
      production: number;
      /** Whether the load reads the roster of students (pages of its own size, which the seam does not change). */
      roster?: boolean;
      /** The load runs on a Firestore instance of its own (a page that has just started, with nothing cached), which the meter then counts instead of `app`. */
      fresh?: boolean;
      make: (pageSize: number) => () => Promise<unknown>;
    }
    const productionPages = () => ({
      orders: pageSizeOf('cloudOrderRepository.ts', 'PAGE_SIZE'),
      vendors: pageSizeOf('cloudDayVendorRepository.ts', 'PAGE_SIZE'),
      read: pageSizeOf('cloudReadRepository.ts', 'PAGE_SIZE'),
      backup: pageSizeOf('cloudBackupRepository.ts', 'PAGE_SIZE'),
      ledger: pageSizeOf('cloudDayCloseRepository.ts', 'LEDGER_PAGE_SIZE'),
      students: pageSizeOf('cloudStudentRepository.ts', 'STUDENT_PAGE_SIZE'),
    });
    const loadSpecs = (): LoadSpec[] => {
      const production = productionPages();
      const readerAt = (pageSize: number) => createCloudReadRepository(app, { ...current, pageSize });
      const range = (days: number) => ({ kind: 'custom' as const, startDate: closedDay(days - 1), endDate: versionDay });
      return [
        { name: 'load.students', dimensions: ['student'], paged: false, production: production.students, make: () => () => listCloudStudents(app, current) },
        { name: 'load.orders', dimensions: ['student', 'dayTransaction', 'openDay'], roster: true, paged: true, production: production.orders, make: pageSize => () => createCloudOrderRepository(app, { ...current, pageSize }).loadSnapshot() },
        { name: 'load.dayVendors', dimensions: ['vendor', 'closedDay', 'openDay'], paged: true, production: production.vendors, make: pageSize => () => createCloudDayVendorRepository(app, { ...current, pageSize }).loadSnapshot() },
        { name: 'load.summary', dimensions: ['closedDay', 'settlementVersion'], paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readSummary({ range: range(closedMade), leaseEpoch: epoch }) },
        // the report reads the transactions of the range (every student's) and, for every account that has one in the range, that
        // account's whole history (`readAccountPrefix`, twice): the accounts of the range and their histories are dimensions of their own
        { name: 'load.report', dimensions: ['student', 'dayTransaction', 'rangeAccount', 'studentTransaction'], roster: true, paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readReport({ range: onToday, studentId: null, leaseEpoch: epoch }) },
        // the report of one student (P16f1, P16f2): that student's transactions from the range start to today (`studentRangeTransaction`), whichever day
        { name: 'load.reportStudent', dimensions: ['student', 'dayTransaction', 'studentTransaction', 'studentRangeTransaction'], roster: true, paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readReport({ range: onToday, studentId: studentS, leaseEpoch: epoch }) },
        // the account history (P16f2 S11: with the days of the range, so the page reads no second report): the student's transactions from the range start
        { name: 'load.accountHistory', dimensions: ['student', 'dayTransaction', 'studentTransaction', 'studentRangeTransaction'], roster: true, paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readAccountHistory({ range: onToday, studentId: studentS, leaseEpoch: epoch }) },
        { name: 'load.auditDay', dimensions: ['dayTransaction', 'dayCommand'], paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readAudit({ dayId: today, leaseEpoch: epoch }) },
        // P16f1: the audit of a student is the newest page of at most 100 commands, so it is run at the production page size only (at 6 or 12
        // it would be one small page whatever the history, and the slope would be a fraction of the real cost); the gate gives it at most 100 units
        { name: 'load.auditStudent', dimensions: ['studentTransaction'], paged: false, production: production.read, make: () => () => createCloudReadRepository(app, current).readAudit({ studentId: studentS, leaseEpoch: epoch }) },
        // the range audit (CSV and print) reads the commands of the range and the commands that carry no business date
        { name: 'load.auditRange', dimensions: ['student', 'vendor', 'dayTransaction', 'dayCommand'], paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readAuditRange({ range: onToday, studentId: null, leaseEpoch: epoch }) },
        // the range audit of one student reads every command of that student (the history), whatever the range
        { name: 'load.auditRangeStudent', dimensions: ['studentTransaction'], paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readAuditRange({ range: onToday, studentId: studentS, leaseEpoch: epoch }) },
        { name: 'load.accessEvents', dimensions: ['accessEvent'], paged: true, production: production.read, make: pageSize => () => readerAt(pageSize).readAccessEvents({ range: onToday, leaseEpoch: epoch }) },
        { name: 'load.dayCloseOverview', dimensions: ['openDay'], paged: false, production: production.ledger, make: () => () => closing.readOverview() },
        { name: 'load.dayCloseState', dimensions: ['settlementVersion'], paged: false, production: production.ledger, make: () => () => closing.read(versionDay) },
        { name: 'load.ledgerScan', dimensions: ['closedDay', 'openDay'], paged: true, production: production.ledger, make: pageSize => () => createCloudLedgerReader(app, current, { pageSize }).read() },
        // the first scan of a page that has just started: the reader keeps the counted cash of each closed day in memory (per Firestore
        // instance), so the first scan reads every closed day's latest settlement and the next ones only the days that changed
        { name: 'load.ledgerScanCold', dimensions: ['closedDay', 'openDay'], paged: true, fresh: true, production: production.ledger, make: pageSize => () => createCloudLedgerReader(dbFor(OP), current, { pageSize }).read() },
        // the incremental backup export reads every command once: its dimension is the number of commands, which every phase grows
        { name: 'load.backupExport', dimensions: ['command'], paged: true, production: production.backup, make: pageSize => () => createCloudBackupRepository(app, { currentUid: () => OP.uid, pageSize }).exportRange({ fromSeq: 0, generatedAt: '2026-10-23T03:00:00.000Z' }) },
      ];
    };

    interface Recorded {
      dims: Record<string, number>;
      loads: Map<string, { small: FitSample; large?: FitSample; reads: Record<string, number> }>;
    }
    const recorded: Recorded[] = [];
    const phaseRanges: FitPhase[] = [];

    const countDimensions = async (): Promise<Record<string, number>> => {
      const commandsToday = await adminCount('commands', ['businessDate', '==', today]);
      const dayTransaction = await adminCount('transactions', ['businessDate', '==', today]);
      return {
        student: await adminCount('students'), vendor: await adminCount('vendors'), dayTransaction, rangeAccount: rangeMade,
        studentTransaction: await adminCount('transactions', ['studentId', '==', studentS]),
        // the transactions of studentS dated today (the range of the loads below): what a report or history of one student reads from the range start
        studentRangeTransaction: await adminCount('transactions', ['studentId', '==', studentS], ['businessDate', '==', today]),
        // commands dated today that are not the orders' own (each order is one transaction and one command)
        dayCommand: commandsToday - dayTransaction,
        closedDay: closedMade, openDay: openPastMade,
        settlementVersion: await adminCount(`days/${versionDay}/settlements`), accessEvent: await adminCount('accessEvents'),
        command: await headSeq(),
      };
    };
    const measureOne = async (run: () => Promise<unknown>, fresh = false) => {
      const { report } = await meter.measure(run, fresh ? undefined : app);
      localStorage.clear();
      const measured = summarize(report);
      const sample: FitSample = { reads: measured.reads, authorization: measured.authDocuments + measured.authQueries, authQueries: measured.authQueries };
      return { sample, measured };
    };
    /** Measures every load (at two page sizes where it has a seam) at the current state of the fixture. */
    const measureState = async () => {
      const dims = await countDimensions();
      const loads: Recorded['loads'] = new Map();
      for (const spec of loadSpecs()) {
        const small = await measureOne(spec.make(STEP), spec.fresh);
        const large = spec.paged ? await measureOne(spec.make(2 * STEP), spec.fresh) : undefined;
        loads.set(spec.name, { small: small.sample, ...(large ? { large: large.sample } : {}), reads: small.measured.readsByKey });
        queryShapes.set(spec.name, small.measured.queries);
      }
      recorded.push({ dims, loads });
    };

    beforeAll(async () => {
      // A fresh dataset: the head's go-live date goes back far enough for the fixture's days; today is open with its opening cash.
      await seedEmptySource(env, 'anonymous-p16d-loads');
      epoch = R02_LEASE_EPOCH;
      await admin(async db => { await setDoc(doc(db, 'system/dataHead'), { goLiveDate: '2025-01-01' }, { merge: true }); });
      buildRepositories(STEP);
      await setBase();
      await create('EnsureDay today', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
        targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }));
      await create('SetOpeningCash', async () => writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: epoch,
        targets: { dayId: today }, expectedRevisions: { day: (await read(`days/${today}`)).revision }, payload: { openingCash: 1000, reason: 'P16d fixture' } }));
      // The base every phase starts from: the two students (studentS has the history, studentT the orders of today), the open
      // back-filled day for studentS's history, one closed day (the summary needs a range), and a day with its first settlement
      // version.
      await addStudent();
      await addStudent();
      for (let index = 0; index < POOL; index += 1) await addStudent();
      // studentS is an account of today's range from the start (the report reads its whole history), through one order of today
      await placeOrder(studentS, today, '');
      await openBackfill(historyDay);
      await backfillDay(versionDay, today);
      await addClosedDay();
    }, 180_000);

    it('measures every load on the base fixture', async () => {
      await measureState();
    }, 300_000);

    phases.forEach((phase, phaseIndex) => {
      it(`phase ${phaseIndex + 1}: grows ${phase.dimension} by ${STEP} three times and measures every load after each step`, async () => {
        // Only the states after the phase's own steps give its slope: the state before it is the end of the previous phase and
        // still carries that phase's last command (a scan that follows a settlement also reads that settlement), while after
        // every step of this phase the last command is the same kind, so such a cost cancels out of the slope. Every state
        // still counts for the intercept.
        const stateIndexes: number[] = [];
        for (let step = 0; step < STEPS_PER_PHASE; step += 1) {
          await setBase();
          for (let unit = 0; unit < STEP; unit += phase.unitsPerStep) await phase.add();
          await measureState();
          stateIndexes.push(recorded.length - 1);
        }
        phaseRanges.push({ dimension: phase.dimension, stateIndexes });
      }, 900_000);
    });

    it('fits every load: reads and authorization per unit of each dimension that it grows with', () => {
      expect(phaseRanges.length).toBe(phases.length);
      if (reportPath) {
        // the raw measurements, written before the fit so that a rejected fit can be looked at
        writeFileSync(`${reportPath}.states.json`, JSON.stringify({
          phases: phaseRanges,
          states: recorded.map(entry => ({ dims: entry.dims, loads: Object.fromEntries([...entry.loads.entries()].map(([name, load]) => [name, { small: load.small, large: load.large, reads: load.reads }])) })),
        }, null, 2));
      }
      for (const spec of loadSpecs()) {
        const states: FitState[] = recorded.map(entry => {
          const measured = entry.loads.get(spec.name)!;
          return { dims: entry.dims, small: measured.small, ...(measured.large ? { large: measured.large } : {}) };
        });
        // a load that does not read accounts sees the orders of the `rangeAccount` phase as transactions of the day (`dayTransaction`
        // counts every transaction of today), so it has no phase of that dimension: its slope is that of the `dayTransaction` phase,
        // and the states of the `rangeAccount` phase still count for its intercept, which is the largest over every measured state
        // (the backup export grows with the commands of every phase, so its one series is every state)
        // the same goes for the `studentRangeTransaction` phase (an order of today by studentS: also a transaction of today and of the student's history)
        const confounded = ['rangeAccount', 'studentRangeTransaction'];
        const own: FitPhase[] = spec.dimensions.length === 1 && spec.dimensions[0] === 'command'
          ? [{ dimension: 'command', stateIndexes: states.map((_state, index) => index) }]
          : phaseRanges.filter(phase => !confounded.includes(phase.dimension) || spec.dimensions.includes(phase.dimension));
        // the roster is read in pages of its own size: one page per production page of students, measured as the pages of the
        // students load (its one query: the authorization calls it costs)
        const rosterPage = recorded[recorded.length - 1]!.loads.get('load.students')!.small;
        const fit = fitLoad({
          name: spec.name, states, phases: own, dimensions: spec.dimensions,
          pages: spec.paged ? { small: STEP, large: 2 * STEP, production: spec.production } : { production: spec.production },
          ...(spec.roster ? { unseamed: [{ dimension: 'student', pageSize: productionPages().students, authorization: rosterPage.authQueries, reads: 1 }] } : {}),
        });
        operations.set(spec.name, {
          units: fit.units, reads: fit.reads, readAuthorization: fit.readAuthorization, readAuthorizationDeduped: fit.readAuthorization,
          writes: 0, deletes: 0,
          detail: {
            ...fit.detail,
            // the raw measurements the fit is made of: units of every dimension and the runs at the page sizes
            states: recorded.map(entry => {
              const measured = entry.loads.get(spec.name)!;
              return { dims: entry.dims, small: measured.small, ...(measured.large ? { large: measured.large } : {}) };
            }),
            lastRunReadsByKey: recorded[recorded.length - 1]!.loads.get(spec.name)!.reads,
          },
        });
      }
    }, 60_000);
    // The closed-day part of a report (P16f2): a report reads, for each closed day of its range, the day, its settlement versions, the
    // post-close entries and the back-fill marker. The summary no longer does (S13), so this is measured on its own: a report of the
    // newest closed day (three versions) less a report of a day with no document, over the same transactions after the range start.
    it('load.reportClosedDay: what a closed day adds to a report', async () => {
      await setBase();
      const emptyDay = shiftDay(today, -30);
      const reportOf = (dayId: string) => createCloudReadRepository(app, current).readReport({ range: { kind: 'custom', startDate: dayId, endDate: dayId }, studentId: null, leaseEpoch: epoch });
      const closed = await meter.measure(() => reportOf(versionDay), app);
      localStorage.clear();
      const empty = await meter.measure(() => reportOf(emptyDay), app);
      localStorage.clear();
      const withDay = summarize(closed.report);
      const without = summarize(empty.report);
      expect(withDay.reads).toBeGreaterThan(without.reads);
      fixedOperation('load.reportClosedDay', {
        ...withDay, reads: withDay.reads - without.reads,
        authDocuments: Math.max(0, withDay.authDocuments - without.authDocuments), authQueries: Math.max(0, withDay.authQueries - without.authQueries),
      });
    }, 120_000);
  });

  // ---- C2. the orders page after one of its own commands (P16f2 S4) ----
  describe('orders refresh', () => {
    it('refreshSnapshot after a CreateOrder: a fixed cost, whatever the size of the day or the roster', async () => {
      // measured on the fully grown fixture of the loads above (at the production page size): the cost must not depend on it
      const page = createCloudOrderRepository(app, current);
      const studentId = uuid(950_101);
      await setBase();
      const before = await page.loadSnapshot();
      const rev = await revisions(studentId, today);
      const result = await page.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId, dayId: today,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
        menuRevision: null, otherItemName: 'x', note: '' });
      if (!result.ok) throw new Error(`P16f2 scenario: CreateOrder failed ${JSON.stringify(result)}`);
      const { result: refreshed, report } = await meter.measure(() => page.refreshSnapshot(before, result.receipt), app);
      localStorage.clear();
      expect(refreshed).not.toBeNull();
      expect(refreshed).toEqual(await page.loadSnapshot());
      fixedOperation('load.ordersRefresh', summarize(report));
    }, 120_000);
  });

  // ---- D. the table ----
  it('measures every operation, and the result equals the checked-in cost table', () => {
    const table: CostTable = {
      schemaVersion: 1,
      operations: Object.fromEntries([...operations.entries()].sort(([a], [b]) => a.localeCompare(b))),
      rules: Object.fromEntries(ALL_COMMAND_KINDS.map(kind => {
        const written = operations.get(`command.${kind}`)?.writes ?? 0;
        const spec = P05_COMMIT_ACCESS_CALLS[kind];
        // distinct documents the commit's Rules touch: the operator, the lease, plus every written document once
        return [kind, { commitAccessCalls: spec.calls, commitDistinctDocuments: written + 2, source: spec.source }];
      })),
    };
    for (const kind of ALL_COMMAND_KINDS) expect(operations.has(`command.${kind}`), `command.${kind} was measured`).toBe(true);
    expect(Object.keys(P05_COMMIT_ACCESS_CALLS).sort()).toEqual([...ALL_COMMAND_KINDS].sort());
    if (writeCostsPath) writeFileSync(writeCostsPath, `${JSON.stringify(table, null, 2)}\n`);
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify({
        table, queryShapes: Object.fromEntries([...queryShapes.entries()]),
      }, null, 2));
    }
    const checkedIn = JSON.parse(readFileSync(costsFile, 'utf8') as string) as CostTable;
    expect(table).toEqual(checkedIn);
  });

  it('records the shape of every query the operations run, and equals the checked-in shapes (what `indexCoverage.test.ts` checks the indexes against)', () => {
    // one entry per distinct (collection, filters, order); the operations that run it; no document counts or cursors, which vary
    const byShape = new Map<string, { collection: string; where: string[]; orderBy: string[]; operations: Set<string> }>();
    for (const [operation, queries] of queryShapes) {
      for (const query of queries) {
        const key = JSON.stringify([query.collection, query.where, query.orderBy]);
        const entry = byShape.get(key) ?? { collection: query.collection, where: query.where, orderBy: query.orderBy, operations: new Set<string>() };
        entry.operations.add(operation);
        byShape.set(key, entry);
      }
    }
    const shapes = {
      schemaVersion: 1,
      shapes: [...byShape.values()]
        .map(entry => ({ collection: entry.collection, where: entry.where, orderBy: entry.orderBy, operations: [...entry.operations].sort() }))
        .sort((a, b) => JSON.stringify([a.collection, a.where, a.orderBy]).localeCompare(JSON.stringify([b.collection, b.where, b.orderBy]))),
    };
    expect(shapes.shapes.length).toBeGreaterThan(0);
    if (writeShapesPath) writeFileSync(writeShapesPath, `${JSON.stringify(shapes, null, 2)}\n`);
    expect(shapes).toEqual(JSON.parse(readFileSync(shapesFile, 'utf8') as string));
  });
});
