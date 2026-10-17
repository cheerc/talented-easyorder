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
