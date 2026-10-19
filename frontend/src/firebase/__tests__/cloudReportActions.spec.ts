// @ts-expect-error This node-only test utility is intentionally outside the browser type surface.
import { readFileSync } from 'node:fs';
// @ts-expect-error This node-only test utility is intentionally outside the browser type surface.
import path from 'node:path';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch, type Firestore,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_COMMAND_KINDS } from '../../domain/cloudCommands';
import { BackupValidationError, decryptBackup, encryptBackup, replayBackupProjections, validateBackupManifest } from '../cloudBackup';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';
import { createCloudOrderRepository } from '../cloudOrderRepository';
import { createCloudReportActionRepository } from '../cloudReportActionRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_REPORT_ACTIONS === 'true';
if (required && !emulatorHost) throw new Error('P12b report action Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath);
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const operator = { uid: 'p12b-report-operator', email: 'p12b-report@example.test', displayName: 'Synthetic P12b', active: true };
const studentId = '22222222-2222-4222-8222-222222222222';
let env: RulesTestEnvironment;

async function withAdmin<T>(callback: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async context => {
    result = await callback(context.firestore() as unknown as Firestore);
  });
  return result;
}

function fakeCurrentUser() {
  return {
    uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }],
  } as unknown as User;
}

function authedDb(): Firestore {
  return env.authenticatedContext(operator.uid, {
    email: operator.email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

async function seedBase() {
  await withAdmin(async db => {
    await setDoc(doc(db, `operators/${operator.uid}`), {
      ...operator, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'system/accessLease'), {
      holderUid: operator.uid, epoch: 1, updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId: 'p12b-synthetic-dataset', seq: 0, lastCommandId: null,
      maintenance: false, goLiveDate: today, updatedAt: serverTimestamp(),
    });
  });
}

function reportActionRepository() {
  return createCloudReportActionRepository(authedDb(), { currentUser: () => fakeCurrentUser() });
}

function commandRepository() {
  return createCloudCommandRepository(authedDb(), { currentUser: () => fakeCurrentUser() });
}

function monthRange() {
  return { kind: 'custom' as const, startDate: today, endDate: shiftDate(today, 30) };
}

function shiftDate(date: string, offset: number): string {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

function reportPayload(
  overrides: Record<string, unknown> = {},
  kind: 'RecordExport' | 'RecordPrint' = 'RecordExport',
): Record<string, unknown> {
  const dateRange = { start: today, end: shiftDate(today, 30) };
  if (kind === 'RecordPrint') {
    return {
      printType: 'ledger-merged', businessDate: today, dateRange, scope: { studentId: null }, sourceSeq: 0,
      ...overrides,
    };
  }
  return {
    exportType: 'transactions-original', dateRange, scope: { studentId: null }, sourceSeq: 0,
    ...overrides,
  };
}

function crossMonthFutureRange(length: 31 | 32) {
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: lastDay, end: shiftDate(lastDay, length - 1) };
}

async function rawReportBatch(options: {
  kind?: 'RecordExport' | 'RecordPrint';
  commandId?: string;
  payload?: Record<string, unknown>;
  command?: Record<string, unknown>;
  beforeHead?: (head: Record<string, unknown>) => Record<string, unknown>;
  afterHead?: (head: Record<string, unknown>) => Record<string, unknown>;
  writeHead?: boolean;
  writeCommand?: boolean;
  writeStudentProjection?: boolean;
  secondCommand?: boolean;
  omitCommandFields?: string[];
  omitPayloadFields?: string[];
}) {
  const db = authedDb();
  const kind = options.kind ?? 'RecordExport';
  const commandId = options.commandId ?? 'a1111111-1111-4111-8111-111111111111';
  const headRef = doc(db, 'system/dataHead');
  const headSnapshot = await getDoc(headRef);
  const headBefore = headSnapshot.data() as Record<string, unknown>;
  const headAfter = {
    ...headBefore, seq: Number(headBefore.seq) + 1, lastCommandId: commandId, updatedAt: serverTimestamp(),
  };
  const actualBefore = options.beforeHead ? options.beforeHead(headBefore) : headBefore;
  const declaredAfter = options.afterHead ? options.afterHead(headAfter) : headAfter;
  const payload = reportPayload(options.payload, kind);
  const command: Record<string, unknown> = {
    commandId, kind, seq: Number(headBefore.seq) + 1, leaseEpoch: 1,
    actor: { uid: operator.uid, email: operator.email }, committedAt: serverTimestamp(),
    businessDate: kind === 'RecordPrint' ? payload.businessDate : null,
    studentId: (payload.scope as { studentId: string | null }).studentId,
    targets: {}, expectedRevisions: {}, before: { head: actualBefore }, after: { head: declaredAfter },
    reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload, inputFingerprint: 'a'.repeat(64), ...options.command,
  };
  for (const key of options.omitCommandFields ?? []) delete command[key];
  for (const key of options.omitPayloadFields ?? []) delete payload[key];
  const batch = writeBatch(db);
  if (options.writeHead !== false) {
    batch.update(headRef, { seq: headAfter.seq, lastCommandId: commandId, updatedAt: serverTimestamp() });
  }
  if (options.writeCommand !== false) batch.set(doc(db, `commands/${commandId}`), command);
  if (options.secondCommand) {
    const secondCommandId = 'a2222222-2222-4222-8222-222222222222';
    batch.set(doc(db, `commands/${secondCommandId}`), {
      ...command, commandId: secondCommandId, before: { head: headBefore },
    });
  }
  if (options.writeStudentProjection) {
    const studentRef = doc(db, `students/${studentId}`);
    const studentBefore = (await getDoc(studentRef)).data() as Record<string, unknown> | undefined;
    if (!studentBefore) throw new Error('raw projection control requires an existing seeded student');
    batch.update(studentRef, {
      displayName: 'P12b complete business projection',
      revision: Number(studentBefore.revision) + 1,
      lastCommandId: commandId,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

async function readBusinessProjections() {
  return withAdmin(async db => {
    const [students, transactions, days, postCloseEntries] = await Promise.all([
      getDocs(collection(db, 'students')),
      getDocs(collection(db, 'transactions')),
      getDocs(collection(db, 'days')),
      getDocs(collection(db, 'postCloseEntries')),
    ]);
    const settlementRows = await Promise.all(days.docs.map(async day => {
      const settlements = await getDocs(collection(db, `days/${day.id}/settlements`));
      return settlements.docs.map(settlement => ({
        path: `days/${day.id}/settlements/${settlement.id}`,
        data: settlement.data(),
      }));
    }));
    const rows = (snapshot: typeof students) => snapshot.docs
      .map(item => ({ path: `${item.ref.parent.path}/${item.id}`, data: item.data() }))
      .sort((left, right) => left.path.localeCompare(right.path));
    return {
      students: rows(students),
      transactions: rows(transactions),
      days: rows(days),
      settlements: settlementRows.flat().sort((left, right) => left.path.localeCompare(right.path)),
      postCloseEntries: rows(postCloseEntries),
    };
  });
}

describeWithEmulator('P12b report action command, Rules and backup proof', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: {
        rules: readFileSync(rulesPath, 'utf8'),
        host: emulatorHost!.split(':')[0],
        port: Number(emulatorHost!.split(':')[1] || '8080'),
      },
    });
  });

  beforeEach(async () => { await env.clearFirestore(); });
  afterAll(async () => { await env?.cleanup(); });

  it('P12b.1 enables both kinds and records export/print intent without changing business projections', async () => {
    await seedBase();
    expect(ALL_COMMAND_KINDS).toContain('RecordExport');
    expect(ALL_COMMAND_KINDS).toContain('RecordPrint');
    const created = await commandRepository().commitCommand({
      commandId: 'b1111111-1111-4111-8111-111111111111', kind: 'CreateStudent', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '001', displayName: 'Synthetic Student', aliases: [],
        openingBalance: { amount: 100, asOfDate: today, note: 'P12b proof' } },
    });
    expect(created.ok).toBe(true);
    const businessStateBefore = await withAdmin(async db => (await getDoc(doc(db, `students/${studentId}`))).data());
    const range = monthRange();
    const actions = reportActionRepository();
    const exportResult = await actions.recordExport({
      commandId: 'b2111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      exportType: 'transactions-original', range, scope: { studentId: null }, sourceSeq: 1,
    });
    expect(exportResult).toMatchObject({ ok: true, receipt: { kind: 'RecordExport', seq: 2 } });
    const printResult = await actions.recordPrint({
      commandId: 'b3111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      printType: 'ledger-merged', businessDate: today, range, scope: { studentId }, sourceSeq: 1,
    });
    expect(printResult).toMatchObject({ ok: true, receipt: { kind: 'RecordPrint', seq: 3 } });
    expect(await actions.recordPrint({
      commandId: 'b3111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      printType: 'ledger-merged', businessDate: today, range, scope: { studentId }, sourceSeq: 1,
    })).toEqual(printResult);
    const changedIntent = await actions.recordPrint({
      commandId: 'b3111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      printType: 'ledger-merged', businessDate: today, range, scope: { studentId: null }, sourceSeq: 1,
    });
    expect(changedIntent).toMatchObject({ ok: false });

    const persisted = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'commands/b2111111-1111-4111-8111-111111111111')),
      getDoc(doc(db, 'commands/b3111111-1111-4111-8111-111111111111')),
      getDoc(doc(db, `students/${studentId}`)),
      getDoc(doc(db, `days/${today}`)),
      getDoc(doc(db, 'transactions/p12b-no-transaction')),
      getDoc(doc(db, 'postCloseEntries/b3111111-1111-4111-8111-111111111111')),
    ]));
    const [head, exportCommand, printCommand, student, day, transaction, postCloseEntry] = persisted;
    expect(head.data()).toMatchObject({ seq: 3, lastCommandId: 'b3111111-1111-4111-8111-111111111111' });
    expect(exportCommand.data()).toMatchObject({
      kind: 'RecordExport', businessDate: null, studentId: null, targets: {}, expectedRevisions: {}, reason: null,
      payload: { exportType: 'transactions-original', dateRange: { start: today, end: shiftDate(today, 30) }, scope: { studentId: null }, sourceSeq: 1 },
      before: { head: { seq: 1 } }, after: { head: { seq: 2 } },
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    });
    expect(printCommand.data()).toMatchObject({
      kind: 'RecordPrint', businessDate: today, studentId, targets: {}, expectedRevisions: {}, reason: null,
      payload: { printType: 'ledger-merged', businessDate: today, dateRange: { start: today, end: shiftDate(today, 30) }, scope: { studentId }, sourceSeq: 1 },
      before: { head: { seq: 2 } }, after: { head: { seq: 3 } },
    });
    expect(Object.keys(exportCommand.data()?.before ?? {})).toEqual(['head']);
    expect(Object.keys(printCommand.data()?.after ?? {})).toEqual(['head']);
    expect(student.data()).toEqual(businessStateBefore);
    expect(day.exists()).toBe(false);
    expect(transaction.exists()).toBe(false);
    expect(postCloseEntry.exists()).toBe(false);
  });

  it.each([
    ['RecordExport', 'transactions-original', { studentId: null }],
    ['RecordPrint', 'ledger-original', { studentId }],
  ] as const)('P12b.1a raw Rules control accepts a valid %s envelope without any business documents', async (kind, reportType, scope) => {
    await seedBase();
    const dateRange = crossMonthFutureRange(31);
    await rawReportBatch({
      kind,
      payload: kind === 'RecordExport'
        ? { exportType: reportType, dateRange, scope, sourceSeq: 0 }
        : { printType: reportType, businessDate: dateRange.start, dateRange, scope, sourceSeq: 0 },
    });

    const [head, command] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'commands/a1111111-1111-4111-8111-111111111111')),
    ]));
    expect(head.data()).toMatchObject({ seq: 1, lastCommandId: 'a1111111-1111-4111-8111-111111111111' });
    expect(command.data()).toMatchObject({
      kind, businessDate: kind === 'RecordPrint' ? dateRange.start : null,
      studentId: scope.studentId, targets: {}, expectedRevisions: {},
      payload: { dateRange, scope, sourceSeq: 0 },
    });
    const projections = await readBusinessProjections();
    expect(projections).toEqual({ students: [], transactions: [], days: [], settlements: [], postCloseEntries: [] });
  });

  it.each(['RecordExport', 'RecordPrint'] as const)('P12b.1b raw Rules reject a 32-day %s range atomically', async kind => {
    await seedBase();
    const dateRange = crossMonthFutureRange(32);
    await assertFails(rawReportBatch({
      kind,
      payload: kind === 'RecordExport'
        ? { exportType: 'transactions-original', dateRange, scope: { studentId: null }, sourceSeq: 0 }
        : { printType: 'ledger-original', businessDate: dateRange.start, dateRange, scope: { studentId: null }, sourceSeq: 0 },
    }));
    const [head, command] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'commands/a1111111-1111-4111-8111-111111111111')),
    ]));
    expect(head.data()).toMatchObject({ seq: 0, lastCommandId: null });
    expect(command.exists()).toBe(false);
  });

  it('P12b.1c raw action cannot write a student projection; the normal EditStudent command remains valid', async () => {
    await seedBase();
    const created = await commandRepository().commitCommand({
      commandId: 'a3111111-1111-4111-8111-111111111111', kind: 'CreateStudent', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '001', displayName: 'Synthetic Student', aliases: [],
        openingBalance: { amount: 100, asOfDate: today, note: 'P12b projection control' } },
    });
    expect(created).toMatchObject({ ok: true, receipt: { seq: 1 } });
    const before = await withAdmin(db => getDoc(doc(db, `students/${studentId}`)));
    await assertFails(rawReportBatch({ writeStudentProjection: true }));
    const [head, deniedCommand, afterDenied] = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'commands/a1111111-1111-4111-8111-111111111111')),
      getDoc(doc(db, `students/${studentId}`)),
    ]));
    expect(head.data()).toMatchObject({ seq: 1, lastCommandId: 'a3111111-1111-4111-8111-111111111111' });
    expect(deniedCommand.exists()).toBe(false);
    expect(afterDenied.data()).toEqual(before.data());

    const edit = await commandRepository().commitCommand({
      commandId: 'a3222222-2222-4222-8222-222222222222', kind: 'EditStudent', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 1 },
      payload: { displayName: 'Renamed Synthetic' },
    });
    expect(edit).toMatchObject({ ok: true, receipt: { seq: 2 } });
  });

  it('P12b.2 backs up, encrypts, decrypts and replays the new head-only command kinds', async () => {
    await seedBase();
    await commandRepository().commitCommand({
      commandId: 'b4111111-1111-4111-8111-111111111111', kind: 'CreateStudent', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '001', displayName: 'Synthetic Student', aliases: [],
        openingBalance: { amount: 100, asOfDate: today, note: 'P12b backup fixture' } },
    });
    const before = await withAdmin(async db => (await getDoc(doc(db, `students/${studentId}`))).data());
    const actions = reportActionRepository();
    const range = monthRange();
    await actions.recordExport({
      commandId: 'b5111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      exportType: 'audit', range, scope: { studentId }, sourceSeq: 1,
    });
    await actions.recordPrint({
      commandId: 'b6111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      printType: 'ledger-original', businessDate: today, range, scope: { studentId }, sourceSeq: 1,
    });
    const backup = createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid });
    const exported = await backup.exportRange({ fromSeq: 0, generatedAt: '2026-10-19T00:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual(['CreateStudent', 'RecordExport', 'RecordPrint']);
    const encrypted = await encryptBackup(exported.manifest, 'synthetic P12b proof passphrase');
    const decrypted = await decryptBackup(encrypted, 'synthetic P12b proof passphrase');
    expect(replayBackupProjections(decrypted.records, decrypted.baseState)).toEqual(decrypted.projectionState);
    expect(await withAdmin(async db => (await getDoc(doc(db, `students/${studentId}`))).data())).toEqual(before);

    const tamperedManifest = structuredClone(decrypted);
    const exportRecord = tamperedManifest.records.find(record => record.kind === 'RecordExport')!;
    exportRecord.studentId = null;
    expect(() => validateBackupManifest(tamperedManifest)).toThrow(BackupValidationError);

    const corruptedReplay = structuredClone(decrypted.records);
    const replayExport = corruptedReplay.find(record => record.kind === 'RecordExport')!;
    const forgedTransaction = { transactionId: 'p12b-forged', businessDate: today, status: 'active' };
    replayExport.before = { ...replayExport.before, transaction: forgedTransaction };
    replayExport.after = { ...replayExport.after, transaction: forgedTransaction };
    expect(() => replayBackupProjections(corruptedReplay, decrypted.baseState)).toThrow(BackupValidationError);
  });

  it('P12b.2a real business projections survive report actions and encrypted backup replay', async () => {
    await seedBase();
    const commands = commandRepository();
    const orders = createCloudOrderRepository(authedDb(), { currentUser: () => fakeCurrentUser() });
    const closing = createCloudDayCloseRepository(authedDb(), { currentUser: () => fakeCurrentUser() });
    const backups = createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid });
    const ok = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const day = async () => (await withAdmin(db => getDoc(doc(db, `days/${today}`)))).data() as Record<string, unknown>;
    const student = async () => (await withAdmin(db => getDoc(doc(db, `students/${studentId}`)))).data() as Record<string, unknown>;

    ok(await commands.commitCommand({
      commandId: 'b8111111-1111-4111-8111-111111111111', kind: 'EnsureDay', leaseEpoch: 1,
      targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today },
    }));
    ok(await commands.commitCommand({
      commandId: 'b8222222-2222-4222-8222-222222222222', kind: 'SetOpeningCash', leaseEpoch: 1,
      targets: { dayId: today }, expectedRevisions: { day: 1 }, payload: { openingCash: 1000 },
    }));
    ok(await commands.commitCommand({
      commandId: 'b8333333-3333-4333-8333-333333333333', kind: 'CreateStudent', leaseEpoch: 1,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '012', displayName: 'Synthetic Roundtrip', aliases: [],
        openingBalance: { amount: 0, asOfDate: today, note: 'P12b projection roundtrip' } },
    }));
    const transactionId = 'c1111111-1111-4111-8111-111111111111';
    ok(await orders.createOrder({
      commandId: 'b8444444-4444-4444-8444-444444444444', transactionId, leaseEpoch: 1, studentId, dayId: today,
      expectedStudentRevision: Number((await student()).revision), expectedDayRevision: Number((await day()).revision),
      mealKind: 'other', mealPrice: 150, paidAmount: 150, menuRevision: null, otherItemName: 'Synthetic lunch', note: 'P12b roundtrip',
    }));
    const currentClose = await closing.read(today);
    expect(currentClose?.expectedCash).toBe(1150);
    ok(await closing.closeDay({
      commandId: 'b8555555-5555-4555-8555-555555555555', leaseEpoch: 1, dayId: today,
      expectedDayRevision: currentClose!.revision, expectedSettlementRevision: currentClose!.lastSettlementRevision,
      expectedCash: currentClose!.expectedCash!, countedCash: currentClose!.expectedCash!, note: '',
    }));
    const closed = await closing.read(today);
    expect(closed).toMatchObject({ status: 'closed', lastSettlementRevision: 1 });
    ok(await closing.recordPostCloseEntry({
      commandId: 'b8666666-6666-4666-8666-666666666666', leaseEpoch: 1, dayId: today,
      expectedDayRevision: closed!.revision, expectedSettlementRevision: closed!.lastSettlementRevision,
      direction: 'expense', amount: 10, reason: 'Synthetic post-close purchase',
    }));

    const beforeActions = await readBusinessProjections();
    expect(beforeActions.students).toHaveLength(1);
    expect(beforeActions.transactions).toHaveLength(1);
    expect(beforeActions.days).toHaveLength(1);
    expect(beforeActions.settlements).toHaveLength(1);
    expect(beforeActions.postCloseEntries).toHaveLength(1);
    const headBeforeActions = await withAdmin(db => getDoc(doc(db, 'system/dataHead')));
    const sourceSeq = Number(headBeforeActions.data()?.seq);
    const range = monthRange();
    ok(await reportActionRepository().recordExport({
      commandId: 'b8777777-7777-4777-8777-777777777777', leaseEpoch: 1,
      exportType: 'audit', range, scope: { studentId: null }, sourceSeq,
    }));
    ok(await reportActionRepository().recordPrint({
      commandId: 'b8888888-8888-4888-8888-888888888888', leaseEpoch: 1,
      printType: 'ledger-merged', businessDate: today, range, scope: { studentId }, sourceSeq,
    }));
    expect(await readBusinessProjections()).toEqual(beforeActions);

    const exported = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-19T00:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual([
      'EnsureDay', 'SetOpeningCash', 'CreateStudent', 'CreateOrder', 'CloseDay', 'RecordPostCloseEntry', 'RecordExport', 'RecordPrint',
    ]);
    const encrypted = await encryptBackup(exported.manifest, 'synthetic P12b full roundtrip');
    const decrypted = await decryptBackup(encrypted, 'synthetic P12b full roundtrip');
    expect(replayBackupProjections(decrypted.records, decrypted.baseState)).toEqual(decrypted.projectionState);
    expect(await readBusinessProjections()).toEqual(beforeActions);
  });

  it('P12b.3 rejects future sourceSeq before writing any report command', async () => {
    await seedBase();
    const result = await reportActionRepository().recordExport({
      commandId: 'b7111111-1111-4111-8111-111111111111', leaseEpoch: 1,
      exportType: 'transactions-original', range: monthRange(), scope: { studentId: null }, sourceSeq: 1,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    const state = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'commands/b7111111-1111-4111-8111-111111111111')),
    ]));
    expect(state[0].data()).toMatchObject({ seq: 0, lastCommandId: null });
    expect(state[1].exists()).toBe(false);
  });

  const rawDenialCases: Array<[string, Parameters<typeof rawReportBatch>[0]]> = [
    ['scope/top-level binding', { command: { studentId: null }, payload: { scope: { studentId } } }],
    ['sourceSeq upper bound', { payload: { sourceSeq: 1 } }],
    ['server actor', { command: { actor: { uid: 'another-user', email: operator.email } } }],
    ['server time', { command: { committedAt: new Date(0) } }],
    ['actual before-head binding', { beforeHead: head => ({ ...head, datasetId: 'forged-dataset' }) }],
    ['actual after-head binding', { afterHead: head => ({ ...head, goLiveDate: '2026-01-01' }) }],
    ['kind/payload masquerade', { payload: { printType: 'ledger-original' } }],
    ['non-UUID account scope', { payload: { scope: { studentId: 'student-not-a-uuid' } } }],
    ['print anchor outside range', { kind: 'RecordPrint', payload: { businessDate: shiftDate(today, -1) } }],
    ['command without paired head advance', { writeHead: false }],
    ['head advance without paired command', { writeCommand: false }],
    ['second command on one head advance', { secondCommand: true }],
    ['missing command field', { omitCommandFields: ['reason'] }],
    ['extra command field', { command: { unexpected: true } }],
    ['missing payload field', { omitPayloadFields: ['sourceSeq'] }],
    ['extra payload field', { payload: { unexpected: true } }],
    ['settlement export with account scope', { payload: { exportType: 'settlements', scope: { studentId } } }],
    ['post-close export with account scope', { payload: { exportType: 'post-close-entries', scope: { studentId } } }],
  ];

  it.each(rawDenialCases)('P12b.4 Rules deny %s', async (_label, options) => {
    await seedBase();
    await assertFails(rawReportBatch(options));
    const state = await withAdmin(async db => Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, 'commands/a1111111-1111-4111-8111-111111111111')),
      getDoc(doc(db, `students/${studentId}`)),
    ]));
    expect(state[0].data()).toMatchObject({ seq: 0, lastCommandId: null });
    expect(state[1].exists()).toBe(false);
    expect(state[2].exists()).toBe(false);
  });
});
