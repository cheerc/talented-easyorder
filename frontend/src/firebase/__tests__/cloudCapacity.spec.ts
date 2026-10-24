// @ts-expect-error Node-only file access loads the real Rules, the checked-in cost table and the repositories' page-size constants.
import { readFileSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp, collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALL_COMMAND_KINDS, type BusinessCommandKind } from '../../domain/cloudCommands';
import {
  readAuthorizationCalls, type CostTable, type Linear, type OperationCost, type RulesKindCost,
} from '../../maintenance/capacityModel';
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
 * the production lease functions; the loads that grow with history run on a fixture that grows in three equal stages, and
 * each load's reads and Rules read authorization are fitted to a line in the number of units it scales with (the middle stage
 * must lie on the line exactly). The result is compared with the checked-in `docs/ops/p16-capacity-costs.json`: a change of cost
 * has to change the table in the same PR.
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

const OP = R02_OPERATOR;
const OTHER = { uid: 'p16d-other-operator', email: 'p16d-other@example.test', active: true };
const STEP = 6;
const STAGES = 3;

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
const adminCount = (path: string, ...constraints: Array<[string, '==', string]>) => admin(async db => (
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
    reads: { fixed: measured.reads, perUnit: 0 },
    readAuthorization: { fixed: auth, perUnit: 0 },
    // A read request is authorized on its own (its two or fewer distinct documents), so nothing is shared between requests.
    readAuthorizationDeduped: { fixed: auth, perUnit: 0 },
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

interface Point { units: number; reads: number; authorization: number; authQueries: number; readsByKey?: Record<string, number> }

/**
 * A load's cost is reads = fixed + units × b + pages × c: b per document, c per page (the head and lease fence reads and the
 * Rules authorization of every page request, which depend on the page size, not on the documents). The fixture is measured at
 * two page sizes, so b and c are told apart: the slope of a stage series at page size P is s_P = b + c / P. Each series
 * is a line through its first and last stage whose intercept is raised until no stage is above it (an upper bound), and a
 * stage more than 2 % (at least 1 read) below the line fails the fit, because then the load is not linear in its units.
 * The production slope is b + c / (production page size), and one page is added to the intercept.
 */
function lineThrough(name: string, points: Point[], pick: (point: Point) => number): { slope: number; intercept: number } {
  expect(points.length, `${name}: stages`).toBe(STAGES);
  const [first, middle, last] = points as [Point, Point, Point];
  expect(last.units, `${name}: the fixture has to grow`).toBeGreaterThan(first.units);
  const slope = (pick(last) - pick(first)) / (last.units - first.units);
  const intercept = Math.max(...points.map(point => pick(point) - slope * point.units));
  const slack = Math.max(1, 0.02 * pick(last));
  expect(intercept + slope * middle.units - pick(middle), `${name}: the middle stage is far below the line (units ${first.units}, ${middle.units}, ${last.units})`).toBeLessThanOrEqual(slack);
  expect(slope, `${name}: the cost does not shrink as the fixture grows`).toBeGreaterThanOrEqual(0);
  return { slope, intercept };
}

function split(name: string, small: Point[], large: Point[], pick: (point: Point) => number, productionPage: number): Linear {
  const one = lineThrough(`${name} @${STEP}`, small, pick);
  const two = lineThrough(`${name} @${2 * STEP}`, large, pick);
  // s_P = b + c / P at P = STEP and 2 × STEP: c = (s1 - s2) / (1/STEP - 1/(2 × STEP)) = 2 × STEP × (s1 - s2)
  const perPage = Math.max(0, 2 * STEP * (one.slope - two.slope));
  const perUnit = Math.max(0, one.slope - perPage / STEP);
  return {
    fixed: round(Math.max(one.intercept, two.intercept) + perPage),
    perUnit: round(perUnit + perPage / productionPage),
  };
}
const round = (value: number) => Math.round(value * 1e6) / 1e6;

type Series = { small: Point[]; large: Point[] };

function loadOperation(name: string, unit: string, series: Series, productionPage: number, writes = 0): void {
  const reads = split(name, series.small, series.large, point => point.reads, productionPage);
  const readAuthorization = split(`${name} authorization`, series.small, series.large, point => point.authorization, productionPage);
  operations.set(name, {
    unit, reads, readAuthorization, readAuthorizationDeduped: readAuthorization, writes, deletes: 0,
    detail: {
      pageSizes: [STEP, 2 * STEP], productionPageSize: productionPage,
      small: series.small.map(point => ({ ...point })), large: series.large.map(point => ({ units: point.units, reads: point.reads, authorization: point.authorization, authQueries: point.authQueries })),
    },
  });
}

// A load with no page-size seam (the student list, the day-close reads, which use the production page size of the ledger reader):
// reads and authorization are per document as measured, and one more page of query authorization is added to the fixed part and
// spread over the production page size.
function unpagedLoad(name: string, unit: string, points: Point[], productionPage: number): void {
  const reads = lineThrough(name, points, point => point.reads);
  const authorization = lineThrough(`${name} authorization`, points, point => point.authorization);
  const onePage = (points[STAGES - 1] as Point).authQueries;
  const auth = { fixed: round(authorization.intercept + onePage), perUnit: round(authorization.slope + onePage / productionPage) };
  operations.set(name, {
    unit, reads: { fixed: round(reads.intercept), perUnit: round(reads.slope) },
    readAuthorization: auth, readAuthorizationDeduped: auth, writes: 0, deletes: 0,
    detail: { points: points.map(point => ({ ...point })), productionPageSize: productionPage },
  });
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

  // ---- C. loads that grow with history: three stages, fitted to a line ----
  describe('loads', () => {
    const closedDay = (index: number) => shiftDay(today, -2 - index);
    const openPastDay = (index: number) => shiftDay(today, -60 - index);
    const studentS = uuid(950_000);
    const versionDay = shiftDay(today, -300);
    let studentsMade = 0;
    let closedMade = 0;
    let openPastMade = 0;
    let ordersMade = 0;
    let vendorsMade = 0;
    let versionsClosed = 0;

    const stageSamples = new Map<string, { small: Point[]; large: Point[] }>();
    const measurePoint = async (units: number, run: () => Promise<unknown>) => {
      const { report } = await meter.measure(run, app);
      localStorage.clear();
      const measured = summarize(report);
      const point: Point = {
        units, reads: measured.reads, authorization: measured.authDocuments + measured.authQueries,
        authQueries: measured.authQueries, readsByKey: measured.readsByKey,
      };
      return { point, measured };
    };
    // A load with a page-size seam runs at STEP and at 2 × STEP; one without runs once (the `large` series stays empty).
    const sample = async (name: string, units: number, make: (pageSize: number) => () => Promise<unknown>) => {
      const series = stageSamples.get(name) ?? { small: [], large: [] };
      const small = await measurePoint(units, make(STEP));
      series.small.push(small.point);
      series.large.push((await measurePoint(units, make(2 * STEP))).point);
      stageSamples.set(name, series);
      if (series.small.length === STAGES) queryShapes.set(name, small.measured.queries);
    };
    const sampleUnpaged = async (name: string, units: number, run: () => Promise<unknown>) => {
      const series = stageSamples.get(name) ?? { small: [], large: [] };
      const { point, measured } = await measurePoint(units, run);
      series.small.push(point);
      stageSamples.set(name, series);
      if (series.small.length === STAGES) queryShapes.set(name, measured.queries);
    };

    const create = async (label: string, run: () => Promise<{ ok: boolean }>) => ok(await run(), label);

    const growFixture = async () => {
      await setBase();
      for (let index = 0; index < STEP; index += 1) {
        const studentId = studentsMade === 0 ? studentS : uuid(950_100 + studentsMade);
        const code = String(840_000 + studentsMade);
        await create('CreateStudent', () => writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: epoch,
          targets: { studentId }, expectedRevisions: { student: 0 },
          payload: { studentCode: code, displayName: `P16d student ${studentsMade}`, aliases: [], openingBalance: { amount: 0, asOfDate: '2025-01-01', note: '' } } }));
        studentsMade += 1;
      }
      for (let index = 0; index < STEP; index += 1) {
        const vendorId = uuid(950_500 + vendorsMade);
        await create('SaveVendor', () => writer.commitCommand({ commandId: id(), kind: 'SaveVendor', leaseEpoch: epoch,
          targets: { vendorId }, expectedRevisions: { vendor: 0 },
          payload: { vendorId, name: `P16d vendor ${vendorsMade}`, phone: '', note: '', status: 'active' } }));
        vendorsMade += 1;
      }
      for (let index = 0; index < STEP; index += 1) {
        const rev = await revisions(studentS, today);
        await create('CreateOrder', () => orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId: studentS, dayId: today,
          expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
          menuRevision: null, otherItemName: 'x', note: '' }));
        ordersMade += 1;
      }
      for (let index = 0; index < STEP; index += 1) {
        const dayId = closedDay(closedMade);
        await create('EnsureDay', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
          targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId } }));
        await create('BackfillOpeningCash', async () => closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId,
          expectedDayRevision: (await read(`days/${dayId}`)).revision, openingCash: 1000, reason: 'P16d fixture' }));
        await create('StartBackfill', async () => writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: epoch,
          targets: { dayId }, expectedRevisions: { day: (await read(`days/${dayId}`)).revision }, payload: { reason: 'P16d fixture' } }));
        await create('CloseDay', async () => {
          const day = await read(`days/${dayId}`);
          const expected = (await closing.read(dayId))!.expectedCash!;
          return closing.closeDay({ commandId: id(), leaseEpoch: epoch, dayId, expectedDayRevision: day.revision,
            expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected, note: '',
            alignWithDayId: dayId === closedDay(0) ? today : closedDay(closedMade - 1) });
        });
        closedMade += 1;
      }
      for (let index = 0; index < STEP; index += 1) {
        const dayId = openPastDay(openPastMade);
        await create('EnsureDay', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
          targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId } }));
        openPastMade += 1;
      }
      // One more settlement version per stage on a day of its own: stage 1 closes it (version 1), later stages reopen and close again.
      if (versionsClosed === 0) {
        await create('EnsureDay', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
          targets: { dayId: versionDay }, expectedRevisions: { day: 0 }, payload: { businessDate: versionDay } }));
        await create('BackfillOpeningCash', async () => closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId: versionDay,
          expectedDayRevision: (await read(`days/${versionDay}`)).revision, openingCash: 1000, reason: 'P16d fixture' }));
        await create('StartBackfill', async () => writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: epoch,
          targets: { dayId: versionDay }, expectedRevisions: { day: (await read(`days/${versionDay}`)).revision }, payload: { reason: 'P16d fixture' } }));
      } else {
        await create('ReopenDay', async () => {
          const day = await read(`days/${versionDay}`);
          return closing.reopenDay({ commandId: id(), leaseEpoch: epoch, dayId: versionDay, expectedDayRevision: day.revision,
            expectedSettlementRevision: day.lastSettlementRevision, reason: 'P16d fixture' });
        });
      }
      await create('CloseDay', async () => {
        const day = await read(`days/${versionDay}`);
        const expected = (await closing.read(versionDay))!.expectedCash!;
        return closing.closeDay({ commandId: id(), leaseEpoch: epoch, dayId: versionDay, expectedDayRevision: day.revision,
          expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected, note: '',
          alignWithDayId: closedDay(closedMade - 1) });
      });
      versionsClosed += 1;
      // Access events: a release and an acquire add two (the lease ends the stage held, at a higher epoch).
      for (let cycle = 0; cycle < STEP / 2; cycle += 1) {
        expect(await releaseLease(app, OP.uid, epoch, OP.email)).toBe(true);
        epoch = (await read('system/accessLease')).epoch as number;
        expect((await acquireLease(app, OP.uid, epoch, OP.email)).status).toBe('acquired');
        epoch = (await read('system/accessLease')).epoch as number;
      }
    };

    beforeAll(async () => {
      // A fresh dataset: the head's go-live date goes back far enough for the fixture's days; today is open with its opening cash.
      await seedEmptySource(env, 'anonymous-p16d-loads');
      epoch = R02_LEASE_EPOCH;
      await admin(async db => { await setDoc(doc(db, 'system/dataHead'), { goLiveDate: '2025-01-01' }, { merge: true }); });
      buildRepositories(STEP);
      await create('EnsureDay today', () => writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch,
        targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }));
      await create('SetOpeningCash', async () => writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: epoch,
        targets: { dayId: today }, expectedRevisions: { day: (await read(`days/${today}`)).revision }, payload: { openingCash: 1000, reason: 'P16d fixture' } }));
    }, 180_000);

    for (let stage = 1; stage <= STAGES; stage += 1) {
      it(`stage ${stage}: grow the fixture by ${STEP} of each, then measure every load`, async () => {
        await growFixture();
        const readerAt = (pageSize: number) => createCloudReadRepository(app, { ...current, pageSize });
        const range = (days: number) => ({ kind: 'custom' as const, startDate: closedDay(days - 1), endDate: closedDay(0) });
        const onToday = { kind: 'today' as const, startDate: today, endDate: today };
        const todayCommands = await adminCount('commands', ['businessDate', '==', today]);
        const studentCommands = await adminCount('commands', ['studentId', '==', studentS]);

        await sampleUnpaged('load.students', studentsMade, () => listCloudStudents(app, current));
        await sample('load.orders', ordersMade, pageSize => () => createCloudOrderRepository(app, { ...current, pageSize }).loadSnapshot());
        await sample('load.dayVendors', vendorsMade, pageSize => () => createCloudDayVendorRepository(app, { ...current, pageSize }).loadSnapshot());
        await sample('load.summary', closedMade, pageSize => () => readerAt(pageSize).readSummary({ range: range(closedMade), leaseEpoch: epoch }));
        await sample('load.report', ordersMade, pageSize => () => readerAt(pageSize).readReport({ range: onToday, studentId: null, leaseEpoch: epoch }));
        await sample('load.accountHistory', ordersMade, pageSize => () => readerAt(pageSize).readAccountHistory({ range: onToday, studentId: studentS, leaseEpoch: epoch }));
        await sample('load.auditDay', todayCommands, pageSize => () => readerAt(pageSize).readAudit({ dayId: today, leaseEpoch: epoch }));
        await sample('load.auditStudent', studentCommands, pageSize => () => readerAt(pageSize).readAudit({ studentId: studentS, leaseEpoch: epoch }));
        await sample('load.accessEvents', await adminCount('accessEvents'), pageSize => () => readerAt(pageSize).readAccessEvents({ range: onToday, leaseEpoch: epoch }));
        await sampleUnpaged('load.dayCloseOverview', openPastMade, () => closing.readOverview());
        await sampleUnpaged('load.dayCloseState', 2 * versionsClosed - 1, () => closing.read(versionDay));
        await sample('load.ledgerScan', await adminCount('days'), pageSize => () => createCloudLedgerReader(app, current, { pageSize }).read());
        await sample('load.backupExport', await headSeq(), pageSize => () => createCloudBackupRepository(app, { currentUid: () => OP.uid, pageSize }).exportRange({ fromSeq: 0, generatedAt: '2026-10-23T03:00:00.000Z' }));
      }, 600_000);
    }

    it('fits every load to a line in its units', () => {
      const production = {
        orders: pageSizeOf('cloudOrderRepository.ts', 'PAGE_SIZE'),
        vendors: pageSizeOf('cloudDayVendorRepository.ts', 'PAGE_SIZE'),
        read: pageSizeOf('cloudReadRepository.ts', 'PAGE_SIZE'),
        backup: pageSizeOf('cloudBackupRepository.ts', 'PAGE_SIZE'),
        ledger: pageSizeOf('cloudDayCloseRepository.ts', 'LEDGER_PAGE_SIZE'),
        students: pageSizeOf('cloudStudentRepository.ts', 'STUDENT_PAGE_SIZE'),
      };
      const get = (name: string) => stageSamples.get(name)!;
      unpagedLoad('load.students', 'student', get('load.students').small, production.students);
      loadOperation('load.orders', 'dayTransaction', get('load.orders'), production.orders);
      loadOperation('load.dayVendors', 'vendor', get('load.dayVendors'), production.vendors);
      loadOperation('load.summary', 'closedDay', get('load.summary'), production.read);
      loadOperation('load.report', 'dayTransaction', get('load.report'), production.read);
      loadOperation('load.accountHistory', 'studentTransaction', get('load.accountHistory'), production.read);
      loadOperation('load.auditDay', 'dayCommand', get('load.auditDay'), production.read);
      loadOperation('load.auditStudent', 'studentCommand', get('load.auditStudent'), production.read);
      loadOperation('load.accessEvents', 'accessEvent', get('load.accessEvents'), production.read);
      unpagedLoad('load.dayCloseOverview', 'unclosedDay', get('load.dayCloseOverview').small, production.ledger);
      unpagedLoad('load.dayCloseState', 'settlementVersion', get('load.dayCloseState').small, production.ledger);
      loadOperation('load.ledgerScan', 'day', get('load.ledgerScan'), production.ledger);
      loadOperation('load.backupExport', 'command', get('load.backupExport'), production.backup);
    }, 60_000);
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
});
