// @ts-expect-error Node-only file access is used to load the real Firestore Rules for Emulator tests.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path access is used to locate the real Firestore Rules.
import path from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { User } from 'firebase/auth';
import { Timestamp, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBackupManifest, decryptBackup, encryptBackup, recalculateBackupTotals, replayBackupProjections, sha256Hex, validateBackupManifest, type BackupCommandRecord } from '../cloudBackup';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_BACKUP === 'true';
if (required && !emulatorHost) throw new Error('P14 cloud backup Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
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

function backupReceipt(commandId: string, beforeHead: Record<string, unknown>, leaseEpoch = 7, extraProjection = false) {
  const afterHead = { ...beforeHead, seq: Number(beforeHead.seq) + 1, lastCommandId: commandId, updatedAt: serverTimestamp() };
  const before = { head: beforeHead, ...(extraProjection ? { student: null } : {}) };
  const after = { head: afterHead, ...(extraProjection ? { student: null } : {}) };
  return {
    command: {
      commandId, kind: 'RecordBackup', seq: Number(beforeHead.seq) + 1, leaseEpoch,
      actor: { uid: operator.uid, email: operator.email }, committedAt: serverTimestamp(),
      businessDate: null, studentId: null, targets: {}, expectedRevisions: {}, before, after,
      reason: null, cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      payload: { backupType: 'command-incremental', sourceSeq: beforeHead.seq, fromSeq: 0, toSeq: beforeHead.seq, sha256: 'a'.repeat(64) },
      inputFingerprint: 'b'.repeat(64),
    },
    afterHead,
  };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(rulesPath, 'utf8') } });
});
beforeEach(async () => env.clearFirestore());
afterAll(async () => env.cleanup());

