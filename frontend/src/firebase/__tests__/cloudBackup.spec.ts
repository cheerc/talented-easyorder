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
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../cloudOrderRepository';
import { UNDO_REASON } from '../../domain/cloudTransactionMutation';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_BACKUP === 'true';
if (required && !emulatorHost) throw new Error('P14 cloud backup Emulator gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const rulesPath = path.resolve(process.env.EASYORDER_TEST_RULES_PATH ?? path.resolve(process.cwd(), '../firestore.rules'));
const projectId = 'demo-easyorder';
const operator = { uid: 'p14-backup-operator', email: 'p14-backup@example.test', active: true };
const now = Timestamp.now();
const taipeiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
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

// Loading the full Rules into a cold Emulator can exceed Vitest's 10 s default hook timeout.
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(rulesPath, 'utf8') } });
}, 60_000);
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
        openingBalance: { amount: 100, asOfDate: taipeiToday(), note: '' } },
    });
    expect(committed, JSON.stringify(committed)).toMatchObject({ ok: true });
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

  it('exports, decrypts and replays real P10a mutation receipts with totals equal to day.totals', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const orders = createCloudOrderRepository(db, { currentUser: () => user });
    const today = taipeiToday();
    const studentId = uuid(500);
    let next = 500;
    const id = () => uuid(++next);
    const read = async (path: string) => (await getDoc(doc(db, path))).data() as Record<string, number & string>;
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: 7,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '500', displayName: 'Anonymous P10a fixture', aliases: [],
        openingBalance: { amount: 100, asOfDate: today, note: '' } } }));
    const revisions = async () => ({ student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${today}`)).revision });
    const createOrder = async (mealPrice: number, paidAmount: number) => {
      const r = await revisions(); const commandId = id(); const transactionId = id();
      okResult(await orders.createOrder({ commandId, transactionId, leaseEpoch: 7, studentId, dayId: today,
        expectedStudentRevision: r.student, expectedDayRevision: r.day, mealKind: 'other', mealPrice, paidAmount,
        menuRevision: null, otherItemName: '自備便當', note: '' }));
      return { commandId, transactionId };
    };
    const createPayment = async (paidAmount: number) => {
      const r = await revisions(); const commandId = id(); const transactionId = id();
      okResult(await orders.createPayment({ commandId, transactionId, leaseEpoch: 7, studentId, dayId: today,
        expectedStudentRevision: r.student, expectedDayRevision: r.day, paidAmount, note: '' }));
      return { commandId, transactionId };
    };
    const createRefund = async (amount: number) => {
      const r = await revisions(); const commandId = id(); const transactionId = id();
      okResult(await orders.createRefund({ commandId, transactionId, leaseEpoch: 7, studentId, dayId: today,
        expectedStudentRevision: r.student, expectedDayRevision: r.day, amount, reason: '溢繳退還' }));
      return { commandId, transactionId };
    };
    const createCash = async (direction: 'income' | 'expense', amount: number) => {
      const commandId = id(); const transactionId = id();
      okResult(await orders.createCashMovement({ commandId, transactionId, leaseEpoch: 7, dayId: today,
        expectedDayRevision: (await read(`days/${today}`)).revision, direction, amount, reason: '零錢補充' }));
      return { commandId, transactionId };
    };
    const mutate = async (transactionId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => {
      const tx = await read(`transactions/${transactionId}`);
      const cashierRow = tx.studentId === '__cashier__';
      okResult(await orders.mutateTransaction({ commandId: id(), leaseEpoch: 7, transactionId,
        studentId: tx.studentId, dayId: today, expectedTransactionRevision: tx.revision,
        expectedStudentRevision: cashierRow ? null : (await read(`students/${studentId}`)).revision,
        expectedDayRevision: (await read(`days/${today}`)).revision, ...spec } as CloudTransactionMutationInput));
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

    const exported = await createCloudBackupRepository(db, { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-16T03:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual([
      'EnsureDay', 'CreateStudent', 'CreateOrder', 'CorrectTransaction', 'CreateOrder', 'CancelKeepDeposit',
      'CreateOrder', 'CancelRefund', 'CreateCashMovement', 'Undo', 'CreatePayment', 'Undo', 'CreateRefund', 'VoidTransaction',
    ]);
    const cashierUndo = exported.manifest.records[9]!;
    expect(cashierUndo.targets).toEqual({ transactionId: cashUndo.transactionId, studentId: '__cashier__', dayId: today });
    expect(Object.keys(cashierUndo.expectedRevisions).sort()).toEqual(['day', 'transaction']);
    expect(Object.keys(exported.manifest.records[11]!.expectedRevisions).sort()).toEqual(['day', 'student', 'transaction']);

    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'p10a-round-trip'), 'p10a-round-trip');
    const replayed = replayBackupProjections(opened.records);
    expect(replayed).toEqual(opened.projectionState);
    const dayTotals = (await read(`days/${today}`)).totals as unknown as Record<string, number>;
    expect(opened.totals?.[today]).toEqual(dayTotals);
    expect(recalculateBackupTotals(replayed)[today]).toEqual(dayTotals);
    expect(dayTotals).toEqual({ activeTransactionCount: 2, bentoCount: 0, otherMealCount: 1, mealTotal: 70,
      retainedReceipts: 200, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0 });
    const projected = (transactionId: string) => replayed[`transactions/${transactionId}`] as Record<string, unknown>;
    expect(projected(corrected.transactionId)).toMatchObject({ type: 'order', status: 'active', mealPrice: 70, amount: 30, revision: 2 });
    expect(projected(kept.transactionId)).toMatchObject({ type: 'payment', status: 'active', mealPrice: 0, paidAmount: 100, amount: 100 });
    for (const voided of [refunded, cashUndo, paymentUndo, voidedRefund]) {
      expect(projected(voided.transactionId)).toMatchObject({ status: 'voided', revision: 2 });
    }
    expect((replayed[`students/${studentId}`] as Record<string, unknown>).currentBalance)
      .toBe((await read(`students/${studentId}`)).currentBalance);
    expect((await read(`students/${studentId}`)).currentBalance).toBe(230);

    // A forged replay that keeps the receipt chain but changes the corrected price is rejected.
    const forged = structuredClone(opened);
    (forged.records[3]!.after!.transaction as Record<string, unknown>).mealPrice = 60;
    expect(() => validateBackupManifest(forged)).toThrow(/seq 4/);
    // A P10a receipt whose student projection is dropped no longer matches the fixed shape.
    const dropped = structuredClone(opened);
    delete (dropped.records[5]!.before as Record<string, unknown>).student;
    expect(() => validateBackupManifest(dropped)).toThrow(/seq 6/);
  });

  it('exports, decrypts and replays a real P10b CorrectOpening receipt; a forged balance is rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const orders = createCloudOrderRepository(db, { currentUser: () => user });
    const today = taipeiToday();
    const studentId = uuid(600);
    let next = 600;
    const id = () => uuid(++next);
    const read = async (path: string) => (await getDoc(doc(db, path))).data() as Record<string, number & string>;
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: 7,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '600', displayName: 'Anonymous P10b fixture', aliases: [],
        openingBalance: { amount: 100, asOfDate: today, note: '' } } }));
    const revisions = async () => ({ student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${today}`)).revision });
    let r = await revisions();
    okResult(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: 7, studentId, dayId: today,
      expectedStudentRevision: r.student, expectedDayRevision: r.day, paidAmount: 150, note: '' }));
    r = await revisions();
    okResult(await writer.commitCommand({ commandId: id(), kind: 'CorrectOpening', leaseEpoch: 7,
      targets: { studentId, dayId: today }, expectedRevisions: { student: r.student, day: r.day },
      payload: { amount: 80, note: '核對後更正', reason: '期初抄錯' } }));

    const exported = await createCloudBackupRepository(db, { currentUid: () => operator.uid })
      .exportRange({ fromSeq: 0, generatedAt: '2026-10-17T03:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual(['EnsureDay', 'CreateStudent', 'CreatePayment', 'CorrectOpening']);
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'p10b-round-trip'), 'p10b-round-trip');
    const replayed = replayBackupProjections(opened.records);
    expect(replayed).toEqual(opened.projectionState);
    const studentAfter = replayed[`students/${studentId}`] as Record<string, unknown>;
    expect(studentAfter).toMatchObject({ currentBalance: 230, openingBalance: { amount: 80, asOfDate: today, note: '核對後更正' } });
    const dayTotals = (await read(`days/${today}`)).totals as unknown as Record<string, number>;
    expect(opened.totals?.[today]).toEqual(dayTotals);
    expect(recalculateBackupTotals(replayed)[today]).toEqual(dayTotals);

    // Keeping the receipt chain but moving the balance by more than the opening difference is rejected.
    const forged = structuredClone(opened);
    ((forged.records[3]!.after!.student as Record<string, unknown>)).currentBalance = 200;
    expect(() => validateBackupManifest(forged)).toThrow(/seq 4/);
  });

  it('exports, decrypts and replays real P11 close／reopen／re-close receipts across two increments; forged versions are rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const orders = createCloudOrderRepository(db, { currentUser: () => user });
    const closing = createCloudDayCloseRepository(db, { currentUser: () => user });
    const backups = createCloudBackupRepository(db, { currentUid: () => operator.uid });
    const today = taipeiToday();
    const studentId = uuid(700);
    let next = 700;
    const id = () => uuid(++next);
    const read = async (path: string) => (await getDoc(doc(db, path))).data() as Record<string, number & string>;
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const day = async () => read(`days/${today}`);
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: (await day()).revision }, payload: { openingCash: 1000 } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: 7,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '700', displayName: 'Anonymous P11 fixture', aliases: [],
        openingBalance: { amount: 0, asOfDate: today, note: '' } } }));
    const paymentId = id();
    okResult(await orders.createPayment({ commandId: id(), transactionId: paymentId, leaseEpoch: 7, studentId, dayId: today,
      expectedStudentRevision: (await read(`students/${studentId}`)).revision, expectedDayRevision: (await day()).revision,
      paidAmount: 150, note: '' }));
    const closeNow = async (countedCash: number, note: string) => {
      const current = await day();
      okResult(await closing.closeDay({ commandId: id(), leaseEpoch: 7, dayId: today,
        expectedDayRevision: current.revision, expectedSettlementRevision: current.lastSettlementRevision,
        expectedCash: (await closing.read(today))!.expectedCash!, countedCash, note }));
    };
    await closeNow(1140, '少 10 元');

    // First increment: 0..5, ending with the first close.
    const first = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-17T03:00:00.000Z' });
    expect(first.manifest.records.map(record => record.kind)).toEqual(['EnsureDay', 'SetOpeningCash', 'CreateStudent', 'CreatePayment', 'CloseDay']);
    const firstOpened = await decryptBackup(await encryptBackup(first.manifest, 'p11-round-trip'), 'p11-round-trip');
    expect(firstOpened.projectionState[`days/${today}/settlements/1`]).toMatchObject({ status: 'closed', expectedCash: 1150, difference: -10 });

    const current = await day();
    okResult(await closing.reopenDay({ commandId: id(), leaseEpoch: 7, dayId: today, expectedDayRevision: current.revision,
      expectedSettlementRevision: current.lastSettlementRevision, reason: '收款記錯' }));
    const payment = await read(`transactions/${paymentId}`);
    const mutation: CloudTransactionMutationInput = {
      commandId: id(), kind: 'VoidTransaction', leaseEpoch: 7, transactionId: paymentId, studentId, dayId: today,
      expectedTransactionRevision: payment.revision, expectedStudentRevision: (await read(`students/${studentId}`)).revision,
      expectedDayRevision: (await day()).revision, payload: { reason: '收款記錯' },
    };
    okResult(await orders.mutateTransaction(mutation));
    await closeNow(1000, '');

    // Second increment continues from the first package and replays on top of its projection state.
    const firstSha = await sha256Hex(await encryptBackup(firstOpened, 'p11-round-trip'));
    const second = await backups.exportRange({ fromSeq: 5, previousManifest: firstOpened, previousPackageSha256: firstSha,
      generatedAt: '2026-10-17T04:00:00.000Z' });
    expect(second.manifest.records.map(record => record.kind)).toEqual(['ReopenDay', 'VoidTransaction', 'CloseDay']);
    const opened = await decryptBackup(await encryptBackup(second.manifest, 'p11-round-trip'), 'p11-round-trip');
    const replayed = replayBackupProjections(opened.records, opened.baseState);
    expect(replayed).toEqual(opened.projectionState);
    expect(Object.keys(replayed).filter(key => key.startsWith(`days/${today}/settlements/`)).sort())
      .toEqual([1, 2, 3].map(n => `days/${today}/settlements/${n}`));
    expect(replayed[`days/${today}/settlements/1`]).toEqual(firstOpened.projectionState[`days/${today}/settlements/1`]);
    expect(replayed[`days/${today}/settlements/3`]).toMatchObject({ status: 'closed', expectedCash: 1000, countedCash: 1000, previousRevision: 2 });
    const dayTotals = (await day()).totals as unknown as Record<string, number>;
    expect(opened.totals?.[today]).toEqual(dayTotals);
    expect(recalculateBackupTotals(replayed)[today]).toEqual(dayTotals);

    // A version whose difference does not follow the counted − expected formula is rejected.
    const forgedDifference = structuredClone(opened);
    ((forgedDifference.records[2]!.after!.settlement as Record<string, unknown>)).difference = 5;
    expect(() => validateBackupManifest(forgedDifference)).toThrow(/seq 8/);
    // A reopen whose previous-version snapshot does not match the replayed version 1 is rejected.
    const forgedPrevious = structuredClone(opened);
    ((forgedPrevious.records[0]!.before!.previousSettlement as Record<string, unknown>)).countedCash = 1150;
    expect(() => validateBackupManifest(forgedPrevious)).toThrow();
    // Replaying the increment without the first package's settlement state is rejected too.
    const withoutBase = structuredClone(opened);
    delete withoutBase.baseState[`days/${today}/settlements/1`];
    expect(() => validateBackupManifest(withoutBase)).toThrow();
  });

  it('exports, decrypts and replays a real BackfillOpeningCash on a past day before its close; forged receipts are rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const closing = createCloudDayCloseRepository(db, { currentUser: () => user });
    const backups = createCloudBackupRepository(db, { currentUid: () => operator.uid });
    const shifted = new Date(`${taipeiToday()}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() - 1);
    const yesterday = shifted.toISOString().slice(0, 10);
    let next = 800;
    const id = () => uuid(++next);
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const day = async () => (await getDoc(doc(db, `days/${yesterday}`))).data() as Record<string, number & string>;
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: yesterday }, expectedRevisions: { day: 0 }, payload: { businessDate: yesterday } }));
    okResult(await closing.backfillOpening({ commandId: id(), leaseEpoch: 7, dayId: yesterday,
      expectedDayRevision: (await day()).revision, openingCash: 600, reason: '當天網路中斷' }));
    const current = await day();
    okResult(await closing.closeDay({ commandId: id(), leaseEpoch: 7, dayId: yesterday,
      expectedDayRevision: current.revision, expectedSettlementRevision: current.lastSettlementRevision,
      expectedCash: 600, countedCash: 590, note: '少 10 元' }));

    const exported = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-17T05:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual(['EnsureDay', 'BackfillOpeningCash', 'CloseDay']);
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'backfill-round-trip'), 'backfill-round-trip');
    const replayed = replayBackupProjections(opened.records, opened.baseState);
    expect(replayed).toEqual(opened.projectionState);
    expect(replayed[`days/${yesterday}`]).toMatchObject({ status: 'closed', openingCash: 600, openedBy: operator.uid });
    expect(replayed[`days/${yesterday}/settlements/1`]).toMatchObject({ openingCash: 600, expectedCash: 600, countedCash: 590, difference: -10 });
    expect(opened.records[1]).toMatchObject({ kind: 'BackfillOpeningCash', reason: '當天網路中斷', payload: { openingCash: 600, reason: '當天網路中斷' } });

    // A backfill whose day snapshot names another opener, or whose reason differs from the payload, is rejected.
    const forgedOpener = structuredClone(opened);
    (forgedOpener.records[1]!.after!.day as Record<string, unknown>).openedBy = 'someone-else';
    expect(() => validateBackupManifest(forgedOpener)).toThrow(/seq 2/);
    const forgedReason = structuredClone(opened);
    forgedReason.records[1]!.reason = 'other';
    expect(() => validateBackupManifest(forgedReason)).toThrow(/seq 2/);
    const forgedBefore = structuredClone(opened);
    (forgedBefore.records[1]!.before!.day as Record<string, unknown>).openingCash = 100;
    expect(() => validateBackupManifest(forgedBefore)).toThrow();
  });

  it('exports, decrypts and replays a real gap-day backfill — marker, backfilled order, payment and cash movement, then close; forgeries are rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const orders = createCloudOrderRepository(db, { currentUser: () => user });
    const closing = createCloudDayCloseRepository(db, { currentUser: () => user });
    const backups = createCloudBackupRepository(db, { currentUid: () => operator.uid });
    const shifted = new Date(`${taipeiToday()}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() - 2);
    const gap = shifted.toISOString().slice(0, 10);
    const studentId = uuid(900);
    let next = 900;
    const id = () => uuid(++next);
    const read = async (path: string) => (await getDoc(doc(db, path))).data() as Record<string, number & string>;
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    okResult(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: 7,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '900', displayName: 'Anonymous gap fixture', aliases: [],
        openingBalance: { amount: 100, asOfDate: '2026-10-01', note: '' } } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: gap }, expectedRevisions: { day: 0 }, payload: { businessDate: gap } }));
    okResult(await closing.backfillOpening({ commandId: id(), leaseEpoch: 7, dayId: gap,
      expectedDayRevision: (await read(`days/${gap}`)).revision, openingCash: 600, reason: '整天沒有用系統' }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: 7,
      targets: { dayId: gap }, expectedRevisions: { day: (await read(`days/${gap}`)).revision },
      payload: { reason: '前天停電，事後補登' } }));
    const revisions = async () => ({ student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${gap}`)).revision });
    let r = await revisions();
    okResult(await orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: 7, studentId, dayId: gap,
      expectedStudentRevision: r.student, expectedDayRevision: r.day, mealKind: 'other', mealPrice: 80, paidAmount: 0,
      menuRevision: null, otherItemName: '自備便當', note: '' }));
    r = await revisions();
    okResult(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: 7, studentId, dayId: gap,
      expectedStudentRevision: r.student, expectedDayRevision: r.day, paidAmount: 200, note: '' }));
    okResult(await orders.createCashMovement({ commandId: id(), transactionId: id(), leaseEpoch: 7, dayId: gap,
      expectedDayRevision: (await read(`days/${gap}`)).revision, direction: 'income', amount: 50, reason: '零錢補充' }));
    const current = await read(`days/${gap}`);
    okResult(await closing.closeDay({ commandId: id(), leaseEpoch: 7, dayId: gap,
      expectedDayRevision: current.revision, expectedSettlementRevision: current.lastSettlementRevision,
      expectedCash: 850, countedCash: 850, note: '', alignWithDayId: null }));

    const exported = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-18T05:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual([
      'CreateStudent', 'EnsureDay', 'BackfillOpeningCash', 'StartBackfill', 'CreateOrder', 'CreatePayment', 'CreateCashMovement', 'CloseDay',
    ]);
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'gap-round-trip'), 'gap-round-trip');
    const replayed = replayBackupProjections(opened.records, opened.baseState);
    expect(replayed).toEqual(opened.projectionState);
    expect(replayed[`backfillDays/${gap}`]).toMatchObject({ dayId: gap, reason: '前天停電，事後補登', startedBy: operator.uid });
    expect(replayed[`days/${gap}`]).toMatchObject({ status: 'closed', openingCash: 600 });
    expect(opened.records[3]).toMatchObject({ kind: 'StartBackfill', reason: '前天停電，事後補登', payload: { reason: '前天停電，事後補登' }, targets: { dayId: gap } });

    // A forged marker: another starter, another reason, another command, a different start time, an extra field.
    const forge = (change: (marker: Record<string, unknown>, record: BackupCommandRecord) => void) => {
      const copy = structuredClone(opened);
      change(copy.records[3]!.after!.backfill as Record<string, unknown>, copy.records[3]!);
      return copy;
    };
    expect(() => validateBackupManifest(forge(marker => { marker.startedBy = 'someone-else'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(marker => { marker.reason = '竄改的原因'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(marker => { marker.commandId = uuid(1); }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(marker => { marker.startedAt = { _type: 'timestamp', seconds: 1, nanoseconds: 0 }; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(marker => { marker.extra = true; }))).toThrow(/seq 4/);
    // The command-level reason and the payload reason must agree.
    expect(() => validateBackupManifest(forge((_marker, record) => { record.reason = '另一個原因'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge((_marker, record) => { record.payload = { reason: '另一個原因' }; }))).toThrow(/seq 4/);
    // The day must not change inside StartBackfill, and a marker needs a never-closed day.
    const dayChanged = structuredClone(opened);
    (dayChanged.records[3]!.after!.day as Record<string, unknown>).openingCash = 1;
    expect(() => validateBackupManifest(dayChanged)).toThrow(/seq 4/);
    const alreadyClosed = structuredClone(opened);
    (alreadyClosed.records[3]!.before!.day as Record<string, unknown>).lastSettlementRevision = 1;
    (alreadyClosed.records[3]!.after!.day as Record<string, unknown>).lastSettlementRevision = 1;
    expect(() => validateBackupManifest(alreadyClosed)).toThrow(/seq 4/);

    // A transaction created after its business day needs an earlier marker: without the StartBackfill record,
    // or with the transaction moved in front of it, the replay refuses.
    const withoutMarker = opened.records.filter(record => record.kind !== 'StartBackfill');
    expect(() => replayBackupProjections(withoutMarker, opened.baseState)).toThrow(/回填標記/);
    const reordered = [...opened.records.slice(0, 3), opened.records[4]!, opened.records[3]!, ...opened.records.slice(5)];
    expect(() => replayBackupProjections(reordered, opened.baseState)).toThrow(/回填標記/);
    // A marker replayed twice is refused.
    const duplicate = [...opened.records.slice(0, 4), opened.records[3]!, ...opened.records.slice(4)];
    expect(() => replayBackupProjections(duplicate, opened.baseState)).toThrow(/回填標記/);
    // A marker for a day that is not before the commit date (today) is refused at validation.
    const forToday = structuredClone(opened);
    expect(forToday.records[3]!.targets.dayId).toBe(gap);
    forToday.records[3]!.committedAt = { _type: 'timestamp', seconds: 1_760_000_000, nanoseconds: 0 };
    expect(() => validateBackupManifest(forToday)).toThrow(/seq 4/);
  });

  it('exports, decrypts and replays a real aligned close of a back-filled day (EnsureDay → opening → marker → entries → aligned close); forged alignments are rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const orders = createCloudOrderRepository(db, { currentUser: () => user });
    const closing = createCloudDayCloseRepository(db, { currentUser: () => user });
    const backups = createCloudBackupRepository(db, { currentUid: () => operator.uid });
    const shift = (offset: number) => {
      const date = new Date(`${taipeiToday()}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const gap = shift(-3);
    const later = shift(-1);
    const earlier = shift(-5);
    const studentId = uuid(950);
    let next = 950;
    const id = () => uuid(++next);
    const read = async (path: string) => (await getDoc(doc(db, path))).data() as Record<string, number & string>;
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    okResult(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: 7,
      targets: { studentId }, expectedRevisions: { student: 0 },
      payload: { studentCode: '950', displayName: 'Anonymous align fixture', aliases: [],
        openingBalance: { amount: 100, asOfDate: '2026-10-01', note: '' } } }));
    // An earlier day opened with the same 850: only "later than the day" keeps a forged alignment away from it.
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: earlier }, expectedRevisions: { day: 0 }, payload: { businessDate: earlier } }));
    okResult(await closing.backfillOpening({ commandId: id(), leaseEpoch: 7, dayId: earlier,
      expectedDayRevision: (await read(`days/${earlier}`)).revision, openingCash: 850, reason: '更早的一天' }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: gap }, expectedRevisions: { day: 0 }, payload: { businessDate: gap } }));
    okResult(await closing.backfillOpening({ commandId: id(), leaseEpoch: 7, dayId: gap,
      expectedDayRevision: (await read(`days/${gap}`)).revision, openingCash: 600, reason: '整天沒有用系統' }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'StartBackfill', leaseEpoch: 7,
      targets: { dayId: gap }, expectedRevisions: { day: (await read(`days/${gap}`)).revision },
      payload: { reason: '那天斷線，事後補登' } }));
    const revisions = async () => ({ student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${gap}`)).revision });
    const r = await revisions();
    okResult(await orders.createPayment({ commandId: id(), transactionId: id(), leaseEpoch: 7, studentId, dayId: gap,
      expectedStudentRevision: r.student, expectedDayRevision: r.day, paidAmount: 200, note: '' }));
    okResult(await orders.createCashMovement({ commandId: id(), transactionId: id(), leaseEpoch: 7, dayId: gap,
      expectedDayRevision: (await read(`days/${gap}`)).revision, direction: 'income', amount: 50, reason: '零錢補充' }));
    // The gap day must end at 850 (opening 600 + receipts 200 + income 50) because the next day opens with 850.
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: later }, expectedRevisions: { day: 0 }, payload: { businessDate: later } }));
    okResult(await closing.backfillOpening({ commandId: id(), leaseEpoch: 7, dayId: later,
      expectedDayRevision: (await read(`days/${later}`)).revision, openingCash: 850, reason: '隔天照常開店' }));
    const current = await read(`days/${gap}`);
    const closeInput = { commandId: id(), leaseEpoch: 7, dayId: gap,
      expectedDayRevision: current.revision, expectedSettlementRevision: current.lastSettlementRevision,
      expectedCash: 850, countedCash: 850, note: '' };
    // The nearest opened day is `later`; the writer refuses a null alignment.
    expect(await closing.closeDay({ ...closeInput, alignWithDayId: null })).toMatchObject({ ok: false });
    okResult(await closing.closeDay({ ...closeInput, alignWithDayId: later }));

    const exported = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-18T05:00:00.000Z' });
    const kinds = exported.manifest.records.map(record => record.kind);
    expect(kinds).toEqual([
      'CreateStudent', 'EnsureDay', 'BackfillOpeningCash', 'EnsureDay', 'BackfillOpeningCash', 'StartBackfill',
      'CreatePayment', 'CreateCashMovement', 'EnsureDay', 'BackfillOpeningCash', 'CloseDay',
    ]);
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'align-round-trip'), 'align-round-trip');
    expect(opened.records[10]).toMatchObject({ kind: 'CloseDay', payload: { countedCash: 850, expectedCash: 850, alignWithDayId: later } });
    const replayed = replayBackupProjections(opened.records, opened.baseState);
    expect(replayed).toEqual(opened.projectionState);
    expect(replayed[`days/${gap}`]).toMatchObject({ status: 'closed', openingCash: 600 });

    const closeAt = 10;
    const forge = (change: (record: BackupCommandRecord) => void) => {
      const copy = structuredClone(opened);
      change(copy.records[closeAt]!);
      return copy;
    };
    const payloadOf = (record: BackupCommandRecord) => record.payload as Record<string, unknown>;
    // Forged alignment day: missing, not later, the day itself, malformed.
    for (const align of [shift(-2), gap, earlier, '2026-10-1', 5]) {
      expect(() => validateBackupManifest(forge(record => { payloadOf(record).alignWithDayId = align; })), String(align)).toThrow(/對齊日|alignWithDayId|payload/);
    }
    // An earlier day with the same opening cash is refused only because it is not later than the closed day.
    expect(() => validateBackupManifest(forge(record => { payloadOf(record).alignWithDayId = earlier; }))).toThrow(/對齊日/);
    // Forged amount: the counted cash no longer meets the aligned day's opening cash.
    expect(() => validateBackupManifest(forge(record => {
      payloadOf(record).countedCash = 840;
      payloadOf(record).expectedCash = 840;
    }))).toThrow(/對齊日|settlement|差額|expectedCash|receipt/);
    // Forged difference: the stored settlement says the close was not even.
    expect(() => validateBackupManifest(forge(record => {
      const settlement = (record.after as Record<string, Record<string, unknown>>).settlement!;
      settlement.difference = -10; settlement.countedCash = 840;
      payloadOf(record).countedCash = 840;
    }))).toThrow(/差額|settlement|對齊日/);
    // The aligned day was opened with another amount (a coherent forgery of its own opening record): the close no longer meets it.
    const otherOpening = structuredClone(opened);
    (otherOpening.records[9]!.payload as Record<string, unknown>).openingCash = 800;
    (otherOpening.records[9]!.after!.day as Record<string, unknown>).openingCash = 800;
    expect(() => replayBackupProjections(otherOpening.records, otherOpening.baseState)).toThrow(/對齊日/);
    // At the time of the close the aligned day had no opening cash: replay the close before it was opened.
    const early = [...opened.records.slice(0, 8), opened.records[10]!, opened.records[8]!, opened.records[9]!];
    expect(() => replayBackupProjections(early, opened.baseState)).toThrow(/對齊日/);
    // A null alignment passes the decoder but the later opened day is a replay-time fact only when the key is present:
    // an alignment on a day without a marker is refused.
    const unmarked = opened.records.filter(record => !['StartBackfill', 'CreatePayment', 'CreateCashMovement'].includes(record.kind));
    expect(() => replayBackupProjections(unmarked, opened.baseState)).toThrow(/沒有回填標記/);
    // A close from before P11c3 (no alignWithDayId on a marked day) still replays.
    const legacy = structuredClone(opened);
    delete (legacy.records[closeAt]!.payload as Record<string, unknown>).alignWithDayId;
    expect(replayBackupProjections(legacy.records, legacy.baseState)).toEqual(opened.projectionState);
  });

  it('exports, decrypts and replays a real post-close entry across reopen and re-close (close → entry → reopen → re-close → entry); forged entries are rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const closing = createCloudDayCloseRepository(db, { currentUser: () => user });
    const backups = createCloudBackupRepository(db, { currentUid: () => operator.uid });
    const shifted = new Date(`${taipeiToday()}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() - 1);
    const dayId = shifted.toISOString().slice(0, 10);
    let next = 1100;
    const id = () => uuid(++next);
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const day = async () => (await getDoc(doc(db, `days/${dayId}`))).data() as Record<string, number & string>;
    const close = async (countedCash: number) => {
      const current = await day();
      okResult(await closing.closeDay({ commandId: id(), leaseEpoch: 7, dayId, expectedDayRevision: current.revision,
        expectedSettlementRevision: current.lastSettlementRevision, expectedCash: 600, countedCash, note: countedCash === 600 ? '' : '實點差額' }));
    };
    const entry = async (direction: 'income' | 'expense', amount: number, reason: string, commandId = id()) => {
      const current = await day();
      okResult(await closing.recordPostCloseEntry({ commandId, leaseEpoch: 7, dayId, expectedDayRevision: current.revision,
        expectedSettlementRevision: current.lastSettlementRevision, direction, amount, reason }));
    };
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId }, expectedRevisions: { day: 0 }, payload: { businessDate: dayId } }));
    okResult(await closing.backfillOpening({ commandId: id(), leaseEpoch: 7, dayId,
      expectedDayRevision: (await day()).revision, openingCash: 600, reason: '當天網路中斷' }));
    await close(590);
    await entry('expense', 10, '關帳後發現漏記買零錢');
    const reopenCurrent = await day();
    okResult(await closing.reopenDay({ commandId: id(), leaseEpoch: 7, dayId, expectedDayRevision: reopenCurrent.revision,
      expectedSettlementRevision: reopenCurrent.lastSettlementRevision, reason: '重新盤點' }));
    await close(600);
    await entry('income', 20, '關帳後發現漏記收款');

    const exported = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-18T05:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual([
      'EnsureDay', 'BackfillOpeningCash', 'CloseDay', 'RecordPostCloseEntry', 'ReopenDay', 'CloseDay', 'RecordPostCloseEntry',
    ]);
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'post-close-round-trip'), 'post-close-round-trip');
    const replayed = replayBackupProjections(opened.records, opened.baseState);
    expect(replayed).toEqual(opened.projectionState);
    const firstEntry = replayed[`postCloseEntries/${opened.records[3]!.commandId}`];
    const secondEntry = replayed[`postCloseEntries/${opened.records[6]!.commandId}`];
    expect(firstEntry).toMatchObject({ dayId, settlementRevision: 1, direction: 'expense', amount: 10, reason: '關帳後發現漏記買零錢', createdBy: operator.uid });
    expect(secondEntry).toMatchObject({ dayId, settlementRevision: 3, direction: 'income', amount: 20 });
    expect(opened.records[3]).toMatchObject({ reason: '關帳後發現漏記買零錢', payload: { direction: 'expense', amount: 10, reason: '關帳後發現漏記買零錢' } });
    // The day document is unchanged by an entry: revision and snapshot are identical before and after.
    expect(opened.records[3]!.before!.day).toEqual(opened.records[3]!.after!.day);

    const forge = (index: number, change: (entry: Record<string, unknown>, record: BackupCommandRecord) => void) => {
      const copy = structuredClone(opened);
      change(copy.records[index]!.after!.postCloseEntry as Record<string, unknown>, copy.records[index]!);
      return copy;
    };
    expect(() => validateBackupManifest(forge(3, entry => { entry.amount = 11; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.direction = 'income'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.reason = '竄改的原因'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.createdBy = 'someone-else'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.commandId = uuid(1); }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.entryId = uuid(1); }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.settlementRevision = 2; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.dayId = '2026-10-02'; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.createdAt = { _type: 'timestamp', seconds: 1, nanoseconds: 0 }; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, entry => { entry.extra = true; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, (_entry, record) => { record.reason = '另一個原因'; }))).toThrow(/seq 4/);
    // Rules trim only ASCII whitespace, so a Unicode-space-only reason can reach a raw-SDK write. The backup must never be
    // stricter than Rules, or one such immutable entry would block every later export.
    for (const blank of ['\u3000', '\u00a0\u3000']) {
      const blanked = forge(3, (entry, record) => {
        entry.reason = blank;
        record.reason = blank;
        (record.payload as Record<string, unknown>).reason = blank;
      });
      (blanked.projectionState[`postCloseEntries/${opened.records[3]!.commandId}`] as Record<string, unknown>).reason = blank;
      expect(() => validateBackupManifest(blanked), JSON.stringify(blank)).not.toThrow();
    }
    expect(() => validateBackupManifest(forge(3, (_entry, record) => { record.payload = { ...record.payload, amount: 20_001 }; }))).toThrow(/seq 4/);
    expect(() => validateBackupManifest(forge(3, (_entry, record) => { record.payload = { ...record.payload, direction: 'transfer' }; }))).toThrow(/seq 4/);
    // A day before the go-live date cannot take an entry.
    const beforeGoLive = structuredClone(opened);
    for (const head of [beforeGoLive.records[3]!.before!.head, beforeGoLive.records[3]!.after!.head] as Array<Record<string, unknown>>) head.goLiveDate = '2099-01-01';
    expect(() => validateBackupManifest(beforeGoLive)).toThrow(/seq 4/);
    // The day must stay unchanged and must be closed with the revisions the command names.
    const dayChanged = structuredClone(opened);
    (dayChanged.records[3]!.after!.day as Record<string, unknown>).openingCash = 1;
    expect(() => validateBackupManifest(dayChanged)).toThrow(/seq 4/);
    const dayNotClosed = structuredClone(opened);
    (dayNotClosed.records[3]!.before!.day as Record<string, unknown>).status = 'open';
    (dayNotClosed.records[3]!.after!.day as Record<string, unknown>).status = 'open';
    expect(() => validateBackupManifest(dayNotClosed)).toThrow(/seq 4/);
    const wrongSettlement = structuredClone(opened);
    wrongSettlement.records[3]!.expectedRevisions = { ...wrongSettlement.records[3]!.expectedRevisions, settlement: 2 };
    expect(() => validateBackupManifest(wrongSettlement)).toThrow(/seq 4/);
    const staleBefore = structuredClone(opened);
    staleBefore.records[3]!.before!.postCloseEntry = secondEntry;
    expect(() => validateBackupManifest(staleBefore)).toThrow(/seq 4/);
    // Replay: an entry before the day closed (reordered ahead of the first close), after the reopen without a
    // re-close, or applied twice, is refused.
    const beforeClose = [opened.records[0]!, opened.records[1]!, opened.records[3]!, opened.records[2]!, ...opened.records.slice(4)];
    expect(() => replayBackupProjections(beforeClose, opened.baseState)).toThrow();
    const whileReopened = opened.records.filter((_, index) => index !== 5);
    expect(() => replayBackupProjections(whileReopened, opened.baseState)).toThrow();
    const twice = [...opened.records.slice(0, 4), opened.records[3]!, ...opened.records.slice(4)];
    expect(() => replayBackupProjections(twice, opened.baseState)).toThrow();
    // Replay on its own (a coherent record against a base state): the day must be closed, at the settlement
    // version the entry names, and the entry must be new.
    const entryRecord = opened.records[3]!;
    const dayClosed = entryRecord.before!.day as Record<string, unknown>;
    const coherent = (day: Record<string, unknown>) => {
      const record = structuredClone(entryRecord);
      record.before!.day = structuredClone(day);
      record.after!.day = structuredClone(day);
      return record;
    };
    const baseWith = (day: Record<string, unknown>) => ({ [`days/${dayId}`]: structuredClone(day) });
    expect(() => replayBackupProjections([coherent(dayClosed)], baseWith(dayClosed))).not.toThrow();
    const dayOpen = { ...dayClosed, status: 'open' };
    expect(() => replayBackupProjections([coherent(dayOpen)], baseWith(dayOpen))).toThrow(/補記/);
    const dayReclosed = { ...dayClosed, lastSettlementRevision: 3 };
    expect(() => replayBackupProjections([coherent(dayReclosed)], baseWith(dayReclosed))).toThrow(/補記/);
    // An older backup without the new kind still validates and replays unchanged.
    const legacy = structuredClone(opened);
    legacy.records = legacy.records.slice(0, 3);
    expect(() => replayBackupProjections(legacy.records, legacy.baseState)).not.toThrow();
  });

  it('exports, decrypts and replays a real SetOpeningCash with a difference reason, and an older one without; forged reasons are rejected', async () => {
    await env.withSecurityRulesDisabled(async context => seed(context.firestore() as unknown as Firestore, 0, []));
    const db = authedDb();
    const user = { uid: operator.uid, email: operator.email, emailVerified: true, providerData: [{ providerId: 'google.com' }] } as unknown as User;
    const writer = createCloudCommandRepository(db, { currentUser: () => user });
    const backups = createCloudBackupRepository(db, { currentUid: () => operator.uid });
    const today = taipeiToday();
    let next = 900;
    const id = () => uuid(++next);
    const okResult = (result: { ok: boolean }) => expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const revision = async () => ((await getDoc(doc(db, `days/${today}`))).data() as Record<string, number>).revision;
    okResult(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: await revision() }, payload: { openingCash: 700, reason: '前一天實點與開帳不同' } }));
    okResult(await writer.commitCommand({ commandId: id(), kind: 'SetOpeningCash', leaseEpoch: 7,
      targets: { dayId: today }, expectedRevisions: { day: await revision() }, payload: { openingCash: 720 } }));

    const exported = await backups.exportRange({ fromSeq: 0, generatedAt: '2026-10-17T05:00:00.000Z' });
    expect(exported.manifest.records.map(record => record.kind)).toEqual(['EnsureDay', 'SetOpeningCash', 'SetOpeningCash']);
    const opened = await decryptBackup(await encryptBackup(exported.manifest, 'opening-reason-round-trip'), 'opening-reason-round-trip');
    const replayed = replayBackupProjections(opened.records, opened.baseState);
    expect(replayed).toEqual(opened.projectionState);
    expect(replayed[`days/${today}`]).toMatchObject({ openingCash: 720, revision: 3 });
    expect(opened.records[1]).toMatchObject({ reason: '前一天實點與開帳不同', payload: { openingCash: 700, reason: '前一天實點與開帳不同' } });
    expect(opened.records[2]).toMatchObject({ reason: null, payload: { openingCash: 720 } });

    const forgedReason = structuredClone(opened);
    forgedReason.records[1]!.reason = 'other';
    expect(() => validateBackupManifest(forgedReason)).toThrow(/seq 2/);
    const droppedReason = structuredClone(opened);
    delete (droppedReason.records[1]!.payload as Record<string, unknown>).reason;
    expect(() => validateBackupManifest(droppedReason)).toThrow(/seq 2/);
    const injectedReason = structuredClone(opened);
    injectedReason.records[2]!.reason = '憑空多出的原因';
    expect(() => validateBackupManifest(injectedReason)).toThrow(/seq 3/);
    const longReason = structuredClone(opened);
    longReason.records[1]!.reason = 'x'.repeat(501);
    (longReason.records[1]!.payload as Record<string, unknown>).reason = 'x'.repeat(501);
    expect(() => validateBackupManifest(longReason)).toThrow(/seq 2/);
    const emptyReason = structuredClone(opened);
    emptyReason.records[1]!.reason = '';
    (emptyReason.records[1]!.payload as Record<string, unknown>).reason = '';
    expect(() => validateBackupManifest(emptyReason)).toThrow(/seq 2/);
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

  it('fails closed for hand-built P11 receipts and for P10a receipts that do not follow the mutation math', () => {
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
    const plausibleProjectionState = replayBackupProjections(records, baseState);
    const correctedState = {
      'days/2026-10-16': day(5, 'open', 0, correctedTotals, uuid(5)),
      [`students/${studentId}`]: student(3, 70, uuid(5)),
      'transactions/transaction-1': transaction(4, 60, 30, uuid(5)),
    };
    const assertRejected = (candidate: BackupCommandRecord[], initial: Record<string, unknown> = baseState,
      reason: RegExp = /尚無完整備份語義，拒絕匯出/) => {
      // Kind rejection happens before the manifest's final replay comparison.
      // Keep a valid, independently replayed projection snapshot even when the
      // candidate record contains an intentionally forged semantic mutation.
      expect(() => validateBackupManifest({
        format: 'easyorder-command-backup', schemaVersion: 1, datasetId: 'anonymous-p14-fixture',
        commandSchemaVersion: 1, fromSeq: candidate[0]!.seq - 1, toSeq: candidate.at(-1)!.seq,
        previousPackageSha256: null, generatedAt: '2026-10-16T03:00:00.000Z', recordCount: candidate.length,
        records: candidate, baseState: initial, headCommandId: candidate.at(-1)?.commandId ?? null,
        projectionState: plausibleProjectionState, totals: recalculateBackupTotals(plausibleProjectionState),
      })).toThrow(reason);
    };
    // P10a kinds are decodable now. This hand-built CorrectTransaction omits payload.amount and carries a
    // zero cashEffect, so it must still fail closed; real P10a receipts are proven in the Emulator cases below.
    assertRejected(records, baseState, /seq 5/);

    const changedType = structuredClone(records);
    const changedTransaction = changedType[0]!.after!.transaction as Record<string, unknown>;
    changedTransaction.type = 'payment';
    changedTransaction.mealPrice = 0;
    changedTransaction.amount = 30;
    (changedType[0]!.payload as Record<string, unknown>).amount = 10;
    assertRejected([changedType[0]!], baseState, /seq 5/);

    const changedOpeningCash = structuredClone(records);
    (changedOpeningCash[1]!.after!.day as Record<string, unknown>).openingCash = 999;
    assertRejected([changedOpeningCash[1]!], correctedState, /seq 6/);

    const closedState: Record<string, unknown> = {
      ...correctedState,
      'days/2026-10-16': day(6, 'closed', 1, correctedTotals, uuid(6)),
      'days/2026-10-16/settlements/1': { dayId: '2026-10-16', revision: 1, status: 'closed', sourceSeq: 6,
        lastCommandId: uuid(6), committedAt: timestamp(6) },
    };
    assertRejected([records.find(item => item.kind === 'CorrectTransaction')!], baseState, /seq 5/);
    // P11 kinds are decodable now. These hand-built versions lack the fixed settlement fields
    // (totals, cash amounts, actor, previousRevision), so they still fail closed.
    assertRejected([records.find(item => item.kind === 'CloseDay')!], correctedState, /seq 6/);
    assertRejected([records.find(item => item.kind === 'ReopenDay')!], closedState, /seq 7/);
  });
});
