// @ts-expect-error Node-only file access loads the real Rules.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../cloudOrderRepository';
import { createCloudReadRepository } from '../cloudReadRepository';
import { meter } from './helpers/firestoreMeter';
import { today } from './helpers/kindScenario';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, shiftDay, uuid } from './helpers/r02Scenario';

/**
 * P16f1 read reduction (plan P16f §2 S1, S2, S5, S6), on the production repositories and the real Rules: a student with a long
 * history that lies outside the range of the report. What a report, an account history and an audit of one student read has to
 * follow what the screen shows (the range, the one student), not the history: it used to read every account of the range from
 * the opening, twice, and every command of the student, twice.
 *
 * The balance after each transaction is checked against an oracle that adds up the whole history from the opening, as the
 * repository used to; the repository now works back from the student's `currentBalance`.
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
if (required && !emulatorHost) throw new Error('P16f1 read reduction requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');

const OP = R02_OPERATOR;
const HISTORY = 300;
const OTHERS = 4;
const OTHER_ORDERS = 5;
/** What a read may spend beyond the documents it has to read: the head and lease fences of each page, the day, the roster pages. */
const FIXED = 60;
const studentL = uuid(980_000);
const others = Array.from({ length: OTHERS }, (_item, index) => uuid(980_100 + index));
const historyDay = shiftDay(today, -40);

let env: RulesTestEnvironment;
let nextId = 60_000;
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

