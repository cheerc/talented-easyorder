// @ts-expect-error Node-only file access is used to load the real Firestore Rules for Emulator tests.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path access is used to locate the real Firestore Rules.
import path from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import { Timestamp, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBackupManifest, decryptBackup, encryptBackup, recalculateBackupTotals, replayBackupProjections, sha256Hex, type BackupCommandRecord } from '../cloudBackup';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
if (!emulatorHost) throw new Error('P14 cloud backup Emulator suite requires FIRESTORE_EMULATOR_HOST; it must not be skipped.');
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? path.resolve(process.cwd(), '../firestore.rules'));
const projectId = 'demo-easyorder';
const operator = { uid: 'p14-backup-operator', email: 'p14-backup@example.test', active: true };
const now = Timestamp.now();
let env: RulesTestEnvironment;

function authedDb(): Firestore {
  return env.authenticatedContext(operator.uid, {
    email: operator.email, email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore() as unknown as Firestore;
}

async function seed(db: Firestore, seq: number, ids: string[]) {
  const head = {
    schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq,
    lastCommandId: seq ? ids[seq - 1] : null, maintenance: false, goLiveDate: '2026-10-01', updatedAt: now,
  };
  await setDoc(doc(db, 'operators', operator.uid), { ...operator, email: operator.email });
  await setDoc(doc(db, 'system/accessLease'), { holderUid: operator.uid, epoch: 7, updatedAt: now });
  await setDoc(doc(db, 'system/dataHead'), head);
  for (let i = 0; i < ids.length; i += 1) {
    const commandId = ids[i];
    const command = {
      commandId, kind: 'RecordBackup', seq: i + 1, leaseEpoch: 7,
      actor: { uid: operator.uid, email: operator.email }, committedAt: now,
      businessDate: null, studentId: null, targets: {}, expectedRevisions: {},
      before: { head: { ...head, seq: i, lastCommandId: i ? ids[i - 1] : null } },
      after: { head: { ...head, seq: i + 1, lastCommandId: commandId } },
      reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload: { backupType: 'command-incremental', sourceSeq: i, fromSeq: 0, toSeq: i, sha256: 'a'.repeat(64) },
      inputFingerprint: 'b'.repeat(64),
    };
    await setDoc(doc(db, 'commands', commandId), command);
  }
}

function uuid(index: number) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`; }

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(rulesPath, 'utf8') } });
});
beforeEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());

describe('P14 cloud backup', () => {
  it('exports H=0 as a complete empty prefix and reads only the server head', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const result = await createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    expect(result.toSeq).toBe(0);
    expect(result.manifest.records).toEqual([]);
    expect(result.manifest.recordCount).toBe(0);
  });

  it('exports the contiguous fixed prefix, including RecordBackup, and does not include later seqs', async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    const result = await createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    expect(result.toSeq).toBe(2);
    expect(result.manifest.records.map(record => record.commandId)).toEqual(ids.slice(0, 2));
    expect(result.manifest.records.map(record => record.seq)).toEqual([1, 2]);
  });

  it('keeps the originally read H fixed while another command advances dataHead during paging', async () => {
    const ids = [uuid(11), uuid(12), uuid(13)];
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    let advanced = false;
    const repository = createCloudBackupRepository(authedDb(), {
      currentUid: () => operator.uid,
      pageSize: 1,
      afterPageRead: async lastSeq => {
        if (lastSeq === 1 && !advanced) {
          advanced = true;
          await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 3, ids));
        }
      },
    });
    const result = await repository.exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    expect(advanced).toBe(true);
    expect(result.toSeq).toBe(2);
    expect(result.manifest.records.map(record => record.seq)).toEqual([1, 2]);
  });

  it('produces a verifiable empty increment when S equals H and can resume from its head anchor', async () => {
    const ids = [uuid(21), uuid(22), uuid(23)];
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    const repository = createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid });
    const previous = await repository.exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    const noop = await repository.exportRange({ fromSeq: 2, previousManifest: previous.manifest,
      previousPackageSha256: '9'.repeat(64), generatedAt: '2026-10-16T03:01:00.000Z' });
    expect(noop.manifest.records).toEqual([]);
    expect(noop.manifest.headCommandId).toBe(ids[1]);
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 3, ids));
    const resumed = await repository.exportRange({ fromSeq: 2, previousManifest: noop.manifest,
      previousPackageSha256: '8'.repeat(64), generatedAt: '2026-10-16T03:02:00.000Z' });
    expect(resumed.manifest.records.map(record => record.commandId)).toEqual([ids[2]]);
  });

  it('fails closed on missing seq and on a non-holder query', async () => {
    const ids = [uuid(1), uuid(2)];
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    await env.withSecurityRulesDisabled(async context => context.firestore().collection('commands').doc(ids[0]).delete());
    await expect(createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0 })).rejects.toThrow(/seq 1/);
    const nonHolder = env.authenticatedContext('p14-non-holder', {
      email: 'p14-non-holder@example.test', email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    }).firestore() as unknown as Firestore;
    await expect(getDocs(collection(nonHolder, 'commands'))).rejects.toThrow();
  });

  it('fails closed on duplicate sequence numbers and dataset/schema mismatch', async () => {
    const ids = [uuid(31), uuid(32)];
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.collection('commands').doc(ids[1]).update({ seq: 1 });
    });
    await expect(createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0 })).rejects.toThrow(/seq 2/);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().collection('commands').doc(ids[0]).update({ 'before.head.datasetId': 'other-dataset' });
    });
    await expect(createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0 })).rejects.toThrow(/RecordBackup receipt/);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('system/dataHead').update({ schemaVersion: 2 });
    });
    await expect(createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0 })).rejects.toThrow(/dataHead schema/);
  });

  it('commits one atomic RecordBackup receipt without changing accounting projections', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const input = {
      commandId: uuid(90), kind: 'RecordBackup', leaseEpoch: 7,
      targets: {}, expectedRevisions: {},
      payload: { backupType: 'command-incremental', sourceSeq: 0, fromSeq: 0, toSeq: 0, sha256: 'e'.repeat(64) },
    };
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const result = await createCloudCommandRepository(authedDb(), { currentUser: () => user }).commitCommand(input);
    expect(result.ok).toBe(true);
    const db = authedDb();
    const commands = await getDocs(collection(db, 'commands'));
    expect(commands.docs.map(snapshot => snapshot.id)).toEqual([uuid(90)]);
    const head = await getDoc(doc(db, 'system/dataHead'));
    expect(head.data()?.seq).toBe(1);
    expect(head.data()?.lastCommandId).toBe(uuid(90));
  });

  it('Rules reject an unpaired or fabricated backup receipt', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const forged = {
      commandId: uuid(91), kind: 'RecordBackup', seq: 1, leaseEpoch: 7,
      actor: { uid: operator.uid, email: operator.email }, committedAt: serverTimestamp(),
      businessDate: null, studentId: null, targets: {}, expectedRevisions: {}, before: { head: {
        schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq: 0, lastCommandId: null,
        maintenance: false, goLiveDate: '2026-10-01', updatedAt: now,
      } }, after: { head: { schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq: 1, lastCommandId: uuid(91),
        maintenance: false, goLiveDate: '2026-10-01', updatedAt: serverTimestamp(),
      } }, reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload: { backupType: 'command-incremental', sourceSeq: 0, fromSeq: 0, toSeq: 0, sha256: 'f'.repeat(64) },
      inputFingerprint: 'a'.repeat(64),
    };
    const batch = writeBatch(db);
    batch.set(doc(db, 'commands', uuid(91)), forged);
    await expect(batch.commit()).rejects.toThrow();
  });

  it('validates fixed target/revision-shaped records and encrypts with fresh AES-GCM parameters', async () => {
    const record = {
      commandId: uuid(1), kind: 'RecordBackup', seq: 1, datasetId: 'anonymous-p14-fixture', schemaVersion: 1,
      targets: {}, expectedRevisions: {}, before: { head: { schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq: 0 } },
      after: { head: { schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq: 1, lastCommandId: uuid(1) } },
      payload: { backupType: 'command-incremental', sourceSeq: 0, fromSeq: 0, toSeq: 0, sha256: 'd'.repeat(64) },
      actor: { uid: 'anonymous-fixture', email: 'anonymous@example.test' }, committedAt: '2026-10-16T03:00:00.000Z',
      businessDate: null, studentId: null, reason: null,
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 }, inputFingerprint: 'c'.repeat(64),
    } as BackupCommandRecord;
    const manifest = createBackupManifest({ datasetId: record.datasetId, commandSchemaVersion: 1,
      fromSeq: 0, toSeq: 1, headCommandId: record.commandId,
      previousPackageSha256: null, generatedAt: '2026-10-16T03:00:00.000Z',
      records: [record], baseState: {}, projectionState: {}, totals: {} });
    const first = await encryptBackup(manifest, 'synthetic-passphrase');
    const second = await encryptBackup(manifest, 'synthetic-passphrase');
    expect(await sha256Hex(first)).not.toBe(await sha256Hex(second));
    expect((await decryptBackup(first, 'synthetic-passphrase')).records).toHaveLength(1);
    await expect(decryptBackup(first, 'wrong-password')).rejects.toThrow(/密碼錯誤/);
    const broken = first.slice(); broken[broken.length - 1] ^= 1;
    await expect(decryptBackup(broken, 'synthetic-passphrase')).rejects.toThrow();
  });

  it('replays P10 correction and P11 close/reopen settlement snapshots without skipping commands', () => {
    const head = (seq: number, commandId: string) => ({ schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq, lastCommandId: commandId });
    const zeroTotals = { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 };
    const orderTotals = { ...zeroTotals, activeTransactionCount: 1, bentoCount: 1, mealTotal: 50, retainedReceipts: 30 };
    const correctedTotals = { ...orderTotals, mealTotal: 60 };
    const student = (revision: number, currentBalance: number, lastCommandId: string) => ({ studentId: 'student-1', revision, currentBalance, lastCommandId });
    const day = (revision: number, status: string, lastSettlementRevision: number, totals: typeof zeroTotals, lastCommandId: string) => ({
      revision, status, lastSettlementRevision, totals, lastCommandId,
    });
    const transaction = (revision: number, mealPrice: number, lastCommandId: string) => ({
      transactionId: 'transaction-1', studentId: 'student-1', businessDate: '2026-10-16', type: 'order',
      mealKind: 'bento', mealPrice, paidAmount: 30, amount: 30 - mealPrice, status: 'active', revision, lastCommandId,
    });
    const make = (index: number, kind: string, targets: Record<string, unknown>, expectedRevisions: Record<string, number>, before: Record<string, unknown>, after: Record<string, unknown>, payload: Record<string, unknown>): BackupCommandRecord => ({
      commandId: uuid(index), kind, seq: index, datasetId: 'anonymous-p14-fixture', schemaVersion: 1,
      targets, expectedRevisions, before: { head: head(index - 1, index === 1 ? '' : uuid(index - 1)), ...before },
      after: { head: head(index, uuid(index)), ...after }, payload, actor: { uid: 'anonymous-fixture', email: 'anonymous@example.test' },
      committedAt: '2026-10-16T03:00:00.000Z', businessDate: '2026-10-16', studentId: null,
      reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 }, inputFingerprint: 'c'.repeat(64),
    });
    const records = [
      make(1, 'EnsureDay', { dayId: '2026-10-16' }, { day: 0 }, { day: null }, { day: day(1, 'open', 0, zeroTotals, uuid(1)) }, { businessDate: '2026-10-16' }),
      make(2, 'CreateStudent', { studentId: 'student-1' }, { student: 0 }, { student: null },
        { student: student(1, 100, uuid(2)) }, { studentCode: '001', displayName: 'Synthetic', aliases: [], openingBalance: { amount: 100, asOfDate: '2026-10-16', note: '' } }),
      make(3, 'CreateOrder', { transactionId: 'transaction-1', studentId: 'student-1', dayId: '2026-10-16' },
        { transaction: 0, student: 1, day: 1 }, { transaction: null, student: student(1, 100, uuid(2)), day: day(1, 'open', 0, zeroTotals, uuid(1)) },
        { transaction: transaction(1, 50, uuid(3)), student: student(2, 80, uuid(3)), day: day(2, 'open', 0, orderTotals, uuid(3)) },
        { mealPrice: 50, paidAmount: 30, mealKind: 'bento', menuRevision: 1, otherItemName: null, note: '' }),
      make(4, 'CorrectTransaction', { transactionId: 'transaction-1', studentId: 'student-1', dayId: '2026-10-16' },
        { transaction: 1, student: 2, day: 2 }, { transaction: transaction(1, 50, uuid(3)), student: student(2, 80, uuid(3)), day: day(2, 'open', 0, orderTotals, uuid(3)) },
        { transaction: transaction(2, 60, uuid(4)), student: student(3, 90, uuid(4)), day: day(3, 'open', 0, correctedTotals, uuid(4)) },
        { mealPrice: 60, paidAmount: 30, note: 'synthetic correction', reason: 'fixture' }),
      make(5, 'CloseDay', { dayId: '2026-10-16', settlementRevision: 1 }, { day: 3, settlement: 0 },
        { day: day(3, 'open', 0, correctedTotals, uuid(4)), settlement: null },
        { day: day(4, 'closed', 1, correctedTotals, uuid(5)), settlement: { businessDate: '2026-10-16', revision: 1, status: 'closed' } }, { countedCash: 30, note: '', expectedCash: 30 }),
      make(6, 'ReopenDay', { dayId: '2026-10-16', settlementRevision: 2 }, { day: 4, settlement: 1 },
        { day: day(4, 'closed', 1, correctedTotals, uuid(5)), settlement: { businessDate: '2026-10-16', revision: 1, status: 'closed' } },
        { day: day(5, 'reopened', 2, correctedTotals, uuid(6)), settlement: { businessDate: '2026-10-16', revision: 2, status: 'reopened' } }, { reason: 'synthetic reopen' }),
    ];
    const projectionState = replayBackupProjections(records);
    const manifest = createBackupManifest({ datasetId: 'anonymous-p14-fixture', commandSchemaVersion: 1,
      fromSeq: 0, toSeq: records.length, headCommandId: records.at(-1)?.commandId ?? null,
      previousPackageSha256: null, generatedAt: '2026-10-16T03:00:00.000Z',
      records, baseState: {}, projectionState, totals: recalculateBackupTotals(projectionState) });
    expect(manifest.records.map(record => record.kind)).toContain('CorrectTransaction');
    expect(manifest.projectionState['daily_settlements/2026-10-16']).toMatchObject({ revision: 2, status: 'reopened' });
    const bad = records.map(record => ({ ...record }));
    bad[3] = { ...bad[3], targets: { transactionId: 'other-transaction', studentId: 'student-1', dayId: '2026-10-16' } };
    expect(() => replayBackupProjections(bad)).toThrow(/before 與前序重播狀態不符/);
  });
});
