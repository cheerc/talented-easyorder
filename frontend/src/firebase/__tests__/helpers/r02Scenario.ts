// @ts-expect-error Node-only file access is used to write the generated fixture to a temporary directory.
import { mkdirSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node-only path access is used to place the generated fixture files.
import path from 'node:path';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import { Timestamp, doc, getDoc, setDoc, type Firestore } from 'firebase/firestore';
import { encryptBackup, sha256Hex, type BackupManifest } from '../../cloudBackup';
import { createCloudBackupRepository } from '../../cloudBackupRepository';
import { createCloudBackupCommandRepository } from '../../cloudBackupCommandRepository';
import { createCloudCommandRepository } from '../../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../../cloudDayCloseRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../../cloudOrderRepository';
import { UNDO_REASON } from '../../../domain/cloudTransactionMutation';

/**
 * The R02 disaster-recovery source: a synthetic dataset written through the production writers (never hand-built
 * records) and exported as three encrypted increments plus one deliberately mis-chained copy of the last package.
 * Nothing here is real data; the strings in `known` are what the anonymity checks look for in CLI output.
 */
export interface R02Package { file: string; sha256: string; fromSeq: number; toSeq: number }

export interface R02Fixture {
  dir: string;
  chainPath: string;
  password: string;
  datasetId: string;
  packages: R02Package[];
  /** The last package re-exported with a previousPackageSha256 that does not match package 2. */
  wrongPreviousFile: string;
  /** Values the CLI output must never contain. */
  known: string[];
  source: {
    headSeq: number;
    dayTotals: Record<string, Record<string, number>>;
    studentCount: number;
    balanceSum: number;
    gapDay: string;
    today: string;
  };
}

export const R02_OPERATOR = { uid: 'p15-restore-operator', email: 'p15-restore@example.test', active: true };
export const R02_LEASE_EPOCH = 7;
const LEASE_EPOCH = R02_LEASE_EPOCH;

export function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

export function shiftDay(day: string, offset: number): string {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

export function operatorUser(): User {
  return {
    uid: R02_OPERATOR.uid, email: R02_OPERATOR.email, emailVerified: true, providerData: [{ providerId: 'google.com' }],
  } as unknown as User;
}

export function operatorDb(env: RulesTestEnvironment): Firestore {
  return env.authenticatedContext(R02_OPERATOR.uid, {
    email: R02_OPERATOR.email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

/** An empty dataset head, the operator and a held lease: the state the production writers expect. */
export async function seedEmptySource(env: RulesTestEnvironment, datasetId: string): Promise<void> {
  const now = Timestamp.now();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'operators', R02_OPERATOR.uid), { ...R02_OPERATOR });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: R02_OPERATOR.uid, epoch: LEASE_EPOCH, updatedAt: now });
    await setDoc(doc(db, 'system/dataHead'), {
      schemaVersion: 1, datasetId, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: '2026-10-01', updatedAt: now,
    });
  });
}

function sourcePackageFile(index: number): string { return `r02-package-${index}.easyorder-backup`; }

async function writePackage(dir: string, file: string, manifest: BackupManifest, password: string): Promise<{ sha256: string }> {
  const bytes = await encryptBackup(manifest, password);
  writeFileSync(path.join(dir, file), bytes);
  return { sha256: await sha256Hex(bytes) };
}