describeWithEmulator('P16f1 read reduction: one student with a long history outside the range', () => {
  const user = operatorUser();
  const current = { currentUser: () => user };
  let app: Firestore;
  let writer: ReturnType<typeof createCloudCommandRepository>;
  let orders: ReturnType<typeof createCloudOrderRepository>;
  let closing: ReturnType<typeof createCloudDayCloseRepository>;
  let reads: ReturnType<typeof createCloudReadRepository>;
  let studentLToday = 0;
  let studentLCommandsToday = 0;
  let allToday = 0;
  const onToday = { kind: 'today' as const, startDate: today, endDate: today };
  const onHistoryDay = { kind: 'custom' as const, startDate: historyDay, endDate: historyDay };

  const ok = (result: { ok: boolean }, label: string) => { if (!result.ok) throw new Error(`P16f1 scenario: ${label} failed ${JSON.stringify(result)}`); };
  const revisions = async (studentId: string, dayId: string) => ({ student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${dayId}`)).revision });
  const order = async (studentId: string, dayId: string, note: string) => {
    const rev = await revisions(studentId, dayId);
    const transactionId = id();
    ok(await orders.createOrder({ commandId: id(), transactionId, leaseEpoch: epoch, studentId, dayId, expectedStudentRevision: rev.student,
      expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100, menuRevision: null, otherItemName: 'x', note }), 'CreateOrder');
    return transactionId;
  };
  const mutate = async (transactionId: string, studentId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => {
    const tx = await read(`transactions/${transactionId}`);
    ok(await orders.mutateTransaction({ commandId: id(), leaseEpoch: epoch, transactionId, studentId, dayId: today,
      expectedTransactionRevision: tx.revision, expectedStudentRevision: (await read(`students/${studentId}`)).revision,
      expectedDayRevision: (await read(`days/${today}`)).revision, ...spec } as CloudTransactionMutationInput), spec.kind);
  };
  const spent = async (run: () => Promise<unknown>) => {
    const { report } = await meter.measure(run, app);
    localStorage.clear();
    return report.billedReads;
  };
  /** The oracle: the balance after each transaction of a student, added up from the opening over the whole history in report order. */
  const oracle = async (studentId: string): Promise<Map<string, number>> => admin(async db => {
    const student = (await getDoc(doc(db, `students/${studentId}`))).data()!;
    const docs = (await getDocs(query(collection(db, 'transactions'), where('studentId', '==', studentId)))).docs
      .map(item => ({ id: item.id, data: item.data() }))
      .sort((a, b) => String(a.data.businessDate).localeCompare(String(b.data.businessDate))
        || (a.data.createdAt.seconds - b.data.createdAt.seconds) || (a.data.createdAt.nanoseconds - b.data.createdAt.nanoseconds)
        || a.id.localeCompare(b.id));
    let balance = student.openingBalance.amount as number;
    const balances = new Map<string, number>();
    for (const item of docs) {
      if (item.data.status === 'active') balance += item.data.type === 'refund' ? -item.data.amount : item.data.amount;
      balances.set(item.id, balance);
    }
    expect(balance, 'the oracle reaches the current balance').toBe(student.currentBalance);
    return balances;
  });

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(`${process.cwd()}/../firestore.rules`, 'utf8') },
    });
    await seedEmptySource(env, 'anonymous-p16f1-reads');
    await admin(async db => { await setDoc(doc(db, 'system/dataHead'), { goLiveDate: '2025-01-01' }, { merge: true }); });
    app = dbFor(OP);
    writer = createCloudCommandRepository(app, current);
    orders = createCloudOrderRepository(app, current);
    closing = createCloudDayCloseRepository(app, current);
    reads = createCloudReadRepository(app, current);

    ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: 0 }, payload: { businessDate: today } }), 'EnsureDay');
    ok(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: epoch, targets: { dayId: today },
      expectedRevisions: { day: (await read(`days/${today}`)).revision }, payload: { openingCash: 1000, reason: 'P16f1 fixture' } }), 'SetOpeningCash');
    for (const [index, studentId] of [studentL, ...others].entries()) {
      ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: epoch, targets: { studentId },
        expectedRevisions: { student: 0 }, payload: { studentCode: String(860_000 + index), displayName: `P16f1 student ${index}`, aliases: [],
          openingBalance: { amount: 500, asOfDate: '2025-01-01', note: '' } } }), 'CreateStudent');
    }

    // the history of studentL: a back-filled day that stays open, far outside the range of today's reports
    ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch, targets: { dayId: historyDay },
      expectedRevisions: { day: 0 }, payload: { businessDate: historyDay } }), 'EnsureDay history');
    ok(await closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId: historyDay,
      expectedDayRevision: (await read(`days/${historyDay}`)).revision, openingCash: 1000, reason: 'P16f1 fixture' }), 'BackfillOpeningCash');
    ok(await writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: epoch, targets: { dayId: historyDay },
      expectedRevisions: { day: (await read(`days/${historyDay}`)).revision }, payload: { reason: 'P16f1 fixture' } }), 'StartBackfill');
    for (let index = 0; index < HISTORY; index += 1) await order(studentL, historyDay, `紙本RR-${index}：x`);
    // The history is old: every command so far was committed 40 days ago (the Rules stamp the real time, which is today for all of
    // them), in the order of their sequence numbers, as it is in a shop that has run for a while.
    const historySeq = (await read('system/dataHead')).seq;
    await admin(async db => {
      const old = await getDocs(query(collection(db, 'commands'), where('seq', '<=', historySeq)));
      const base = Date.now() - 40 * 86_400_000;
      // a command document carries its commit time in the snapshots of what it changed too (the decoder checks they agree)
      const moved = (value: unknown, from: Timestamp, to: Timestamp): unknown => {
        if (value instanceof Timestamp) return value.isEqual(from) ? to : value;
        if (Array.isArray(value)) return value.map(item => moved(item, from, to));
        if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, moved(item, from, to)]));
        return value;
      };
      for (let start = 0; start < old.docs.length; start += 400) {
        const batch = writeBatch(db);
        for (const item of old.docs.slice(start, start + 400)) {
          const data = item.data();
          batch.set(item.ref, moved(data, data.committedAt, Timestamp.fromMillis(base + data.seq * 1000)) as Record<string, unknown>);
        }
        await batch.commit();
      }
    });

    // today: studentL has two orders, a payment and a refund that is voided; the others have a few orders each
    await order(studentL, today, '');
    await order(studentL, today, '');
    const paymentRev = await revisions(studentL, today);
    ok(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: epoch, studentId: studentL, dayId: today,
      expectedStudentRevision: paymentRev.student, expectedDayRevision: paymentRev.day, paidAmount: 30, note: '' }), 'CreatePayment');
    const refundRev = await revisions(studentL, today);
    const refundId = id();
    ok(await orders.createRefund({ commandId: id(), transactionId: refundId, leaseEpoch: epoch, studentId: studentL, dayId: today,
      expectedStudentRevision: refundRev.student, expectedDayRevision: refundRev.day, amount: 20, reason: 'P16f1 overpaid' }), 'CreateRefund');
    await mutate(refundId, studentL, { kind: 'VoidTransaction', payload: { reason: 'P16f1 typo' } });
    for (const studentId of others) for (let index = 0; index < OTHER_ORDERS; index += 1) await order(studentId, today, '');

    const count = (path: string, field: string, value: string) => admin(async db => (await getDocs(query(collection(db, path), where(field, '==', value)))).size);
    studentLToday = (await admin(async db => (await getDocs(query(collection(db, 'transactions'), where('studentId', '==', studentL), where('businessDate', '==', today)))).size));
    // the commands of studentL that the audit of today attributes to today: those dated today (its CreateStudent is old now)
    studentLCommandsToday = await admin(async db => (await getDocs(query(collection(db, 'commands'),
      where('studentId', '==', studentL), where('businessDate', '==', today)))).size);
    allToday = await count('transactions', 'businessDate', today);
    expect(studentLToday).toBe(4);
    expect(allToday).toBe(4 + OTHERS * OTHER_ORDERS);
  }, 900_000);
  afterAll(async () => { await env.cleanup(); });

  it('the report of today reads the transactions of today and no account history, and its balances are the oracle\'s', async () => {
    let report!: Awaited<ReturnType<typeof reads.readReport>>;
    const cost = await spent(async () => { report = await reads.readReport({ range: onToday, studentId: null, leaseEpoch: epoch }); });
    expect(report.transactions).toHaveLength(allToday);
    const expected = await oracle(studentL);
    for (const row of report.transactions.filter(item => item.studentId === studentL)) {
      expect(row.afterBalance, `balance after ${row.transactionId}`).toBe(expected.get(row.transactionId));
      expect(row.balanceApplicability).toBe('verified');
    }
    for (const studentId of others) {
      const balances = await oracle(studentId);
      for (const row of report.transactions.filter(item => item.studentId === studentId)) expect(row.afterBalance).toBe(balances.get(row.transactionId));
    }
    // the 300 transactions of the history are not read, twice, for studentL, nor are the others' 5
    expect(cost, `report of today read ${cost}`).toBeLessThanOrEqual(allToday + (OTHERS + 1) + FIXED);
  }, 120_000);

  it('the report of one student reads that student\'s transactions of the range, not the others\' and not the history', async () => {
    let report!: Awaited<ReturnType<typeof reads.readReport>>;
    const cost = await spent(async () => { report = await reads.readReport({ range: onToday, studentId: studentL, leaseEpoch: epoch }); });
    expect(report.transactions).toHaveLength(studentLToday);
    const expected = await oracle(studentL);
    for (const row of report.transactions) expect(row.afterBalance).toBe(expected.get(row.transactionId));
    // the roster is still read (the report page searches students in it): OTHERS + 1 documents
    expect(cost, `report of one student read ${cost}`).toBeLessThanOrEqual(studentLToday + (OTHERS + 1) + FIXED);
  }, 120_000);

  it('a report of an older range reads that range and what follows it, with the oracle\'s balances', async () => {
    let report!: Awaited<ReturnType<typeof reads.readReport>>;
    const cost = await spent(async () => { report = await reads.readReport({ range: onHistoryDay, studentId: null, leaseEpoch: epoch }); });
    expect(report.transactions).toHaveLength(HISTORY);
    const expected = await oracle(studentL);
    for (const row of report.transactions) expect(row.afterBalance).toBe(expected.get(row.transactionId));
    // the range, the days after it (today's transactions, for the balances), the roster; not the history again
    expect(cost, `report of the history day read ${cost}`).toBeLessThanOrEqual(HISTORY + allToday + (OTHERS + 1) + FIXED);
  }, 120_000);

  it('the account history of one student reads the student\'s transactions of the range and the student document only', async () => {
    let history!: Awaited<ReturnType<typeof reads.readAccountHistory>>;
    const cost = await spent(async () => { history = await reads.readAccountHistory({ range: onToday, studentId: studentL, leaseEpoch: epoch }); });
    expect(history.transactions).toHaveLength(studentLToday);
    const expected = await oracle(studentL);
    for (const row of history.transactions) expect(row.afterBalance).toBe(expected.get(row.transactionId));
    expect(history.currentBalance).toBe((await read(`students/${studentL}`)).currentBalance);
    expect(history.openingBalance).toBe(500);
    expect(cost, `account history read ${cost}`).toBeLessThanOrEqual(studentLToday + FIXED);
  }, 120_000);

  it('the range audit of one student reads the commands since the start of the range, not the whole history', async () => {
    let audit!: Awaited<ReturnType<typeof reads.readAuditRange>>;
    const cost = await spent(async () => { audit = await reads.readAuditRange({ range: onToday, studentId: studentL, leaseEpoch: epoch }); });
    expect(audit.rows).toHaveLength(studentLCommandsToday);
    expect(audit.rows.every(row => row.studentId === studentL)).toBe(true);
    // one page more than the commands of the range, to see that the next one is older than the range
    expect(cost, `range audit of one student read ${cost}`).toBeLessThanOrEqual(studentLCommandsToday + 100 + FIXED);
  }, 120_000);

  it('the range audit of the history day still finds every command of that day, however old they are', async () => {
    const audit = await reads.readAuditRange({ range: onHistoryDay, studentId: studentL, leaseEpoch: epoch });
    expect(audit.rows.filter(row => row.businessDate === historyDay)).toHaveLength(HISTORY);
    const seqs = audit.rows.map(row => row.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  }, 120_000);

  it('the audit of one student is the newest 100 commands, and the older ones follow page by page', async () => {
    const total = await admin(async db => (await getDocs(query(collection(db, 'commands'), where('studentId', '==', studentL)))).size);
    expect(total).toBeGreaterThan(HISTORY);
    const first = await reads.readAudit({ studentId: studentL, leaseEpoch: epoch });
    expect(first.rows).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const seqs = first.rows.map(row => row.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    const collected = [...first.rows];
    let page = first;
    while (page.hasMore) {
      page = await reads.readAudit({ studentId: studentL, leaseEpoch: epoch, beforeSeq: page.rows[0]!.seq });
      expect(page.rows.length).toBeLessThanOrEqual(100);
      expect(page.rows.at(-1)!.seq).toBeLessThan(collected[0]!.seq);
      collected.unshift(...page.rows);
    }
    expect(collected).toHaveLength(total);
    expect(new Set(collected.map(row => row.commandId)).size).toBe(total);
  }, 180_000);

  /** Every balance a read shows for studentL equals the oracle's, on the report of everyone, the report of the student and the account history. */
  const expectOracleBalances = async (range: { kind: 'custom'; startDate: string; endDate: string }) => {
    const expected = await oracle(studentL);
    const everyone = await reads.readReport({ range, studentId: null, leaseEpoch: epoch });
    const one = await reads.readReport({ range, studentId: studentL, leaseEpoch: epoch });
    const history = await reads.readAccountHistory({ range, studentId: studentL, leaseEpoch: epoch });
    const mine = everyone.transactions.filter(item => item.studentId === studentL);
    expect(mine.length).toBeGreaterThan(0);
    for (const rows of [mine, one.transactions, history.transactions]) {
      expect(rows.map(row => row.transactionId)).toEqual(mine.map(row => row.transactionId));
      for (const row of rows) expect(row.afterBalance, `balance after ${row.transactionId}`).toBe(expected.get(row.transactionId));
    }
    expect(history.currentBalance).toBe((await read(`students/${studentL}`)).currentBalance);
  };

  it('a CorrectTransaction changes the amount, and every balance after it still equals the oracle\'s', async () => {
    const [first] = (await admin(async db => (await getDocs(query(collection(db, 'transactions'),
      where('studentId', '==', studentL), where('businessDate', '==', today), where('type', '==', 'order')))).docs.map(item => item.id))).sort();
    const before = (await read(`transactions/${first}`)).amount as number;
    await mutate(first!, studentL, { kind: 'CorrectTransaction', payload: { mealPrice: 130, paidAmount: 100, amount: -30, note: '', reason: 'P16f2 oracle correction' } });
    expect((await read(`transactions/${first}`)).amount).not.toBe(before);
    await expectOracleBalances({ kind: 'custom', startDate: today, endDate: today });
  }, 180_000);

  it('L07: a day closed and reopened before today can be corrected, and the balances across it equal the oracle\'s', async () => {
    const dayC = shiftDay(today, -20);
    ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: epoch, targets: { dayId: dayC },
      expectedRevisions: { day: 0 }, payload: { businessDate: dayC } }), 'EnsureDay closed day');
    ok(await closing.backfillOpening({ commandId: id(), leaseEpoch: epoch, dayId: dayC,
      // two orders of 100 end the day on 1000, the opening of today, which the close of a back-filled day has to meet
      expectedDayRevision: (await read(`days/${dayC}`)).revision, openingCash: 800, reason: 'P16f2 fixture' }), 'BackfillOpeningCash');
    ok(await writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: epoch, targets: { dayId: dayC },
      expectedRevisions: { day: (await read(`days/${dayC}`)).revision }, payload: { reason: 'P16f2 fixture' } }), 'StartBackfill');
    const transactionId = await order(studentL, dayC, '紙本RR-C：x');
    await order(studentL, dayC, '紙本RR-D：x');
    const dayRevision = async () => (await read(`days/${dayC}`));
    const expectedCash = (await closing.read(dayC))!.expectedCash!;
    ok(await closing.closeDay({ commandId: id(), leaseEpoch: epoch, dayId: dayC, expectedDayRevision: (await dayRevision()).revision,
      expectedSettlementRevision: (await dayRevision()).lastSettlementRevision, expectedCash, countedCash: expectedCash, note: '', alignWithDayId: today }), 'CloseDay');
    ok(await closing.reopenDay({ commandId: id(), leaseEpoch: epoch, dayId: dayC, expectedDayRevision: (await dayRevision()).revision,
      expectedSettlementRevision: (await dayRevision()).lastSettlementRevision, reason: 'P16f2 reopen to correct' }), 'ReopenDay');
    const tx = await read(`transactions/${transactionId}`);
    ok(await orders.mutateTransaction({ commandId: id(), leaseEpoch: epoch, transactionId, studentId: studentL, dayId: dayC,
      expectedTransactionRevision: tx.revision, expectedStudentRevision: (await read(`students/${studentL}`)).revision,
      expectedDayRevision: (await dayRevision()).revision, kind: 'CorrectTransaction',
      payload: { mealPrice: 95, paidAmount: 100, amount: 5, note: tx.note, reason: 'P16f2 L07 correction' } } as CloudTransactionMutationInput), 'CorrectTransaction on a reopened day');
    // a range that starts on the reopened day: the history day before it (40 days ago) is outside, and still part of the balance
    await expectOracleBalances({ kind: 'custom', startDate: dayC, endDate: today });
  }, 240_000);
});
