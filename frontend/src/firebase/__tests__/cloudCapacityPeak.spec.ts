// @ts-expect-error Node-only file access loads the real Rules.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudOrderRepository } from '../cloudOrderRepository';
import { meter, type MeterReport } from './helpers/firestoreMeter';
import { today } from './helpers/kindScenario';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, uuid } from './helpers/r02Scenario';

/**
 * P16e peak and contention (plan P16e item 4), on the real Rules and the production repositories:
 * - peak: one page submits 60 orders in a row; every one commits, and each costs exactly what a single order costs (the meter
 *   counts the reads of every transaction attempt, so a retried order would cost more), i.e. 60 attempts for 60 orders;
 * - contention: two pages on the same operator submit orders for different students at the same time (they share the day
 *   document, so the revisions they expected go stale); every order ends committed once or refused with REVISION_CONFLICT, the
 *   page that was refused reloads the revisions and submits it again, nothing is booked twice, and the SDK never needs more
 *   than five attempts for one command (the Firestore SDK's own limit).
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
if (required && !emulatorHost) throw new Error('P16e peak and contention require FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');

const OP = R02_OPERATOR;
const PEAK_ORDERS = 60;
const PAGE_ORDERS = 10;
const SDK_ATTEMPTS = 5;
/** A page that is refused with REVISION_CONFLICT reloads and submits again, three times at most. */
const PAGE_RETRIES = 3;
const studentIds = Array.from({ length: 6 }, (_item, index) => uuid(960_000 + index));

let env: RulesTestEnvironment;
let nextId = 40_000;
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

describeWithEmulator('P16e peak and contention: 60 orders in a row, two pages on one operator', () => {
  const user = operatorUser();
  const current = { currentUser: () => user };

  const order = async (orders: ReturnType<typeof createCloudOrderRepository>, studentId: string, label: string) => {
    const student = (await read(`students/${studentId}`)).revision;
    const day = (await read(`days/${today}`)).revision;
    return orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId, dayId: today,
      expectedStudentRevision: student, expectedDayRevision: day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
      menuRevision: null, otherItemName: label, note: '' });
  };
  /** Transaction attempts of a command: each attempt reads the command document first. */
  const attempts = (report: MeterReport) => report.reads.filter(event => event.form === 'tx-doc' && event.key === 'commands/*').length;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(`${process.cwd()}/../firestore.rules`, 'utf8') },
    });
    await seedEmptySource(env, 'anonymous-p16e-peak');
    await admin(async db => { await setDoc(doc(db, 'system/dataHead'), { goLiveDate: '2025-01-01' }, { merge: true }); });
    const writer = createCloudCommandRepository(dbFor(OP), current);
    const ok = async (result: { ok: boolean }, label: string) => { if (!result.ok) throw new Error(`P16e scenario: ${label} failed ${JSON.stringify(result)}`); };
    await ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: 0 }, payload: { businessDate: today } }), 'EnsureDay');
    await ok(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: (await read(`days/${today}`)).revision }, payload: { openingCash: 1000, reason: 'P16e fixture' } }), 'SetOpeningCash');
    for (const [index, studentId] of studentIds.entries()) {
      await ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: epoch, targets: { studentId },
        expectedRevisions: { student: 0 }, payload: { studentCode: String(850_000 + index), displayName: `P16e student ${index}`, aliases: [], openingBalance: { amount: 0, asOfDate: '2025-01-01', note: '' } } }), 'CreateStudent');
    }
  }, 180_000);
  afterAll(async () => { await env.cleanup(); });

  it(`peak: ${PEAK_ORDERS} orders from one page all commit, each with the reads and writes of one attempt`, async () => {
    const app = dbFor(OP);
    const orders = createCloudOrderRepository(app, current);
    const before = await countOf('transactions');
    let first: { reads: number; writes: number } | null = null;
    for (let index = 0; index < PEAK_ORDERS; index += 1) {
      meter.start(app);
      const result = await order(orders, studentIds[index % studentIds.length]!, `peak ${index}`);
      const report = meter.stop();
      localStorage.clear();
      expect(result.ok, `order ${index}: ${JSON.stringify(result)}`).toBe(true);
      expect(attempts(report), `order ${index} needed one attempt`).toBe(1);
      first ??= { reads: report.billedReads, writes: report.billedWrites };
      expect({ reads: report.billedReads, writes: report.billedWrites }, `order ${index} costs what the first one did`).toEqual(first);
    }
    expect(await countOf('transactions') - before).toBe(PEAK_ORDERS);
  }, 300_000);

  it(`contention: two pages on one operator submit ${PAGE_ORDERS} orders each for different students at the same time`, async () => {
    const pages = [0, 1].map(page => ({ app: dbFor(OP), student: studentIds[page]! }));
    const repositories = pages.map(page => createCloudOrderRepository(page.app, current));
    const before = await countOf('transactions');
    const outcomes = { committed: 0, gaveUp: 0, submissions: 0, other: [] as string[] };

    // the meter records one stretch at a time, so both pages are counted together (the administrator's revision reads are not
    // transaction reads of a command and do not matter for the attempts)
    meter.start();
    await Promise.all(pages.map(async (page, pageIndex) => {
      for (let index = 0; index < PAGE_ORDERS; index += 1) {
        // a page reloads the revisions and submits again after REVISION_CONFLICT, as a person does with the reload button
        for (let retry = 0; retry < PAGE_RETRIES; retry += 1) {
          outcomes.submissions += 1;
          const result = await order(repositories[pageIndex]!, page.student, `page ${pageIndex} order ${index}`);
          if (result.ok) { outcomes.committed += 1; break; }
          if (result.error.code !== 'REVISION_CONFLICT') { outcomes.other.push(result.error.code); break; }
          if (retry === PAGE_RETRIES - 1) outcomes.gaveUp += 1;
        }
      }
    }));
    const report = meter.stop();
    localStorage.clear();

    expect(outcomes.other).toEqual([]);
    // every order ends committed or refused with the explicit REVISION_CONFLICT after the page's tries (two pages that submit in
    // a tight loop on the one day document can starve each other for a moment; a person does not), and most of them commit
    expect(outcomes.committed + outcomes.gaveUp).toBe(2 * PAGE_ORDERS);
    expect(outcomes.committed).toBeGreaterThanOrEqual(PAGE_ORDERS);
    // nothing booked twice: exactly the committed orders exist
    expect(await countOf('transactions') - before).toBe(outcomes.committed);
    // the SDK retries a contended transaction on its own, up to five attempts for each submission
    expect(attempts(report)).toBeGreaterThanOrEqual(outcomes.submissions);
    expect(attempts(report)).toBeLessThanOrEqual(SDK_ATTEMPTS * outcomes.submissions);
  }, 300_000);
});