export async function generateR02Fixture(options: { env: RulesTestEnvironment; dir: string; password: string; datasetId?: string }): Promise<R02Fixture> {
  const { env, dir, password } = options;
  const datasetId = options.datasetId ?? 'anonymous-p15-r02';
  mkdirSync(dir, { recursive: true });
  await seedEmptySource(env, datasetId);
  const db = operatorDb(env);
  const user = operatorUser();
  const writer = createCloudCommandRepository(db, { currentUser: () => user });
  const orders = createCloudOrderRepository(db, { currentUser: () => user });
  const closing = createCloudDayCloseRepository(db, { currentUser: () => user });
  const backups = createCloudBackupRepository(db, { currentUid: () => R02_OPERATOR.uid });
  const backupReceipts = createCloudBackupCommandRepository(db, { currentUser: () => user });

  const today = taipeiToday();
  const gap = shiftDay(today, -2);
  let next = 1000;
  const id = () => uuid(++next);
  const alpha = uuid(900_001);
  const beta = uuid(900_002);
  const vendorId = uuid(900_003);
  const known = [
    'R02 Synthetic Alpha', 'R02 Synthetic Beta', 'alpha-r02', '731901', '731902', '731903', 'R02 Vendor', R02_OPERATOR.uid,
    R02_OPERATOR.email, '紙本R02-0001', '紙本R02-0002', '紙本R02-0003', '零錢補充', '補充零用金', '溢繳退還',
    '整天沒有用系統', '前天停電', '關帳後發現漏記', '餐費記錯',
  ];

  const read = async (docPath: string) => (await getDoc(doc(db, docPath))).data() as Record<string, number & string>;
  const ok = (result: { ok: boolean }, label: string) => {
    if (!result.ok) throw new Error(`R02 fixture: ${label} failed ${JSON.stringify(result)}`);
  };
  const headSeq = async () => (await read('system/dataHead')).seq as number;
  const revisions = async (studentId: string, dayId: string) => ({
    student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${dayId}`)).revision,
  });

  // --- students, a code change and a vendor, before any day exists
  ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: LEASE_EPOCH,
    targets: { studentId: alpha }, expectedRevisions: { student: 0 },
    payload: { studentCode: '731901', displayName: 'R02 Synthetic Alpha', aliases: ['alpha-r02'],
      openingBalance: { amount: 100, asOfDate: '2026-10-01', note: '' } } }), 'CreateStudent alpha');
  ok(await writer.commitCommand({ commandId: id(), kind: 'ChangeStudentCode', leaseEpoch: LEASE_EPOCH,
    targets: { studentId: alpha }, expectedRevisions: { student: (await read(`students/${alpha}`)).revision },
    payload: { studentCode: '731903', reason: 'R02 code change' } }), 'ChangeStudentCode');
  ok(await writer.commitCommand({ commandId: id(), kind: 'SaveVendor', leaseEpoch: LEASE_EPOCH,
    targets: { vendorId }, expectedRevisions: { vendor: 0 },
    payload: { vendorId, name: 'R02 Vendor', phone: '', note: '', status: 'active' } }), 'SaveVendor');

  // --- a back-filled gap day with paper-numbered entries, closed
  ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: LEASE_EPOCH,
    targets: { dayId: gap }, expectedRevisions: { day: 0 }, payload: { businessDate: gap } }), 'EnsureDay gap');
  ok(await closing.backfillOpening({ commandId: id(), leaseEpoch: LEASE_EPOCH, dayId: gap,
    expectedDayRevision: (await read(`days/${gap}`)).revision, openingCash: 600, reason: '整天沒有用系統' }), 'BackfillOpeningCash');
  ok(await writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: LEASE_EPOCH,
    targets: { dayId: gap }, expectedRevisions: { day: (await read(`days/${gap}`)).revision },
    payload: { reason: '前天停電，事後補登' } }), 'StartBackfill');
  let r = await revisions(alpha, gap);
  ok(await orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: LEASE_EPOCH, studentId: alpha, dayId: gap,
    expectedStudentRevision: r.student, expectedDayRevision: r.day, mealKind: 'other', mealPrice: 80, paidAmount: 0,
    menuRevision: null, otherItemName: '自備便當', note: '紙本R02-0001：' }), 'backfill order');
  r = await revisions(alpha, gap);
  ok(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: LEASE_EPOCH, studentId: alpha, dayId: gap,
    expectedStudentRevision: r.student, expectedDayRevision: r.day, paidAmount: 200, note: '紙本R02-0002：' }), 'backfill payment');
  ok(await orders.createCashMovement({ commandId: id(), transactionId: id(), leaseEpoch: LEASE_EPOCH, dayId: gap,
    expectedDayRevision: (await read(`days/${gap}`)).revision, direction: 'income', amount: 50, reason: '紙本R02-0003：零錢補充' }), 'backfill cash');
  const gapDay = await read(`days/${gap}`);
  ok(await closing.closeDay({ commandId: id(), leaseEpoch: LEASE_EPOCH, dayId: gap,
    expectedDayRevision: gapDay.revision, expectedSettlementRevision: gapDay.lastSettlementRevision,
    expectedCash: (await closing.read(gap))!.expectedCash!, countedCash: (await closing.read(gap))!.expectedCash!, note: '', alignWithDayId: null }), 'close gap');

  // --- today: menu, opening cash, a second student and every kind of transaction change
  ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: LEASE_EPOCH,
    targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }), 'EnsureDay today');
  ok(await writer.commitCommand({ commandId: id(), kind: 'SetDayMenu', leaseEpoch: LEASE_EPOCH,
    targets: { dayId: today }, expectedRevisions: { day: (await read(`days/${today}`)).revision, headSeq: await headSeq() },
    payload: { selectionDate: today, itemName: 'R02 Menu', price: 80, vendorId, vendorNameSnapshot: 'R02 Vendor', inheritedFromDate: null } }), 'SetDayMenu');
  ok(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: LEASE_EPOCH,
    targets: { dayId: today }, expectedRevisions: { day: (await read(`days/${today}`)).revision },
    payload: { openingCash: 1000, reason: '補充零用金' } }), 'SetOpeningCash');
  ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: LEASE_EPOCH,
    targets: { studentId: beta }, expectedRevisions: { student: 0 },
    payload: { studentCode: '731902', displayName: 'R02 Synthetic Beta', aliases: [],
      openingBalance: { amount: 100, asOfDate: today, note: '' } } }), 'CreateStudent beta');

  const createOrder = async (mealPrice: number, paidAmount: number) => {
    const rev = await revisions(alpha, today); const commandId = id(); const transactionId = id();
    ok(await orders.createOrder({ commandId, transactionId, leaseEpoch: LEASE_EPOCH, studentId: alpha, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice, paidAmount,
      menuRevision: null, otherItemName: '自備便當', note: '' }), 'CreateOrder');
    return { commandId, transactionId };
  };
  const createPayment = async (paidAmount: number) => {
    const rev = await revisions(alpha, today); const commandId = id(); const transactionId = id();
    ok(await orders.createPayment({ commandId, transactionId, leaseEpoch: LEASE_EPOCH, studentId: alpha, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, paidAmount, note: '' }), 'CreatePayment');
    return { commandId, transactionId };
  };
  const createRefund = async (amount: number) => {
    const rev = await revisions(alpha, today); const commandId = id(); const transactionId = id();
    ok(await orders.createRefund({ commandId, transactionId, leaseEpoch: LEASE_EPOCH, studentId: alpha, dayId: today,
      expectedStudentRevision: rev.student, expectedDayRevision: rev.day, amount, reason: '溢繳退還' }), 'CreateRefund');
    return { commandId, transactionId };
  };
  const createCash = async (direction: 'income' | 'expense', amount: number) => {
    const commandId = id(); const transactionId = id();
    ok(await orders.createCashMovement({ commandId, transactionId, leaseEpoch: LEASE_EPOCH, dayId: today,
      expectedDayRevision: (await read(`days/${today}`)).revision, direction, amount, reason: '零錢補充' }), 'CreateCashMovement');
    return { commandId, transactionId };
  };
  const mutate = async (transactionId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => {
    const tx = await read(`transactions/${transactionId}`);
    const cashierRow = tx.studentId === '__cashier__';
    ok(await orders.mutateTransaction({ commandId: id(), leaseEpoch: LEASE_EPOCH, transactionId,
      studentId: tx.studentId, dayId: today, expectedTransactionRevision: tx.revision,
      expectedStudentRevision: cashierRow ? null : (await read(`students/${alpha}`)).revision,
      expectedDayRevision: (await read(`days/${today}`)).revision, ...spec } as CloudTransactionMutationInput), spec.kind);
  };

  const corrected = await createOrder(80, 100);
  await mutate(corrected.transactionId, { kind: 'CorrectTransaction',
    payload: { mealPrice: 70, paidAmount: 100, amount: 30, note: '', reason: '餐費記錯' } });
  const kept = await createOrder(80, 100);
  await mutate(kept.transactionId, { kind: 'CancelKeepDeposit', payload: { reason: '學生今天不吃' } });
  const refunded = await createOrder(80, 100);
  await mutate(refunded.transactionId, { kind: 'CancelRefund', payload: { reason: '學生今天不吃，退現金' } });
  const cashUndo = await createCash('income', 50);
  await mutate(cashUndo.transactionId, { kind: 'Undo', payload: { targetCommandId: cashUndo.commandId, reason: UNDO_REASON } });
  const paymentUndo = await createPayment(30);
  await mutate(paymentUndo.transactionId, { kind: 'Undo', payload: { targetCommandId: paymentUndo.commandId, reason: UNDO_REASON } });
  const voidedRefund = await createRefund(20);
  await mutate(voidedRefund.transactionId, { kind: 'VoidTransaction', payload: { reason: '退款記錯' } });
  await createCash('expense', 15);
  // Beta pays, then its opening balance is corrected.
  r = await revisions(beta, today);
  ok(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: LEASE_EPOCH, studentId: beta, dayId: today,
    expectedStudentRevision: r.student, expectedDayRevision: r.day, paidAmount: 150, note: '' }), 'beta payment');
  r = await revisions(beta, today);
  ok(await writer.commitCommand({ commandId: id(), kind: 'CorrectOpening', leaseEpoch: LEASE_EPOCH,
    targets: { studentId: beta, dayId: today }, expectedRevisions: { student: r.student, day: r.day },
    payload: { amount: 80, note: '核對後更正', reason: '期初抄錯' } }), 'CorrectOpening');

  // --- package 1, then its receipt, then the close / reopen / re-close cycle
  const packageFiles: R02Package[] = [];
  const first = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-23T03:00:00.000Z' });
  const firstWritten = await writePackage(dir, sourcePackageFile(1), first.manifest, password);
  packageFiles.push({ file: sourcePackageFile(1), sha256: firstWritten.sha256, fromSeq: 0, toSeq: first.toSeq });
  ok(await backupReceipts.commitRecordBackupIntent({ commandId: id(), leaseEpoch: LEASE_EPOCH,
    payload: { backupType: 'command-incremental', sourceSeq: first.toSeq, fromSeq: 0, toSeq: first.toSeq, sha256: firstWritten.sha256 } }), 'RecordBackup 1');

  const closeToday = async (note: string, delta: number) => {
    const current = await read(`days/${today}`);
    const expected = (await closing.read(today))!.expectedCash!;
    ok(await closing.closeDay({ commandId: id(), leaseEpoch: LEASE_EPOCH, dayId: today, expectedDayRevision: current.revision,
      expectedSettlementRevision: current.lastSettlementRevision, expectedCash: expected, countedCash: expected + delta, note }), 'closeDay today');
  };
  await closeToday('少 10 元', -10);
  const afterClose = await read(`days/${today}`);
  ok(await closing.reopenDay({ commandId: id(), leaseEpoch: LEASE_EPOCH, dayId: today, expectedDayRevision: afterClose.revision,
    expectedSettlementRevision: afterClose.lastSettlementRevision, reason: '收款記錯' }), 'ReopenDay');
  await createPayment(25);
  await closeToday('', 0);
  const gapNow = await read(`days/${gap}`);
  ok(await closing.recordPostCloseEntry({ commandId: id(), leaseEpoch: LEASE_EPOCH, dayId: gap, expectedDayRevision: gapNow.revision,
    expectedSettlementRevision: gapNow.lastSettlementRevision, direction: 'income', amount: 5, reason: '關帳後發現漏記收款' }), 'post-close entry 1');

  const second = await backups.exportRange({ fromSeq: first.toSeq, previousManifest: first.manifest,
    previousPackageSha256: firstWritten.sha256, generatedAt: '2026-10-23T04:00:00.000Z' });
  const secondWritten = await writePackage(dir, sourcePackageFile(2), second.manifest, password);
  packageFiles.push({ file: sourcePackageFile(2), sha256: secondWritten.sha256, fromSeq: first.toSeq, toSeq: second.toSeq });
  ok(await backupReceipts.commitRecordBackupIntent({ commandId: id(), leaseEpoch: LEASE_EPOCH,
    payload: { backupType: 'command-incremental', sourceSeq: second.toSeq, fromSeq: first.toSeq, toSeq: second.toSeq, sha256: secondWritten.sha256 } }), 'RecordBackup 2');

  const gapLatest = await read(`days/${gap}`);
  ok(await closing.recordPostCloseEntry({ commandId: id(), leaseEpoch: LEASE_EPOCH, dayId: gap, expectedDayRevision: gapLatest.revision,
    expectedSettlementRevision: gapLatest.lastSettlementRevision, direction: 'expense', amount: 3, reason: '關帳後發現漏記買零錢' }), 'post-close entry 2');

  const third = await backups.exportRange({ fromSeq: second.toSeq, previousManifest: second.manifest,
    previousPackageSha256: secondWritten.sha256, generatedAt: '2026-10-23T05:00:00.000Z' });
  const thirdWritten = await writePackage(dir, sourcePackageFile(3), third.manifest, password);
  packageFiles.push({ file: sourcePackageFile(3), sha256: thirdWritten.sha256, fromSeq: second.toSeq, toSeq: third.toSeq });
  const wrongPreviousFile = 'r02-package-3-wrong-previous.easyorder-backup';
  const wrong = await backups.exportRange({ fromSeq: second.toSeq, previousManifest: second.manifest,
    previousPackageSha256: 'f'.repeat(64), generatedAt: '2026-10-23T05:00:00.000Z' });
  await writePackage(dir, wrongPreviousFile, wrong.manifest, password);

  const chainPath = path.join(dir, 'chain.json');
  writeFileSync(chainPath, JSON.stringify({
    format: 'easyorder-restore-chain', version: 1, datasetId,
    packages: packageFiles.map(item => ({ file: item.file, sha256: item.sha256 })),
  }, null, 2));

  // --- what the source says, for the report to be compared with
  const dayTotals: Record<string, Record<string, number>> = {};
  for (const dayId of [gap, today]) dayTotals[dayId] = (await read(`days/${dayId}`)).totals as unknown as Record<string, number>;
  const balanceSum = (await Promise.all([alpha, beta].map(async studentId => (await read(`students/${studentId}`)).currentBalance as number)))
    .reduce((sum, value) => sum + value, 0);
  return {
    dir, chainPath, password, datasetId, packages: packageFiles, wrongPreviousFile, known,
    source: { headSeq: await headSeq(), dayTotals, studentCount: 2, balanceSum, gapDay: gap, today },
  };
}

/** A one-command package of another dataset, for the mixed-dataset chain case. Reseeds the source, so call it after the R02 fixture. */
export async function generateOtherDatasetPackage(options: { env: RulesTestEnvironment; dir: string; password: string; datasetId: string }): Promise<R02Package> {
  const { env, dir, password, datasetId } = options;
  mkdirSync(dir, { recursive: true });
  await seedEmptySource(env, datasetId);
  const db = operatorDb(env);
  const user = operatorUser();
  const writer = createCloudCommandRepository(db, { currentUser: () => user });
  const day = shiftDay(taipeiToday(), -1);
  const result = await writer.commitCommand({ commandId: uuid(990_001), kind: 'EnsureDay', leaseEpoch: LEASE_EPOCH,
    targets: { dayId: day }, expectedRevisions: { day: 0 }, payload: { businessDate: day } });
  if (!result.ok) throw new Error(`other dataset fixture failed ${JSON.stringify(result)}`);
  const exported = await createCloudBackupRepository(db, { currentUid: () => R02_OPERATOR.uid })
    .exportRange({ fromSeq: 0, generatedAt: '2026-10-23T03:30:00.000Z' });
  const file = 'other-dataset-package.easyorder-backup';
  const written = await writePackage(dir, file, exported.manifest, password);
  return { file, sha256: written.sha256, fromSeq: 0, toSeq: exported.toSeq };
}