describeWithEmulator('P14 cloud backup', () => {
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
      .exportRange({ fromSeq: 0 })).rejects.toThrow(/seq 1/);
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, ids));
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await db.doc('system/dataHead').update({ schemaVersion: 2 });
    });
    await expect(createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0 })).rejects.toThrow(/dataHead schema/);
  });

  it('detects duplicate seq values across page boundaries and at the captured H', async () => {
    const firstId = uuid(41); const duplicateId = uuid(42); const tailId = uuid(43);
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 2, [firstId, tailId]));
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const first = await getDoc(doc(db, 'commands', firstId));
      await setDoc(doc(db, 'commands', duplicateId), { ...first.data(), commandId: duplicateId, seq: 1 });
    });
    const repository = createCloudBackupRepository(authedDb(), { currentUid: () => operator.uid, pageSize: 1 });
    await expect(repository.exportRange({ fromSeq: 0 })).rejects.toThrow(/seq 2/);
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
    const exported = await createCloudBackupRepository(db, { currentUid: () => operator.uid }).exportRange({ fromSeq: 0 });
    expect(exported.manifest.records[0]?.leaseEpoch).toBe(7);
    const encrypted = await encryptBackup(exported.manifest, 'receipt-round-trip');
    const reopened = await decryptBackup(encrypted, 'receipt-round-trip');
    expect(reopened.records[0]?.leaseEpoch).toBe(7);
    expect(reopened.records[0]?.commandId).toBe(uuid(90));
  });

  it('exports and decrypts a real production writer command before recording its backup receipt', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const sourceCommandId = uuid(95);
    const committed = await writer.commitCommand({
      commandId: sourceCommandId, kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-16' }, expectedRevisions: { day: 0 },
      payload: { businessDate: '2026-10-16' },
    });
    expect(committed.ok).toBe(true);
    const exported = await createCloudBackupRepository(db, { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual(['EnsureDay']);
    expect(exported.manifest.projectionState['days/2026-10-16']).toMatchObject({ revision: 1, status: 'open' });
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'writer-round-trip'), 'writer-round-trip');
    expect(opened.headCommandId).toBe(sourceCommandId);
    expect(opened.totals?.['2026-10-16']).toMatchObject({ activeTransactionCount: 0 });
  });

  it('rejects CreateStudent payload mutations that disagree with the stored projection', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const studentId = uuid(96);
    const committed = await createCloudCommandRepository(db, { currentUser: () => user }).commitCommand({
      commandId: uuid(97), kind: 'CreateStudent', leaseEpoch: 7,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '096', displayName: 'Anonymous fixture', aliases: [],
        openingBalance: { amount: 100, asOfDate: '2026-10-16', note: '' } },
    });
    expect(committed.ok).toBe(true);
    const { manifest } = await createCloudBackupRepository(db, { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    const wrongBalance = structuredClone(manifest);
    (wrongBalance.records[0]!.payload.openingBalance as Record<string, unknown>).amount = 50;
    expect(() => validateBackupManifest(wrongBalance)).toThrow(/payload\/receipt 語義無效/);
    const wrongPayloadType = structuredClone(manifest);
    wrongPayloadType.records[0]!.payload.studentCode = { value: '096' };
    expect(() => validateBackupManifest(wrongPayloadType)).toThrow(/payload\/receipt 語義無效/);
  });

  it('allows a verified old H receipt when dataHead advanced after package creation', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const first = await writer.commitCommand({ commandId: uuid(88), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-16' }, expectedRevisions: { day: 0 }, payload: { businessDate: '2026-10-16' } });
    expect(first.ok).toBe(true);
    const exportedAtH = await createCloudBackupRepository(db, { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    expect(exportedAtH.toSeq).toBe(1);
    const later = await writer.commitCommand({ commandId: uuid(89), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: '2026-10-17' }, expectedRevisions: { day: 0 }, payload: { businessDate: '2026-10-17' } });
    expect(later.ok).toBe(true);
    const input = {
      commandId: uuid(98), kind: 'RecordBackup', leaseEpoch: 7,
      targets: {}, expectedRevisions: {},
      payload: { backupType: 'command-incremental', sourceSeq: 1, fromSeq: 0, toSeq: 1, sha256: await sha256Hex(await encryptBackup(exportedAtH.manifest, 'stale-head-fixture')) },
    };
    const result = await writer.commitCommand(input);
    expect(result.ok).toBe(true);
    expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(3);
    expect((await getDoc(doc(db, 'commands', uuid(98)))).data()?.before.head.seq).toBe(2);
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

  it('Rules reject an old lease epoch and extra receipt projections', async () => {
    for (const invalid of [{ epoch: 6, extra: false }, { epoch: 7, extra: true }]) {
      await env.clearFirestore();
      await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
      const db = authedDb();
      const head = (await getDoc(doc(db, 'system/dataHead'))).data() as Record<string, unknown>;
      const { command, afterHead } = backupReceipt(uuid(invalid.extra ? 93 : 92), head, invalid.epoch, invalid.extra);
      const batch = writeBatch(db);
      batch.set(doc(db, 'commands', command.commandId), command);
      batch.update(doc(db, 'system/dataHead'), afterHead);
      await expect(batch.commit()).rejects.toThrow();
    }
  });

  it('Rules reject replaying an existing RecordBackup receipt', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const commandId = uuid(94);
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const input = { commandId, kind: 'RecordBackup', leaseEpoch: 7, targets: {}, expectedRevisions: {},
      payload: { backupType: 'command-incremental', sourceSeq: 0, fromSeq: 0, toSeq: 0, sha256: 'a'.repeat(64) } };
    expect((await writer.commitCommand(input)).ok).toBe(true);
    const head = (await getDoc(doc(db, 'system/dataHead'))).data() as Record<string, unknown>;
    const replay = backupReceipt(commandId, head);
    const batch = writeBatch(db);
    batch.set(doc(db, 'commands', commandId), replay.command);
    batch.update(doc(db, 'system/dataHead'), replay.afterHead);
    await expect(batch.commit()).rejects.toThrow();
  });

  it('validates fixed target/revision-shaped records and encrypts with fresh AES-GCM parameters', async () => {
    const head = (seq: number, lastCommandId: string | null) => ({ schemaVersion: 1, datasetId: 'anonymous-p14-fixture',
      seq, lastCommandId, maintenance: false, goLiveDate: '2026-10-01', updatedAt: { _type: 'timestamp', seconds: seq, nanoseconds: 0 } });
    const record = {
      commandId: uuid(1), kind: 'RecordBackup', seq: 1, leaseEpoch: 7,
      datasetId: 'anonymous-p14-fixture', schemaVersion: 1,
      targets: {}, expectedRevisions: {}, before: { head: head(0, null) }, after: { head: head(1, uuid(1)) },
      payload: { backupType: 'command-incremental', sourceSeq: 0, fromSeq: 0, toSeq: 0, sha256: 'd'.repeat(64) },
      actor: { uid: 'anonymous-fixture', email: 'anonymous@example.test' }, committedAt: { _type: 'timestamp', seconds: 1, nanoseconds: 0 },
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
    const head = (seq: number, commandId: string | null) => ({ schemaVersion: 1, datasetId: 'anonymous-p14-fixture', seq,
      lastCommandId: commandId, maintenance: false, goLiveDate: '2026-10-01', updatedAt: { _type: 'timestamp', seconds: seq, nanoseconds: 0 } });
    const timestamp = (seconds: number) => ({ _type: 'timestamp', seconds, nanoseconds: 0 });
    const orderTotals = { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 50, retainedReceipts: 30, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 };
    const correctedTotals = { ...orderTotals, mealTotal: 60 };
    const studentId = uuid(2);
    const student = (revision: number, currentBalance: number, lastCommandId: string) => ({ studentId, studentCode: '001',
      displayName: 'Synthetic', aliases: [], revision, currentBalance,
      openingBalance: { amount: 100, asOfDate: '2026-10-16', note: '', createdAt: timestamp(1) },
      status: 'active', createdAt: timestamp(1), updatedAt: timestamp(revision), lastCommandId });
    const day = (revision: number, status: string, lastSettlementRevision: number, totals: typeof orderTotals, lastCommandId: string) => ({
      revision, status, menu: null, openingCash: 0, openedBy: 'anonymous-fixture', openedAt: timestamp(1),
      lastSettlementRevision, totals, lastCommandId, updatedAt: timestamp(revision),
    });
    const transaction = (revision: number, mealPrice: number, paidAmount: number, lastCommandId: string) => ({
      transactionId: 'transaction-1', studentId, businessDate: '2026-10-16', type: 'order',
      mealKind: 'bento', mealPrice, paidAmount, amount: paidAmount - mealPrice, studentNameSnapshot: 'Synthetic',
      menuNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '', vendorNameSnapshot: '', otherItemName: null,
      status: 'active', revision, createdSeq: 3, operatorUid: 'anonymous-fixture',
      operatorEmail: 'anonymous@example.test', sourceDevice: 'pc', note: revision === 4 ? 'synthetic correction' : '',
      createdAt: timestamp(1), updatedAt: timestamp(revision), lastCommandId,
    });
    const make = (index: number, kind: string, targets: Record<string, unknown>, expectedRevisions: Record<string, number>, before: Record<string, unknown>, after: Record<string, unknown>, payload: Record<string, unknown>): BackupCommandRecord => ({
      commandId: uuid(index), kind, seq: index, leaseEpoch: 7, datasetId: 'anonymous-p14-fixture', schemaVersion: 1,
      targets, expectedRevisions, before: { head: head(index - 1, uuid(index - 1)), ...before },
      after: { head: head(index, uuid(index)), ...after }, payload, actor: { uid: 'anonymous-fixture', email: 'anonymous@example.test' },
      committedAt: timestamp(index), businessDate: kind === 'CorrectTransaction' ? '2026-10-16' : null,
      studentId: kind === 'CorrectTransaction' ? studentId : null,
      reason: kind === 'CorrectTransaction' || kind === 'ReopenDay' ? String(payload.reason) : null,
      cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 }, inputFingerprint: 'c'.repeat(64),
    });
    const records = [
      make(5, 'CorrectTransaction', { transactionId: 'transaction-1', studentId, dayId: '2026-10-16' },
        { transaction: 3, student: 2, day: 4 }, { transaction: transaction(3, 50, 30, uuid(3)), student: student(2, 80, uuid(4)), day: day(4, 'open', 0, orderTotals, uuid(4)) },
        { transaction: transaction(4, 60, 30, uuid(5)), student: student(3, 70, uuid(5)), day: day(5, 'open', 0, correctedTotals, uuid(5)) },
        { mealPrice: 60, paidAmount: 30, note: 'synthetic correction', reason: 'fixture' }),
      make(6, 'CloseDay', { dayId: '2026-10-16', settlementRevision: 1 }, { day: 5, settlement: 0 },
        { day: day(5, 'open', 0, correctedTotals, uuid(5)), previousSettlement: null },
        { day: day(6, 'closed', 1, correctedTotals, uuid(6)), settlement: { dayId: '2026-10-16', revision: 1, status: 'closed', sourceSeq: 6, lastCommandId: uuid(6), committedAt: timestamp(6) } },
        { countedCash: 30, note: '', expectedCash: 30 }),
      make(7, 'ReopenDay', { dayId: '2026-10-16', settlementRevision: 2 }, { day: 6, settlement: 1 },
        { day: day(6, 'closed', 1, correctedTotals, uuid(6)), previousSettlement: { dayId: '2026-10-16', revision: 1, status: 'closed', sourceSeq: 6, lastCommandId: uuid(6), committedAt: timestamp(6) } },
        { day: day(7, 'reopened', 2, correctedTotals, uuid(7)), settlement: { dayId: '2026-10-16', revision: 2, status: 'reopened', sourceSeq: 7, lastCommandId: uuid(7), committedAt: timestamp(7) } },
        { reason: 'synthetic reopen' }),
    ];
    const baseState = { 'days/2026-10-16': day(4, 'open', 0, orderTotals, uuid(4)),
      [`students/${studentId}`]: student(2, 80, uuid(4)),
      'transactions/transaction-1': transaction(3, 50, 30, uuid(3)) };
    const projectionState = replayBackupProjections(records, baseState);
    const manifest = createBackupManifest({ datasetId: 'anonymous-p14-fixture', commandSchemaVersion: 1,
      fromSeq: 4, toSeq: 7, headCommandId: records.at(-1)?.commandId ?? null,
      previousPackageSha256: null, generatedAt: '2026-10-16T03:00:00.000Z',
      records, baseState, projectionState, totals: recalculateBackupTotals(projectionState) });
    expect(manifest.records.map(record => record.kind)).toContain('CorrectTransaction');
    expect(manifest.projectionState['daily_settlements/2026-10-16']).toMatchObject({ revision: 2, status: 'reopened' });
    const invalidClose = structuredClone(records);
    (invalidClose[1]!.after!.day as Record<string, unknown>).status = 'open';
    (invalidClose[1]!.after!.day as Record<string, unknown>).lastSettlementRevision = 0;
    expect(() => validateBackupManifest({ ...manifest, records: invalidClose })).toThrow(/CloseDay payload\/day\/settlement/);
    const invalidPayload = structuredClone(records);
    invalidPayload[0]!.payload.mealPrice = { value: 60 };
    expect(() => validateBackupManifest({ ...manifest, records: invalidPayload })).toThrow();
    const bad = records.map(record => ({ ...record }));
    bad[0] = { ...bad[0], targets: { transactionId: 'other-transaction', studentId, dayId: '2026-10-16' } };
    expect(() => replayBackupProjections(bad, baseState)).toThrow(/before 與前序重播狀態不符/);
  });
});
