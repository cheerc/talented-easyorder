// @ts-expect-error Node-only path utility used by the Emulator test.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path utility used by the Emulator test.
import path from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import {
  Timestamp,
  deleteDoc,
  doc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCloudReadRepository } from '../cloudReadRepository';
import { createCloudOrderRepository } from '../cloudOrderRepository';
import { createCloudReportActionRepository } from '../cloudReportActionRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_REPORTS === 'true';
if (required && !emulatorHost) throw new Error('P12a cloud report Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? path.resolve(process.cwd(), '../firestore.rules'));

const operator = { uid: 'p12a-report-operator', email: 'p12a-report@example.test' };
const studentA = '11111111-1111-4111-8111-111111111111';
const studentB = '22222222-2222-4222-8222-222222222222';
const seedCommandId = '00000000-0000-4000-8000-000000000012';
const upperId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const lowerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nanosEarlierId = 'FFFFFFFF-FFFF-4FFF-8FFF-FFFFFFFFFFFF';
const nanosLaterId = '00000000-0000-4000-8000-000000000002';

let env: RulesTestEnvironment;
let today = '';
let prior = '';
let goLiveDate = '';

function taipeiDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
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

function fakeCurrentUser() {
  return {
    uid: operator.uid,
    email: operator.email,
    emailVerified: true,
    providerData: [{ providerId: 'google.com' }],
  } as unknown as User;
}

function authedDb(): Firestore {
  return env.authenticatedContext(operator.uid, {
    email: operator.email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

function repository(options: { afterPageRead?: (event: { collection: string; page: number }) => Promise<void> } = {}) {
  return createCloudReadRepository(authedDb(), {
    currentUser: fakeCurrentUser,
    ...options,
  });
}

function uuidFrom(number: number): string {
  const value = number.toString(16).padStart(12, '0');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4000-8000-${value.padStart(12, '0')}`;
}

function tx(
  id: string,
  studentId: string,
  businessDate: string,
  createdSeq: number,
  type: 'order' | 'payment' | 'expense' | 'refund',
  overrides: Record<string, unknown> = {},
) {
  const order = type === 'order';
  const expense = type === 'expense';
  const refund = type === 'refund';
  const timestamp = Timestamp.fromDate(new Date(`${businessDate}T04:00:00.000Z`));
  const mealPrice = order ? 5 : expense ? 2 : 0;
  const paidAmount = type === 'order' ? 3 : type === 'payment' ? 5 : 0;
  return {
    transactionId: id,
    studentId,
    businessDate,
    type,
    mealKind: order ? 'bento' : null,
    mealPrice,
    paidAmount,
    amount: refund ? 4 : paidAmount - mealPrice,
    studentNameSnapshot: expense ? '櫃台' : studentId === studentA ? '舊姓名甲' : '舊姓名乙',
    menuNameSnapshot: order ? '合成餐盒' : '',
    menuPriceSnapshot: order ? 5 : 0,
    vendorIdSnapshot: order ? 'p12-vendor' : '',
    vendorNameSnapshot: order ? '合成供應商' : '',
    otherItemName: null,
    status: 'active',
    revision: 1,
    createdAt: timestamp,
    createdSeq,
    operatorUid: operator.uid,
    operatorEmail: operator.email,
    sourceDevice: 'pc',
    note: refund ? 'Synthetic refund' : expense ? 'Synthetic cash expense' : '',
    lastCommandId: seedCommandId,
    updatedAt: timestamp,
    ...overrides,
  };
}

function student(id: string, code: string, openingBalance: number, currentBalance: number) {
  return {
    studentId: id,
    studentCode: code,
    displayName: id === studentA ? '新姓名甲' : '新姓名乙',
    aliases: [id === studentA ? '甲別名' : '乙別名'],
    status: 'active',
    openingBalance: {
      amount: openingBalance, asOfDate: shiftDate(today, -10), note: '', createdAt: serverTimestamp(),
    },
    currentBalance,
    createdAt: serverTimestamp(),
    revision: 1,
    lastCommandId: seedCommandId,
    updatedAt: serverTimestamp(),
  };
}

function day(totals: Record<string, number>) {
  return {
    status: 'open', revision: 1, menu: null,
    openingCash: null, openedBy: null, openedAt: null,
    totals: {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
      ...totals,
    },
    lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: serverTimestamp(),
  };
}

function closedDay(totals: Record<string, number>) {
  return {
    status: 'closed', revision: 4, menu: null,
    openingCash: 100, openedBy: operator.uid,
    openedAt: Timestamp.fromDate(new Date(`${prior}T12:00:00.000Z`)),
    totals: {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
      ...totals,
    },
    lastSettlementRevision: 3, lastCommandId: uuidFrom(1_003), updatedAt: serverTimestamp(),
  };
}

function settlement(revision: number, status: 'closed' | 'reopened', countedCash: number | null, difference: number | null) {
  const totals = {
    activeTransactionCount: 3, bentoCount: 1, otherMealCount: 0, mealTotal: 5,
    retainedReceipts: 21, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
  };
  return {
    dayId: prior, revision, status, totals, openingCash: 100, expectedCash: 121,
    countedCash, difference, note: status === 'reopened' ? '重新核對' : '',
    actorUid: operator.uid, actorEmail: operator.email, sourceSeq: 190 + revision,
    committedAt: Timestamp.fromDate(new Date(`${prior}T${String(12 + revision).padStart(2, '0')}:00:00.000Z`)),
    previousRevision: revision - 1, lastCommandId: uuidFrom(1_000 + revision),
  };
}

function head(seq: number) {
  return {
    schemaVersion: 1, datasetId: 'p12a-report-dataset', seq, lastCommandId: seedCommandId,
    maintenance: false, goLiveDate, updatedAt: serverTimestamp(),
  };
}

async function seedReportFixture() {
  today = taipeiDate(new Date());
  prior = shiftDate(today, -2);
  goLiveDate = shiftDate(today, -30);
  await withAdmin(async db => {
    const batch = (await import('firebase/firestore')).writeBatch(db);
    batch.set(doc(db, `operators/${operator.uid}`), {
      uid: operator.uid, email: operator.email, displayName: 'Synthetic P12a', active: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'system/accessLease'), { holderUid: operator.uid, epoch: 7, updatedAt: serverTimestamp() });
    batch.set(doc(db, 'system/dataHead'), head(205));
    batch.set(doc(db, `students/${studentA}`), student(studentA, '001', 1_000, 630));
    batch.set(doc(db, `students/${studentB}`), student(studentB, '002', -50, -57));
    batch.set(doc(db, `days/${today}`), day({
      activeTransactionCount: 200, bentoCount: 197, mealTotal: 985, retainedReceipts: 596,
      cashierExpense: 2, accountRefunds: 4,
    }));
    batch.set(doc(db, `days/${prior}`), closedDay({
      activeTransactionCount: 3, bentoCount: 1, mealTotal: 5, retainedReceipts: 21,
    }));
    batch.set(doc(db, `backfillDays/${prior}`), {
      dayId: prior, reason: 'Synthetic backfill marker', startedBy: operator.uid,
      startedAt: serverTimestamp(), commandId: uuidFrom(1_010),
    });
    for (const version of [
      settlement(1, 'closed', 121, 0),
      settlement(2, 'reopened', null, null),
      settlement(3, 'closed', 125, 4),
    ]) batch.set(doc(db, `days/${prior}/settlements/${version.revision}`), version);
    const oldEntry = uuidFrom(1_020);
    const currentIncome = uuidFrom(1_021);
    const currentExpense = uuidFrom(1_022);
    batch.set(doc(db, `postCloseEntries/${oldEntry}`), {
      entryId: oldEntry, dayId: prior, settlementRevision: 1, direction: 'income', amount: 100,
      reason: '\u3000', createdBy: operator.uid,
      createdAt: Timestamp.fromDate(new Date(`${prior}T15:00:00.000Z`)), commandId: oldEntry,
    });
    batch.set(doc(db, `postCloseEntries/${currentIncome}`), {
      entryId: currentIncome, dayId: prior, settlementRevision: 3, direction: 'income', amount: 15,
      reason: 'Synthetic current income', createdBy: operator.uid,
      createdAt: Timestamp.fromDate(new Date(`${prior}T16:00:00.000Z`)), commandId: currentIncome,
    });
    batch.set(doc(db, `postCloseEntries/${currentExpense}`), {
      entryId: currentExpense, dayId: prior, settlementRevision: 3, direction: 'expense', amount: 5,
      reason: 'Synthetic current expense', createdBy: operator.uid,
      createdAt: Timestamp.fromDate(new Date(`${prior}T17:00:00.000Z`)), commandId: currentExpense,
    });
    let seq = 1;
    const orderIds = Array.from({ length: 196 }, (_, index) => uuidFrom(index + 100));
    orderIds[0] = upperId;
    orderIds[1] = lowerId;
    orderIds[2] = nanosEarlierId;
    orderIds[3] = nanosLaterId;
    orderIds.forEach(id => {
      const record = tx(id, studentA, today, seq++, 'order');
      if (id === nanosEarlierId) record.createdAt = new Timestamp(record.createdAt.seconds, 1_001_000);
      if (id === nanosLaterId) record.createdAt = new Timestamp(record.createdAt.seconds, 1_009_000);
      if (id === upperId || id === lowerId) record.createdAt = Timestamp.fromDate(new Date(`${today}T04:00:00.000Z`));
      batch.set(doc(db, `transactions/${id}`), record);
    });
    batch.set(doc(db, `transactions/${uuidFrom(800)}`), tx(uuidFrom(800), studentB, today, seq++, 'order'));
    batch.set(doc(db, `transactions/${uuidFrom(801)}`), tx(uuidFrom(801), studentA, today, seq++, 'payment'));
    batch.set(doc(db, `transactions/${uuidFrom(802)}`), tx(uuidFrom(802), studentA, today, seq++, 'refund'));
    batch.set(doc(db, `transactions/${uuidFrom(803)}`), tx(uuidFrom(803), '__cashier__', today, seq++, 'expense'));
    batch.set(doc(db, `transactions/${uuidFrom(804)}`), tx(uuidFrom(804), studentA, today, seq++, 'order', { status: 'voided' }));
    batch.set(doc(db, `transactions/${uuidFrom(805)}`), tx(uuidFrom(805), studentA, prior, seq++, 'payment', {
      amount: 20, paidAmount: 20,
    }));
    batch.set(doc(db, `transactions/${uuidFrom(806)}`), tx(uuidFrom(806), studentB, prior, seq++, 'order', {
      mealPrice: 5, paidAmount: 0, amount: -5,
    }));
    batch.set(doc(db, `transactions/${uuidFrom(807)}`), tx(uuidFrom(807), studentA, prior, seq++, 'payment', {
      amount: 1, paidAmount: 1,
      createdAt: Timestamp.fromDate(new Date(`${today}T04:00:00.000Z`)),
      updatedAt: Timestamp.fromDate(new Date(`${today}T04:00:00.000Z`)),
    }));
    await batch.commit();
  });
}

describeWithEmulator('P12a complete cloud report reads and rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: {
        rules: readFileSync(rulesPath, 'utf8'),
        host: emulatorHost!.split(':')[0],
        port: Number(emulatorHost!.split(':')[1] || '8080'),
      },
    });
  }, 30_000);

  beforeEach(async () => {
    await env.clearFirestore();
    await seedReportFixture();
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  it('reads every day row and every represented account prefix for all-scope output', async () => {
    const range = { kind: 'custom' as const, startDate: today, endDate: today };
    const report = await repository().readReport({ range, studentId: null, leaseEpoch: 7 });

    expect(report).toMatchObject({
      datasetId: 'p12a-report-dataset', sourceSeq: 205, leaseEpoch: 7,
      range, scope: { studentId: null }, complete: true,
      summary: {
        activeTransactionCount: 200, orderCount: 197, bentoCount: 197, mealTotal: 985,
        orderUnpaid: null, totalIncome: 596, totalExpense: 2, totalRefund: 4, netCash: 590,
      },
    });
    expect(report.transactions).toHaveLength(201);
    expect(report.transactions.find(row => row.transactionId === upperId)?.afterBalance).toBeDefined();
    expect(report.transactions.find(row => row.transactionId === uuidFrom(800))?.afterBalance).toBe(-57);
    expect(report.transactions.find(row => row.studentId === '__cashier__')).not.toHaveProperty('afterBalance');
    expect(report.transactions.find(row => row.studentId === '__cashier__')).toMatchObject({
      balanceApplicability: 'not-applicable',
    });
    const studentARows = report.transactions.filter(row => row.studentId === studentA);
    const voidedIndex = studentARows.findIndex(row => row.transactionId === uuidFrom(804));
    expect(studentARows[voidedIndex]).toMatchObject({ status: 'voided' });
    expect(studentARows[voidedIndex].afterBalance).toBe(studentARows[voidedIndex - 1].afterBalance);
    expect(studentARows.at(-1)?.afterBalance).toBe(630);
    const ids = report.transactions.map(row => row.transactionId);
    expect(ids.indexOf(nanosEarlierId)).toBeLessThan(ids.indexOf(nanosLaterId));
    expect(ids.indexOf(upperId)).toBeLessThan(ids.indexOf(lowerId));
    expect(report.mergedTransactions.every(group => group.transactionIds.length > 0)).toBe(true);
    expect(report.mergedTransactions.find(row => row.kind === 'merged-order' && row.studentId === studentA)).toMatchObject({
      orderCount: 196, transactionIds: expect.arrayContaining([uuidFrom(801)]), afterBalance: 630,
    });
    expect(report.students).toEqual(expect.arrayContaining([
      expect.objectContaining({ studentId: studentA, studentCode: '001', displayName: '新姓名甲' }),
      expect.objectContaining({ studentId: studentB, studentCode: '002', displayName: '新姓名乙' }),
    ]));
  });

  it('filters displayed rows after full-day reconciliation and keeps full-day summary totals', async () => {
    const report = await repository().readReport({
      range: { kind: 'custom', startDate: today, endDate: today }, studentId: studentB, leaseEpoch: 7,
    });
    expect(report.transactions.map(row => row.studentId)).toEqual([studentB]);
    expect(report.transactions[0].afterBalance).toBe(-57);
    expect(report.summary.activeTransactionCount).toBe(200);
  });

  it('builds a range summary from day heads and keeps cash stock out of flow totals', async () => {
    const summary = await repository().readSummary({
      range: { kind: 'custom', startDate: prior, endDate: today }, leaseEpoch: 7,
    });
    expect(summary.days).toHaveLength(3);
    expect(summary.days.map(day => day.exists)).toEqual([true, false, true]);
    expect(summary.days[0]).toMatchObject({ status: 'closed', effectiveCash: 135 });
    expect(summary.summary).toMatchObject({
      activeTransactionCount: 203, orderCount: 198, bentoCount: 198, mealTotal: 990,
      orderUnpaid: null, totalIncome: 617, totalExpense: 2, totalRefund: 4, netCash: 611,
    });
    expect(summary.transactions).toEqual([]);
    expect(summary.mergedTransactions).toEqual([]);
  });

  it('reconciles the full day before returning only selected account history', async () => {
    const history = await repository().readAccountHistory({
      studentId: studentA,
      range: { kind: 'custom', startDate: today, endDate: today },
      leaseEpoch: 7,
    });
    expect(history).toMatchObject({ complete: true, currentBalance: 630, openingBalance: 1_000, sourceSeq: 205 });
    expect(history.transactions).toHaveLength(199);
    expect(history.transactions.every(row => row.studentId === studentA)).toBe(true);
    expect(history.transactions.every(row => row.afterBalance !== undefined && row.balanceApplicability === 'verified')).toBe(true);
    expect(history.transactions.find(row => row.status === 'voided')?.afterBalance).toBeDefined();
  });

  it('preserves closed backfill history, all settlement versions, and old versus current post-close entries', async () => {
    const report = await repository().readReport({
      range: { kind: 'custom', startDate: prior, endDate: prior }, studentId: null, leaseEpoch: 7,
    });
    expect(report.days[0]).toMatchObject({
      exists: true, status: 'closed', lastSettlementRevision: 3,
      backfillReason: 'Synthetic backfill marker', effectiveCash: 135,
    });
    expect(report.days[0].settlements.map(row => [row.revision, row.status])).toEqual([
      [1, 'closed'], [2, 'reopened'], [3, 'closed'],
    ]);
    expect(report.days[0].postCloseEntries).toHaveLength(3);
    expect(report.days[0].postCloseEntries.map(row => [row.settlementRevision, row.countedInEffectiveCash]))
      .toEqual([[1, false], [3, true], [3, true]]);
    expect(report.days[0].postCloseEntries.find(row => row.settlementRevision === 1)?.reason).toBe('\u3000');
    expect(report.transactions.find(row => row.transactionId === uuidFrom(807))).toMatchObject({
      backfilled: true, afterBalance: 1_021,
    });
    expect(report.summary).toMatchObject({ activeTransactionCount: 3, bentoCount: 1, mealTotal: 5, orderUnpaid: null });
  });

  it('fails closed if any represented account prefix does not reconcile', async () => {
    await withAdmin(async db => {
      await setDoc(doc(db, `students/${studentB}`), student(studentB, '002', -50, -56));
    });
    await expect(repository().readReport({
      range: { kind: 'custom', startDate: today, endDate: today }, studentId: null, leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
  });

  it('fails closed when transactions exist without their day projection', async () => {
    await withAdmin(async db => {
      await deleteDoc(doc(db, `days/${today}`));
    });
    await expect(repository().readReport({
      range: { kind: 'custom', startDate: today, endDate: today }, studentId: null, leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
  });

  it('fails closed from single-account history when the visible day projection is missing', async () => {
    const range = { kind: 'custom' as const, startDate: today, endDate: today };
    await withAdmin(async db => {
      await deleteDoc(doc(db, `days/${today}`));
    });

    await expect(repository().readAccountHistory({ studentId: studentA, range, leaseEpoch: 7 }))
      .rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
    await expect(repository().readReport({ studentId: studentA, range, leaseEpoch: 7 }))
      .rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
  });

  it('returns an empty history for a fully queried day with no day document, transactions, or marker', async () => {
    const emptyDay = shiftDate(today, -1);
    const range = { kind: 'custom' as const, startDate: emptyDay, endDate: emptyDay };
    const [history, report] = await Promise.all([
      repository().readAccountHistory({ studentId: studentA, range, leaseEpoch: 7 }),
      repository().readReport({ studentId: studentA, range, leaseEpoch: 7 }),
    ]);

    expect(history).toMatchObject({ complete: true, currentBalance: 630, transactions: [] });
    expect(report).toMatchObject({ complete: true, scope: { studentId: studentA }, transactions: [] });
  });

  it('fails closed from single-account history when day totals omit all transactions', async () => {
    const range = { kind: 'custom' as const, startDate: today, endDate: today };
    await withAdmin(async db => {
      await setDoc(doc(db, `days/${today}`), day({}));
    });

    await expect(repository().readAccountHistory({ studentId: studentA, range, leaseEpoch: 7 }))
      .rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
    await expect(repository().readReport({ studentId: studentA, range, leaseEpoch: 7 }))
      .rejects.toMatchObject({ code: 'RECONCILIATION_FAILED' });
  });

  it.each(['closed', 'reopened'] as const)(
    'rejects a %s day with no settlement revision from summary and account history', async status => {
      const range = { kind: 'custom' as const, startDate: prior, endDate: prior };
      await withAdmin(async db => {
        await setDoc(doc(db, `days/${prior}`), {
          ...closedDay({ activeTransactionCount: 3, bentoCount: 1, mealTotal: 5, retainedReceipts: 21 }),
          status,
          lastSettlementRevision: 0,
        });
        await Promise.all([1, 2, 3].map(revision => deleteDoc(doc(db, `days/${prior}/settlements/${revision}`))));
      });

      await expect(repository().readSummary({ range, leaseEpoch: 7 }))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
      await expect(repository().readAccountHistory({ studentId: studentA, range, leaseEpoch: 7 }))
        .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
    },
  );

  it('accepts a verified closed day whose effective cash is exactly zero', async () => {
    const emptyDay = shiftDate(today, -1);
    const range = { kind: 'custom' as const, startDate: emptyDay, endDate: emptyDay };
    const zeroTotals = {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
    };
    await withAdmin(async db => {
      await setDoc(doc(db, `days/${emptyDay}`), {
        ...day(zeroTotals),
        status: 'closed',
        revision: 2,
        openingCash: 0,
        openedBy: operator.uid,
        openedAt: Timestamp.fromDate(new Date(`${emptyDay}T12:00:00.000Z`)),
        lastSettlementRevision: 1,
      });
      await setDoc(doc(db, `days/${emptyDay}/settlements/1`), {
        dayId: emptyDay,
        revision: 1,
        status: 'closed',
        totals: zeroTotals,
        openingCash: 0,
        expectedCash: 0,
        countedCash: 0,
        difference: 0,
        note: '',
        actorUid: operator.uid,
        actorEmail: operator.email,
        sourceSeq: 200,
        committedAt: Timestamp.fromDate(new Date(`${emptyDay}T13:00:00.000Z`)),
        previousRevision: 0,
        lastCommandId: uuidFrom(1_030),
      });
    });

    const summary = await repository().readSummary({ range, leaseEpoch: 7 });
    expect(summary.days[0]).toMatchObject({
      exists: true,
      status: 'closed',
      lastSettlementRevision: 1,
      effectiveCash: 0,
      settlements: [{ revision: 1, countedCash: 0, difference: 0 }],
    });
  });

  it('validates the expected lease epoch before reading a report', async () => {
    await expect(repository().readSummary({
      range: { kind: 'custom', startDate: today, endDate: today }, leaseEpoch: 6,
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });
  });

  it('reads day and account command audits completely across cursor pages', async () => {
    const writer = createCloudOrderRepository(authedDb(), { currentUser: fakeCurrentUser });
    for (let index = 0; index < 2; index += 1) {
      const result = await writer.createPayment({
        commandId: uuidFrom(9_000 + index * 2),
        transactionId: uuidFrom(9_001 + index * 2),
        leaseEpoch: 7,
        studentId: studentA,
        dayId: today,
        expectedStudentRevision: index + 1,
        expectedDayRevision: index + 1,
        paidAmount: 1,
        note: `Synthetic audit ${index + 1}`,
      });
      expect(result.ok).toBe(true);
    }
    const auditor = createCloudReadRepository(authedDb(), { currentUser: fakeCurrentUser, pageSize: 1 });
    const [dayAudit, accountAudit] = await Promise.all([
      auditor.readAudit({ dayId: today, leaseEpoch: 7 }),
      auditor.readAudit({ studentId: studentA, leaseEpoch: 7 }),
    ]);
    expect(dayAudit.rows.map(row => [row.kind, row.seq, row.reason])).toEqual([
      ['CreatePayment', 206, null], ['CreatePayment', 207, null],
    ]);
    expect(accountAudit.rows.map(row => row.commandId)).toEqual(dayAudit.rows.map(row => row.commandId));
    expect(dayAudit.rows[0].before).toHaveProperty('head');
    expect(dayAudit.rows[1].after).toHaveProperty('transaction');
  });

  it('reads a complete range audit at one head and attributes null-date commands by Taipei record date', async () => {
    const orders = createCloudOrderRepository(authedDb(), { currentUser: fakeCurrentUser });
    const payment = await orders.createPayment({
      commandId: uuidFrom(9_100),
      transactionId: uuidFrom(9_101),
      leaseEpoch: 7,
      studentId: studentA,
      dayId: today,
      expectedStudentRevision: 1,
      expectedDayRevision: 1,
      paidAmount: 1,
      note: 'Synthetic range audit',
    });
    expect(payment.ok).toBe(true);

    const actions = createCloudReportActionRepository(authedDb(), { currentUser: fakeCurrentUser });
    for (const commandId of [uuidFrom(9_102), uuidFrom(9_103)]) {
      expect(await actions.recordExport({
        commandId,
        leaseEpoch: 7,
        range: { kind: 'custom', startDate: today, endDate: today },
        scope: { studentId: null },
        sourceSeq: 206,
        exportType: 'audit',
      })).toMatchObject({ ok: true });
    }

    const queryTrace: Array<import('../cloudReadRepository').CloudReadPageEvent> = [];
    const audit = await createCloudReadRepository(authedDb(), {
      currentUser: fakeCurrentUser,
      pageSize: 1,
      afterPageRead: async event => { queryTrace.push(event); },
    }).readAuditRange({
      range: { kind: 'custom', startDate: today, endDate: today },
      studentId: null,
      leaseEpoch: 7,
    });

    expect(audit).toMatchObject({
      datasetId: 'p12a-report-dataset', sourceSeq: 208, leaseEpoch: 7,
      range: { startDate: today, endDate: today }, scope: { studentId: null }, complete: true,
    });
    expect(audit.rows.map(row => [row.kind, row.seq])).toEqual([
      ['CreatePayment', 206], ['RecordExport', 207], ['RecordExport', 208],
    ]);
    expect(audit.rows.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        businessDate: null,
        attributedDate: today,
        dateBasis: 'committed-at',
      }),
    ]));

    const accountAudit = await createCloudReadRepository(authedDb(), { currentUser: fakeCurrentUser })
      .readAuditRange({
        range: { kind: 'custom', startDate: today, endDate: today },
        studentId: studentA,
        leaseEpoch: 7,
      });
    expect(accountAudit.rows.map(row => row.kind)).toEqual(['CreatePayment']);
  });

  it('uses Taipei midnight as inclusive start and exclusive end for null-date server queries', async () => {
    const actions = createCloudReportActionRepository(authedDb(), { currentUser: fakeCurrentUser });
    const commandIds = [uuidFrom(9_200), uuidFrom(9_201), uuidFrom(9_202), uuidFrom(9_203)];
    for (const commandId of commandIds) {
      expect(await actions.recordExport({
        commandId,
        leaseEpoch: 7,
        range: { kind: 'custom', startDate: '2026-10-18', endDate: '2026-10-18' },
        scope: { studentId: null },
        sourceSeq: 205,
        exportType: 'audit',
      })).toMatchObject({ ok: true });
    }
    const timestamps = [
      '2026-10-17T15:59:59.999Z', // Taipei 2026-10-17 23:59:59.999: before range
      '2026-10-17T16:00:00.000Z', // Taipei 2026-10-18 00:00:00: included
      '2026-10-18T15:59:59.999Z', // Taipei 2026-10-18 23:59:59.999: included
      '2026-10-18T16:00:00.000Z', // Taipei 2026-10-19 00:00:00: exclusive end
    ];
    const authDb = authedDb();
    const rawCommands = await Promise.all(commandIds.map(async commandId => {
      const snapshot = await getDocFromServer(doc(authDb, `commands/${commandId}`));
      if (!snapshot.exists()) throw new Error(`missing test command ${commandId}`);
      return { commandId, raw: snapshot.data() };
    }));
    await withAdmin(async db => {
      for (const [index, item] of rawCommands.entries()) {
        const committedAt = Timestamp.fromDate(new Date(timestamps[index]));
        const after = item.raw.after as Record<string, unknown>;
        const afterHead = after.head as Record<string, unknown>;
        await setDoc(doc(db, `commands/${item.commandId}`), {
          ...item.raw,
          committedAt,
          after: { ...after, head: { ...afterHead, updatedAt: committedAt } },
        });
      }
    });

    const queryTrace: Array<import('../cloudReadRepository').CloudReadPageEvent> = [];
    const audit = await createCloudReadRepository(authedDb(), {
      currentUser: fakeCurrentUser,
      pageSize: 1,
      afterPageRead: async event => { queryTrace.push(event); },
    }).readAuditRange({
      range: { kind: 'custom', startDate: '2026-10-18', endDate: '2026-10-18' },
      studentId: null,
      leaseEpoch: 7,
    });
    expect(audit.rows.map(row => row.commandId)).toEqual(commandIds.slice(1, 3));
    expect(audit.rows.map(row => [row.businessDate, row.attributedDate, row.dateBasis])).toEqual([
      [null, '2026-10-18', 'committed-at'],
      [null, '2026-10-18', 'committed-at'],
    ]);
    const nullDateQueries = queryTrace.filter(event => event.queryScope === 'null-date-audit-range');
    expect(nullDateQueries.length).toBeGreaterThan(1);
    expect(nullDateQueries.every(event => event.committedAtRange?.startInclusive === '2026-10-17T16:00:00.000Z'
      && event.committedAtRange.end === '2026-10-18T16:00:00.000Z'
      && event.committedAtRange.endInclusive === false)).toBe(true);
  });

  it('keeps short null-date queries bounded despite large legal activity outside the requested dates', async () => {
    const actions = createCloudReportActionRepository(authedDb(), { currentUser: fakeCurrentUser });
    for (let index = 0; index < 101; index += 1) {
      expect(await actions.recordExport({
        commandId: uuidFrom(10_000 + index),
        leaseEpoch: 7,
        range: { kind: 'custom', startDate: '2020-01-01', endDate: '2020-01-01' },
        scope: { studentId: null },
        sourceSeq: 205,
        exportType: 'audit',
      })).toMatchObject({ ok: true });
    }
    const queryTrace: Array<import('../cloudReadRepository').CloudReadPageEvent> = [];
    const audit = await createCloudReadRepository(authedDb(), {
      currentUser: fakeCurrentUser,
      pageSize: 1,
      afterPageRead: async event => { queryTrace.push(event); },
    }).readAuditRange({
      range: { kind: 'custom', startDate: '2019-12-31', endDate: '2020-01-01' },
      studentId: null,
      leaseEpoch: 7,
    });

    expect(audit.rows).toEqual([]);
    const commandPages = queryTrace.filter(event => event.collection === 'commands');
    expect(commandPages).toHaveLength(5); // one empty page for each day query/proof, plus one bounded null-date query
    const boundedQueries = commandPages.filter(event => event.queryScope === 'null-date-audit-range');
    expect(boundedQueries).toHaveLength(1);
    expect(boundedQueries[0].committedAtRange).toEqual({
      startInclusive: '2019-12-30T16:00:00.000Z',
      end: '2020-01-01T16:00:00.000Z',
      endInclusive: false,
    });
    expect(commandPages.filter(event => event.queryScope === undefined)).toHaveLength(4);
  });

  it('documents that null-date rows missing committedAt are outside the bounded query index', async () => {
    const commandId = uuidFrom(9_300);
    const actions = createCloudReportActionRepository(authedDb(), { currentUser: fakeCurrentUser });
    expect(await actions.recordExport({
      commandId,
      leaseEpoch: 7,
      range: { kind: 'custom', startDate: today, endDate: today },
      scope: { studentId: null },
      sourceSeq: 205,
      exportType: 'audit',
    })).toMatchObject({ ok: true });
    const snapshot = await getDocFromServer(doc(authedDb(), `commands/${commandId}`));
    if (!snapshot.exists()) throw new Error(`missing test command ${commandId}`);
    const malformed = { ...snapshot.data() };
    delete malformed.committedAt;
    await withAdmin(db => setDoc(doc(db, `commands/${commandId}`), malformed));

    const queryTrace: Array<import('../cloudReadRepository').CloudReadPageEvent> = [];
    const snapshotResult = await createCloudReadRepository(authedDb(), {
      currentUser: fakeCurrentUser,
      afterPageRead: async event => { queryTrace.push(event); },
    }).readAuditRange({
      range: { kind: 'custom', startDate: today, endDate: today },
      studentId: null,
      leaseEpoch: 7,
    });
    expect(snapshotResult.rows.some(row => row.commandId === commandId)).toBe(false);
    expect(queryTrace.filter(event => event.queryScope === 'null-date-audit-range')).toEqual([
      expect.objectContaining({
        committedAtRange: {
          startInclusive: `${shiftDate(today, -1)}T16:00:00.000Z`,
          end: `${today}T16:00:00.000Z`,
          endInclusive: false,
        },
      }),
    ]);
  });

  it('rejects a range audit when the fixed data head changes between account audit pages', async () => {
    const writer = createCloudOrderRepository(authedDb(), { currentUser: fakeCurrentUser });
    for (let index = 0; index < 2; index += 1) {
      expect(await writer.createPayment({
        commandId: uuidFrom(9_400 + index * 2),
        transactionId: uuidFrom(9_401 + index * 2),
        leaseEpoch: 7,
        studentId: studentA,
        dayId: today,
        expectedStudentRevision: index + 1,
        expectedDayRevision: index + 1,
        paidAmount: 1,
        note: `Synthetic moving head ${index + 1}`,
      })).toMatchObject({ ok: true });
    }
    let changed = false;
    const repo = createCloudReadRepository(authedDb(), {
      currentUser: fakeCurrentUser,
      pageSize: 1,
      afterPageRead: async event => {
        if (event.collection !== 'commands' || event.page !== 1 || changed) return;
        changed = true;
        await withAdmin(db => setDoc(doc(db, 'system/dataHead'), head(208)));
      },
    });
    await expect(repo.readAuditRange({
      range: { kind: 'custom', startDate: today, endDate: today },
      studentId: studentA,
      leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(changed).toBe(true);
  });

  it('fails closed when an in-scope audit document is omitted because its sequence field is missing', async () => {
    await withAdmin(async db => {
      const commandId = uuidFrom(900);
      await setDoc(doc(db, `commands/${commandId}`), {
        commandId, businessDate: today, studentId: studentA,
      });
    });

    await expect(repository().readAudit({ dayId: today, leaseEpoch: 7 }))
      .rejects.toMatchObject({ code: 'INCOMPLETE_SNAPSHOT' });
  });

  it('fails closed on a lease holder change or maintenance mode', async () => {
    let changed = false;
    const repo = repository({
      afterPageRead: async event => {
        if (event.collection !== 'transactions' || event.page !== 1 || changed) return;
        changed = true;
        await withAdmin(async db => {
          await setDoc(doc(db, 'system/accessLease'), {
            holderUid: 'p12a-report-other', epoch: 8, updatedAt: serverTimestamp(),
          });
        });
      },
    });
    await expect(repo.readReport({
      range: { kind: 'custom', startDate: today, endDate: today }, studentId: null, leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'LEASE_LOST' });

    await withAdmin(async db => {
      await setDoc(doc(db, 'system/accessLease'), {
        holderUid: operator.uid, epoch: 7, updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'system/dataHead'), { ...head(205), maintenance: true });
    });
    await expect(repository().readSummary({
      range: { kind: 'custom', startDate: today, endDate: today }, leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'MAINTENANCE' });
  });

  it('rejects a report when the head changes between transaction pages', async () => {
    let bumped = false;
    const repo = repository({
      afterPageRead: async event => {
        if (event.collection !== 'transactions' || event.page !== 1 || bumped) return;
        bumped = true;
        await withAdmin(async db => {
          await setDoc(doc(db, 'system/dataHead'), head(206));
        });
      },
    });
    await expect(repo.readReport({
      range: { kind: 'custom', startDate: today, endDate: today }, studentId: null, leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(bumped).toBe(true);
  });

  it('rejects an invalid Gregorian business date found in the complete account prefix', async () => {
    const invalidId = uuidFrom(900);
    await withAdmin(async db => {
      await setDoc(doc(db, `transactions/${invalidId}`), tx(invalidId, studentA, '2026-02-30', 204, 'payment', {
        amount: 1, paidAmount: 1,
      }));
      await setDoc(doc(db, 'system/dataHead'), head(205));
    });
    await expect(repository().readAccountHistory({
      studentId: studentA,
      range: { kind: 'custom', startDate: today, endDate: today },
      leaseEpoch: 7,
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
});
