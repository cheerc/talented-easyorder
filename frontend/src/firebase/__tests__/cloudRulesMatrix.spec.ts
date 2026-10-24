// @ts-expect-error Node-only file access loads the real Rules and writes the optional JSON report.
import { readFileSync, writeFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  Timestamp, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, writeBatch,
  type DocumentData, type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ALL_COMMAND_KINDS, type BusinessCommandKind } from '../../domain/cloudCommands';
import { UNDO_REASON } from '../../domain/cloudTransactionMutation';
import { createCloudBackupRepository } from '../cloudBackupRepository';
import { createCloudBackupCommandRepository } from '../cloudBackupCommandRepository';
import { createCloudCommandRepository } from '../cloudCommandRepository';
import { createCloudDayCloseRepository } from '../cloudDayCloseRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../cloudOrderRepository';
import { createCloudReportActionRepository } from '../cloudReportActionRepository';
import { captureBatch, replayBatch, type BatchSdk, type CapturedWrite } from './helpers/batchCapture';
import {
  aliasSet, alpha, buildKindSteps, decoyStudent, gap, today, vendorA, type KindScenarioDeps,
} from './helpers/kindScenario';
import { R02_LEASE_EPOCH, R02_OPERATOR, operatorUser, seedEmptySource, uuid } from './helpers/r02Scenario';
import { COLLECTION_MATRIX, KIND_MATRIX, MUTATIONS, type CollectionMatrixEntry, type MutationId, type Readers } from './rulesMatrix';

/**
 * P16b: the allow / deny matrix of the real `firestore.rules` for all 27 command kinds (plan R4–R6), plus a read and bare
 * write matrix for every `match` block. Each kind is run through a production writer, whose batch is captured at its
 * `runTransaction` and sent again with raw `writeBatch` under a different identity, lease state or content. The
 * unchanged batch is sent last and must be accepted, so every refusal is caused by the one thing that was changed.
 */
vi.mock('firebase/firestore', async importOriginal => {
  const { wrapFirestoreModule } = await import('./helpers/batchCapture');
  return wrapFirestoreModule(await importOriginal<typeof import('firebase/firestore')>());
});

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const required = process.env.EASYORDER_REQUIRE_CLOUD_RULES_MATRIX === 'true';
if (required && !emulatorHost) throw new Error('P16b Rules matrix gate requires FIRESTORE_EMULATOR_HOST; refusing to skip.');
const describeWithEmulator = emulatorHost ? describe : describe.skip;
const [emulatorName = '127.0.0.1', emulatorPortText = '8080'] = (emulatorHost ?? '').split(':');
// EASYORDER_TEST_RULES_PATH only exists to prove the matrix has teeth: run it against a deliberately weakened copy of the Rules.
const rulesPath = process.env.EASYORDER_TEST_RULES_PATH ?? `${process.cwd()}/../firestore.rules`;
const reportPath = process.env.EASYORDER_P16_MATRIX_REPORT;

const OP = R02_OPERATOR;
const EPOCH = R02_LEASE_EPOCH;
const OTHER = { uid: 'p16b-other-operator', email: 'p16b-other@example.test', active: true };
const INACTIVE = { uid: 'p16b-inactive-operator', email: 'p16b-inactive@example.test', active: false };
const STRANGER = { uid: 'p16b-stranger', email: 'p16b-stranger@example.test' };

let env: RulesTestEnvironment;
let nextId = 5000;
const id = () => uuid(++nextId);

const sdk: BatchSdk = {
  doc: (db, path) => doc(db, path),
  writeBatch: db => writeBatch(db) as unknown as ReturnType<BatchSdk['writeBatch']>,
};

interface Identity { uid: string; email: string }

function dbFor(identity: Identity, over: { emailVerified?: boolean; provider?: string } = {}): Firestore {
  return env.authenticatedContext(identity.uid, {
    email: identity.email, email_verified: over.emailVerified ?? true, firebase: { sign_in_provider: (over.provider ?? 'google.com') as 'google.com' },
  }).firestore() as unknown as Firestore;
}
const anonymousDb = () => env.unauthenticatedContext().firestore() as unknown as Firestore;

async function admin<T>(run: (db: Firestore) => Promise<T>): Promise<T> {
  let result!: T;
  await env.withSecurityRulesDisabled(async context => { result = await run(context.firestore() as unknown as Firestore); });
  return result;
}
const adminData = (path: string) => admin(async db => (await getDoc(doc(db, path))).data());
const adminExists = (path: string) => admin(async db => (await getDoc(doc(db, path))).exists());
const adminList = (path: string) => admin(async db => (await getDocs(collection(db, path))).docs.map(item => item.id));

/** The state every attempt starts from: the operator approved, the lease held by them, fresh, at the epoch the commands carry. */
async function restoreBase(): Promise<void> {
  await admin(async db => {
    await setDoc(doc(db, `operators/${OP.uid}`), { ...OP });
    await setDoc(doc(db, 'system/accessLease'), { holderUid: OP.uid, epoch: EPOCH, updatedAt: Timestamp.now() });
  });
}
const setLease = (patch: Record<string, unknown>) => admin(db => setDoc(doc(db, 'system/accessLease'), {
  holderUid: OP.uid, epoch: EPOCH, updatedAt: Timestamp.now(), ...patch,
}));

// --- the scenario: every id and value the matrix steps share (helpers/kindScenario.ts)
const ctx: Record<string, string> = { operator: OP.uid, today, gap, alpha, vendor: vendorA, code: '731903' };

interface KindResult { step: string; writes: string[]; attempts: Partial<Record<MutationId, number>>; commandBytes: number }
const results = new Map<BusinessCommandKind, KindResult>();
const maxCommandBytes = new Map<string, number>();
const collectionResults = new Map<string, { reads: number; lists: number; limitChecks: number; bareWrites: number }>();

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value, (_key, item) => (item instanceof Timestamp ? item.toMillis() : item))).length;
}

/**
 * The Emulator lists every rule it evaluated in a refusal, and several of them (the siblings of the one that matters) run
 * out of the 1000-expression budget even when a check is what said no, so the message cannot be used to tell the two apart.
 * What shows that a refusal is a check and not the budget is the positive control: the unchanged batch, on the same data,
 * is accepted. This helper only requires a permission denial and counts the messages that mention the budget, for the report.
 */
const BUDGET_TEXT = /maximum of \d+ expressions|too complex to evaluate/i;
const refusalsMentioningBudget = new Map<string, number>();
async function assertDenied(attempt: Promise<unknown>, label: string): Promise<void> {
  const failure = await attempt.then(() => null, (error: unknown) => error ?? new Error('rejected without a reason'));
  if (failure === null) throw new Error(`${label}: expected the Rules to refuse, but the batch was accepted`);
  await assertFails(Promise.reject(failure));
  if (BUDGET_TEXT.test(failure instanceof Error ? failure.message : String(failure))) {
    const group = label.split(' ')[0]!;
    refusalsMentioningBudget.set(group, (refusalsMentioningBudget.get(group) ?? 0) + 1);
  }
}

interface Attempt { mutation: MutationId; label: string; send: () => Promise<void>; arrange?: () => Promise<void> }

/** Everything that is wrong with `writes` in one way, one attempt per way (plan R5, M1–M9). */
function attemptsFor(writes: CapturedWrite[], commandId: string, decoys: Array<{ label: string; write: CapturedWrite }>): Attempt[] {
  const attempts: Attempt[] = [];
  const holder = () => dbFor(OP);
  const add = (mutation: MutationId, label: string, send: () => Promise<void>, arrange?: () => Promise<void>) => {
    attempts.push({ mutation, label, send, ...(arrange ? { arrange } : {}) });
  };
  const commandIndex = writes.findIndex(write => write.path === `commands/${commandId}`);
  const others = writes.map((write, index) => ({ write, index })).filter(item => item.index !== commandIndex);

  add('M1', 'unauthenticated', () => replayBatch(sdk, anonymousDb(), writes));
  add('M2', 'operators document missing', () => replayBatch(sdk, holder(), writes), () => admin(db => deleteDoc(doc(db, `operators/${OP.uid}`))));
  add('M2', 'email not verified', () => replayBatch(sdk, dbFor(OP, { emailVerified: false }), writes));
  add('M2', 'sign-in provider is not google.com', () => replayBatch(sdk, dbFor(OP, { provider: 'password' }), writes));
  add('M3', 'operator is inactive', () => replayBatch(sdk, holder(), writes),
    () => admin(db => setDoc(doc(db, `operators/${OP.uid}`), { ...OP, active: false })));
  add('M4', 'lease held by another approved operator', () => replayBatch(sdk, holder(), writes), () => setLease({ holderUid: OTHER.uid }));
  add('M4', 'lease released, nobody holds it', () => replayBatch(sdk, holder(), writes), () => setLease({ holderUid: null }));
  add('M5', 'lease epoch has moved on', () => replayBatch(sdk, holder(), writes), () => setLease({ epoch: EPOCH + 1 }));
  add('M5', 'lease not renewed for 10 minutes', () => replayBatch(sdk, holder(), writes),
    () => setLease({ updatedAt: Timestamp.fromMillis(Date.now() - 10 * 60_000) }));

  const forge = (patch: (actor: { uid: string; email: string }) => { uid: string; email: string }) => writes.map((write, index) => {
    if (index !== commandIndex) return write;
    const data = write.data as { actor: { uid: string; email: string } };
    return { ...write, data: { ...data, actor: patch(data.actor) } };
  });
  add('M6', 'command actor.uid is someone else', () => replayBatch(sdk, holder(), forge(actor => ({ ...actor, uid: 'p16b-forged-uid' }))));
  add('M6', 'command actor.email is someone else', () => replayBatch(sdk, holder(), forge(actor => ({ ...actor, email: 'forged@example.test' }))));

  for (const { write, index } of others) {
    add('M7', `without the write to ${write.path}`, () => replayBatch(sdk, holder(), writes.filter((_item, at) => at !== index)));
  }
  add('M8', 'projections without the command', () => replayBatch(sdk, holder(), others.map(item => item.write)));
  add('M8', 'command without any projection', () => replayBatch(sdk, holder(), [writes[commandIndex]!]));
  for (const decoy of decoys) {
    add('M9', `plus a write to ${decoy.label}`, () => replayBatch(sdk, holder(), [...writes, decoy.write]));
  }
  return attempts;
}

/** Existing documents the command does not target, each given a plausible update that carries the same lastCommandId. */
async function decoyWrites(commandId: string, writes: CapturedWrite[]): Promise<Array<{ label: string; write: CapturedWrite }>> {
  const touched = new Set(writes.map(write => write.path));
  const candidates: Array<{ label: string; path: string; patch: DocumentData }> = [
    { label: 'another student', path: `students/${decoyStudent}`, patch: { displayName: 'Decoy edit' } },
    { label: 'a vendor', path: `vendors/${vendorA}`, patch: { name: 'Decoy edit' } },
    { label: 'the gap day', path: `days/${gap}`, patch: {} },
    { label: 'today', path: `days/${today}`, patch: {} },
  ];
  const decoys: Array<{ label: string; write: CapturedWrite }> = [];
  for (const candidate of candidates) {
    if (touched.has(candidate.path)) continue;
    const data = await adminData(candidate.path);
    if (!data) continue;
    decoys.push({
      label: candidate.label,
      write: {
        kind: 'update', path: candidate.path,
        data: { ...candidate.patch, revision: (data.revision as number) + 1, lastCommandId: commandId, updatedAt: serverTimestamp() },
      },
    });
  }
  return decoys;
}

/** One matrix step: capture the production batch, refuse every mutation, accept the unchanged batch, refuse its replay. */
async function runMatrixStep(kind: BusinessCommandKind, run: () => Promise<unknown>, setup?: () => Promise<void>): Promise<void> {
  await restoreBase();
  // Plain production writes that the step needs first; they commit for real, outside the capture.
  if (setup) await setup();
  const headBefore = (await adminData('system/dataHead'))!;
  const writes = await captureBatch(run);
  localStorage.clear();
  const commandWrite = writes.find(write => write.path.startsWith('commands/'));
  if (!commandWrite) throw new Error(`${kind}: the captured batch has no command document`);
  const commandId = commandWrite.path.slice('commands/'.length);
  expect(writes.some(write => write.path === 'system/dataHead'), `${kind} advances the head`).toBe(true);
  expect(writes.length, `${kind} has at least one projection beside the command`).toBeGreaterThan(1);

  const attempts: Partial<Record<MutationId, number>> = {};
  const decoys = await decoyWrites(commandId, writes);
  for (const attempt of attemptsFor(writes, commandId, decoys)) {
    await restoreBase();
    if (attempt.arrange) await attempt.arrange();
    await assertDenied(attempt.send(), `${kind} ${attempt.mutation} (${attempt.label})`);
    attempts[attempt.mutation] = (attempts[attempt.mutation] ?? 0) + 1;
  }
  await restoreBase();
  expect(await adminExists(`commands/${commandId}`), `${kind}: a refused batch left a command behind`).toBe(false);
  expect(await adminData('system/dataHead'), `${kind}: a refused batch changed the head`).toEqual(headBefore);

  // Positive control: the very same batch, unchanged, from the real holder.
  await replayBatch(sdk, dbFor(OP), writes);
  const headAfter = (await adminData('system/dataHead'))!;
  expect(headAfter.seq, `${kind}: the accepted batch advances the head by one`).toBe((headBefore.seq as number) + 1);
  expect(headAfter.lastCommandId).toBe(commandId);
  const stored = await adminData(`commands/${commandId}`);
  expect(stored?.kind).toBe(kind);

  // M10: the same accepted batch once more.
  await assertDenied(replayBatch(sdk, dbFor(OP), writes), `${kind} M10 (replay)`);
  attempts.M10 = 1;
  expect(await adminData('system/dataHead'), `${kind}: the replay changed the head`).toEqual(headAfter);

  results.set(kind, { step: KIND_MATRIX[kind]!.step, writes: writes.map(write => write.path.replace(/\/[^/]+$/, '/*')), attempts, commandBytes: utf8Bytes(stored) });
}

describeWithEmulator('P16b Rules matrix on the real firestore.rules', () => {
  const user = operatorUser();
  let db: Firestore;
  let writer: ReturnType<typeof createCloudCommandRepository>;
  let orders: ReturnType<typeof createCloudOrderRepository>;
  let closing: ReturnType<typeof createCloudDayCloseRepository>;
  let backups: ReturnType<typeof createCloudBackupRepository>;
  let backupReceipts: ReturnType<typeof createCloudBackupCommandRepository>;
  let reports: ReturnType<typeof createCloudReportActionRepository>;

  const read = async (path: string) => (await adminData(path)) as Record<string, number & string>;
  const ok = (result: { ok: boolean }, label: string) => {
    if (!result.ok) throw new Error(`P16b scenario: ${label} failed ${JSON.stringify(result)}`);
  };
  const headSeq = async () => (await read('system/dataHead')).seq as number;
  const revisions = async (studentId: string, dayId: string) => ({
    student: (await read(`students/${studentId}`)).revision, day: (await read(`days/${dayId}`)).revision,
  });

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: { host: emulatorName, port: Number(emulatorPortText), rules: readFileSync(rulesPath, 'utf8') },
    });
    await seedEmptySource(env, 'anonymous-p16b-matrix');
    db = dbFor(OP);
    const current = { currentUser: () => user };
    writer = createCloudCommandRepository(db, current);
    orders = createCloudOrderRepository(db, current);
    closing = createCloudDayCloseRepository(db, current);
    backups = createCloudBackupRepository(db, { currentUid: () => OP.uid });
    backupReceipts = createCloudBackupCommandRepository(db, current);
    reports = createCloudReportActionRepository(db, current);
    // A student that exists before the first step, so that even CreateStudent has a decoy to be refused next to.
    ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: EPOCH, targets: { studentId: decoyStudent },
      expectedRevisions: { student: 0 }, payload: { studentCode: '731910', displayName: 'P16b Decoy', aliases: [],
        openingBalance: { amount: 0, asOfDate: '2026-10-01', note: '' } } }), 'decoy student');
  }, 180_000);
  afterAll(async () => { await env.cleanup(); });

  const step = (kind: BusinessCommandKind, run: () => Promise<unknown>, setup?: () => Promise<void>) => it(KIND_MATRIX[kind]!.step, async () => {
    await runMatrixStep(kind, run, setup);
  }, 180_000);

  const deps: KindScenarioDeps = {
    get writer() { return writer; },
    get orders() { return orders; },
    get closing() { return closing; },
    get backups() { return backups; },
    get backupReceipts() { return backupReceipts; },
    get reports() { return reports; },
    epoch: EPOCH,
    backupPassword: 'p16b-matrix-password',
    read, id, ok, headSeq, revisions,
  };
  // S01–S27: the steps are shared with the capacity spec (helpers/kindScenario.ts).
  for (const scenarioStep of buildKindSteps(deps)) step(scenarioStep.kind, scenarioStep.run, scenarioStep.setup);

  // The longest text every free-text field accepts (schema limits: names, aliases and phone 100, notes and reasons 500),
  // written for real through the production writers. Rules must accept them and the command document stays small.
  it('the longest legal text is accepted for every kind that carries free text', async () => {
    await restoreBase();
    const text = (char: string, length: number) => char.repeat(length);
    const commit = async (label: string, run: (commandId: string) => Promise<{ ok: boolean }>) => {
      const commandId = id();
      ok(await run(commandId), `max payload ${label}`);
      maxCommandBytes.set(label, Math.max(maxCommandBytes.get(label) ?? 0, utf8Bytes(await adminData(`commands/${commandId}`))));
    };
    const big = uuid(900_020); const bigVendor = uuid(900_021); const bigVendorGone = uuid(900_022);
    const aliases = (char: string) => aliasSet(char);
    const bigRevision = async () => (await read(`students/${big}`)).revision;
    const dayRevision = async () => (await read(`days/${today}`)).revision;
    const bigOrder = async (): Promise<string> => {
      const rev = await revisions(big, today); const transactionId = id();
      await commit('CreateOrder', commandId => orders.createOrder({ commandId, transactionId, leaseEpoch: EPOCH, studentId: big, dayId: today,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
        menuRevision: null, otherItemName: text('餐', 100), note: text('單', 500) }));
      return transactionId;
    };
    const mutate = (label: string, transactionId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => commit(label, async commandId => {
      const tx = await read(`transactions/${transactionId}`);
      return orders.mutateTransaction({ commandId, leaseEpoch: EPOCH, transactionId, studentId: tx.studentId, dayId: today,
        expectedTransactionRevision: tx.revision, expectedStudentRevision: await bigRevision(), expectedDayRevision: await dayRevision(),
        ...spec } as CloudTransactionMutationInput);
    });

    await commit('CreateStudent', commandId => writer.commitCommand({ commandId, kind: 'CreateStudent', leaseEpoch: EPOCH,
      targets: { studentId: big }, expectedRevisions: { student: 0 },
      payload: { studentCode: '731920', displayName: text('名', 100), aliases: aliases('甲'), openingBalance: { amount: 0, asOfDate: today, note: text('備', 500) } } }));
    await commit('EditStudent', async commandId => writer.commitCommand({ commandId, kind: 'EditStudent', leaseEpoch: EPOCH,
      targets: { studentId: big }, expectedRevisions: { student: await bigRevision() },
      payload: { displayName: text('姓', 100), aliases: aliases('乙') } }));
    await commit('ChangeStudentCode', async commandId => writer.commitCommand({ commandId, kind: 'ChangeStudentCode', leaseEpoch: EPOCH,
      targets: { studentId: big }, expectedRevisions: { student: await bigRevision() },
      payload: { studentCode: '731921', reason: text('改', 500) } }));
    await commit('SetStudentStatus', async commandId => writer.commitCommand({ commandId, kind: 'SetStudentStatus', leaseEpoch: EPOCH,
      targets: { studentId: big }, expectedRevisions: { student: await bigRevision() },
      payload: { status: 'inactive', reason: text('停', 500) } }));
    await commit('SetStudentStatus', async commandId => writer.commitCommand({ commandId, kind: 'SetStudentStatus', leaseEpoch: EPOCH,
      targets: { studentId: big }, expectedRevisions: { student: await bigRevision() },
      payload: { status: 'active', reason: text('復', 500) } }));
    await commit('CorrectOpening', async commandId => writer.commitCommand({ commandId, kind: 'CorrectOpening', leaseEpoch: EPOCH,
      targets: { studentId: big, dayId: today }, expectedRevisions: { student: await bigRevision(), day: await dayRevision() },
      payload: { amount: 5, note: text('核', 500), reason: text('正', 500) } }));

    await commit('SaveVendor', commandId => writer.commitCommand({ commandId, kind: 'SaveVendor', leaseEpoch: EPOCH,
      targets: { vendorId: bigVendor }, expectedRevisions: { vendor: 0 },
      payload: { vendorId: bigVendor, name: text('商', 100), phone: text('9', 100), note: text('註', 500), status: 'active' } }));
    await commit('SaveVendor', commandId => writer.commitCommand({ commandId, kind: 'SaveVendor', leaseEpoch: EPOCH,
      targets: { vendorId: bigVendorGone }, expectedRevisions: { vendor: 0 },
      payload: { vendorId: bigVendorGone, name: text('廠', 100), phone: '', note: '', status: 'active' } }));
    await commit('SaveVendor', async commandId => writer.commitCommand({ commandId, kind: 'SaveVendor', leaseEpoch: EPOCH,
      targets: { vendorId: bigVendorGone }, expectedRevisions: { vendor: (await read(`vendors/${bigVendorGone}`)).revision },
      payload: { vendorId: bigVendorGone, name: text('廠', 100), phone: text('8', 100), note: text('停', 500), status: 'inactive' } }));
    await commit('RemoveVendor', async commandId => writer.commitCommand({ commandId, kind: 'RemoveVendor', leaseEpoch: EPOCH,
      targets: { vendorId: bigVendorGone }, expectedRevisions: { vendor: (await read(`vendors/${bigVendorGone}`)).revision },
      payload: { reason: text('除', 500) } }));
    await commit('SetDayMenu', async commandId => writer.commitCommand({ commandId, kind: 'SetDayMenu', leaseEpoch: EPOCH, targets: { dayId: today },
      expectedRevisions: { day: await dayRevision(), headSeq: await headSeq() },
      payload: { selectionDate: today, itemName: text('菜', 100), price: 90, vendorId: bigVendor, vendorNameSnapshot: text('商', 100), inheritedFromDate: null } }));
    await commit('SetOpeningCash', async commandId => writer.commitCommand({ commandId, kind: 'SetOpeningCash', leaseEpoch: EPOCH,
      targets: { dayId: today }, expectedRevisions: { day: await dayRevision() },
      payload: { openingCash: 1200, reason: text('零', 500) } }));

    const corrected = await bigOrder();
    await mutate('CorrectTransaction', corrected, { kind: 'CorrectTransaction',
      payload: { mealPrice: 70, paidAmount: 100, amount: 30, note: text('更', 500), reason: text('因', 500) } });
    await mutate('CancelKeepDeposit', await bigOrder(), { kind: 'CancelKeepDeposit', payload: { reason: text('留', 500) } });
    await mutate('CancelRefund', await bigOrder(), { kind: 'CancelRefund', payload: { reason: text('退', 500) } });
    const payment = { commandId: id(), transactionId: id() };
    const paymentRev = await revisions(big, today);
    ok(await orders.createPayment({ commandId: payment.commandId, transactionId: payment.transactionId, leaseEpoch: EPOCH, studentId: big, dayId: today,
      expectedStudentRevision: paymentRev.student, expectedDayRevision: paymentRev.day, paidAmount: 30, note: text('繳', 500) }), 'max CreatePayment');
    maxCommandBytes.set('CreatePayment', utf8Bytes(await adminData(`commands/${payment.commandId}`)));
    await mutate('Undo', payment.transactionId, { kind: 'Undo', payload: { targetCommandId: payment.commandId, reason: UNDO_REASON } });
    await commit('CreateCashMovement', async commandId => orders.createCashMovement({ commandId, transactionId: id(), leaseEpoch: EPOCH, dayId: today,
      expectedDayRevision: await dayRevision(), direction: 'expense', amount: 5, reason: text('支', 500) }));
    const refundId = id();
    await commit('CreateRefund', async commandId => {
      const rev = await revisions(big, today);
      return orders.createRefund({ commandId, transactionId: refundId, leaseEpoch: EPOCH, studentId: big, dayId: today,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, amount: 20, reason: text('還', 500) });
    });
    await mutate('VoidTransaction', refundId, { kind: 'VoidTransaction', payload: { reason: text('廢', 500) } });

    await commit('CloseDay', async commandId => {
      const day = await read(`days/${today}`);
      const expected = (await closing.read(today))!.expectedCash!;
      return closing.closeDay({ commandId, leaseEpoch: EPOCH, dayId: today, expectedDayRevision: day.revision,
        expectedSettlementRevision: day.lastSettlementRevision, expectedCash: expected, countedCash: expected - 1, note: text('結', 500) });
    });
    await commit('ReopenDay', async commandId => {
      const day = await read(`days/${today}`);
      return closing.reopenDay({ commandId, leaseEpoch: EPOCH, dayId: today, expectedDayRevision: day.revision,
        expectedSettlementRevision: day.lastSettlementRevision, reason: text('重', 500) });
    });

    for (const [kind, bytes] of maxCommandBytes) expect(bytes, `${kind} command document`).toBeLessThan(64 * 1024);
    expect(maxCommandBytes.size).toBeGreaterThanOrEqual(20);
  }, 300_000);

  // P16x regression: the number of aliases, not their length, used to push CreateOrder, CreatePayment and the transaction
  // changes over the Rules' expression budget. Each case builds its own student (and today's day if it is missing), so that
  // it can also be run alone as the probe case of docs/ops/p05-rules-budget.md.
  const ensureToday = async () => {
    await restoreBase();
    if (!(await adminExists(`days/${today}`))) {
      ok(await writer.commitCommand({ commandId: id(), kind: 'EnsureDay', leaseEpoch: EPOCH,
        targets: { dayId: today }, expectedRevisions: { day: 0 }, payload: { businessDate: today } }), 'EnsureDay today');
    }
  };
  const chargeStudent = async (studentId: string, studentCode: string, aliases: string[], everyKind: boolean) => {
    await ensureToday();
    ok(await writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: EPOCH, targets: { studentId },
      expectedRevisions: { student: 0 }, payload: { studentCode, displayName: 'P16x student', aliases,
        openingBalance: { amount: 0, asOfDate: '2026-10-01', note: '' } } }), 'student');
    const order = async (): Promise<string> => {
      const rev = await revisions(studentId, today); const transactionId = id();
      ok(await orders.createOrder({ commandId: id(), transactionId, leaseEpoch: EPOCH, studentId, dayId: today,
        expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other', mealPrice: 80, paidAmount: 100,
        menuRevision: null, otherItemName: 'x', note: '' }), 'CreateOrder');
      return transactionId;
    };
    const change = async (transactionId: string, spec: Pick<CloudTransactionMutationInput, 'kind' | 'payload'>) => {
      const tx = await read(`transactions/${transactionId}`);
      ok(await orders.mutateTransaction({ commandId: id(), leaseEpoch: EPOCH, transactionId, studentId, dayId: today,
        expectedTransactionRevision: tx.revision, expectedStudentRevision: (await read(`students/${studentId}`)).revision,
        expectedDayRevision: (await read(`days/${today}`)).revision, ...spec } as CloudTransactionMutationInput), spec.kind);
    };
    const first = await order();
    const payRev = await revisions(studentId, today); const paymentCommand = id(); const paymentTransaction = id();
    ok(await orders.createPayment({ commandId: paymentCommand, transactionId: paymentTransaction, leaseEpoch: EPOCH, studentId, dayId: today,
      expectedStudentRevision: payRev.student, expectedDayRevision: payRev.day, paidAmount: 30, note: '' }), 'CreatePayment');
    if (!everyKind) return;
    await change(first, { kind: 'CorrectTransaction', payload: { mealPrice: 70, paidAmount: 100, amount: 30, note: '', reason: 'P16x correct' } });
    await change(await order(), { kind: 'CancelKeepDeposit', payload: { reason: 'P16x keep' } });
    await change(await order(), { kind: 'CancelRefund', payload: { reason: 'P16x refund' } });
    await change(paymentTransaction, { kind: 'Undo', payload: { targetCommandId: paymentCommand, reason: UNDO_REASON } });
    const refundRev = await revisions(studentId, today); const refundId = id();
    ok(await orders.createRefund({ commandId: id(), transactionId: refundId, leaseEpoch: EPOCH, studentId, dayId: today,
      expectedStudentRevision: refundRev.student, expectedDayRevision: refundRev.day, amount: 20, reason: 'P16x overpaid' }), 'CreateRefund');
    await change(refundId, { kind: 'VoidTransaction', payload: { reason: 'P16x void' } });
  };
  it('a student with two short aliases can be charged and can pay', async () => {
    await chargeStudent(uuid(900_029), '731924', ['a', 'b'], false);
  }, 120_000);
  it('a student with three short aliases can be charged and can pay', async () => {
    await chargeStudent(uuid(900_030), '731925', ['a', 'b', 'c'], false);
  }, 120_000);
  it('a student with ten 100-character aliases can be charged, can pay and can have every kind of change', async () => {
    await chargeStudent(uuid(900_031), '731926', aliasSet('丙'), true);
  }, 180_000);

  // P16x must not loosen anything: an alias list is still checked in full wherever it is written or changed.
  it('aliases that are not valid are still refused whenever the aliases are written or changed', async () => {
    await ensureToday();
    const badLists: Array<{ label: string; aliases: unknown[] }> = [
      { label: 'eleven aliases', aliases: Array.from({ length: 11 }, (_item, index) => `a${index}`) },
      { label: 'an alias of 101 characters', aliases: ['x'.repeat(101)] },
      { label: 'an empty alias', aliases: ['ok', ''] },
      { label: 'an alias that is not text', aliases: ['ok', 7] },
      { label: 'the tenth alias empty', aliases: [...Array.from({ length: 9 }, (_item, index) => `a${index}`), ''] },
    ];
    // The command receipt carries the student as it will be (and, for CreateStudent and EditStudent, the aliases in its payload),
    // so they are changed too: the batch then agrees with itself and only the alias check can refuse it.
    const withAliases = (writes: CapturedWrite[], path: string, aliases: unknown[]) => writes.map(write => {
      if (write.path === path) return { ...write, data: { ...write.data, aliases } };
      if (write.path.startsWith('commands/')) {
        const data = write.data as { after: { student: DocumentData }; payload: DocumentData };
        return { ...write, data: { ...data, after: { ...data.after, student: { ...data.after.student, aliases } },
          ...('aliases' in data.payload ? { payload: { ...data.payload, aliases } } : {}) } };
      }
      return write;
    });
    const checkAll = async (what: string, writes: CapturedWrite[], path: string, lists: Array<{ label: string; aliases: unknown[] }>) => {
      for (const list of lists) {
        await assertDenied(replayBatch(sdk, dbFor(OP), withAliases(writes, path, list.aliases)), `${what} with ${list.label}`);
      }
    };

    // CreateStudent and EditStudent write aliases.
    const created = uuid(900_040);
    const createWrites = await captureBatch(async () => writer.commitCommand({ commandId: id(), kind: 'CreateStudent', leaseEpoch: EPOCH,
      targets: { studentId: created }, expectedRevisions: { student: 0 }, payload: { studentCode: '731927', displayName: 'P16x', aliases: ['ok'],
        openingBalance: { amount: 0, asOfDate: '2026-10-01', note: '' } } }));
    localStorage.clear();
    await checkAll('CreateStudent', createWrites, `students/${created}`, badLists);
    await replayBatch(sdk, dbFor(OP), createWrites);

    const editWrites = await captureBatch(async () => writer.commitCommand({ commandId: id(), kind: 'EditStudent', leaseEpoch: EPOCH,
      targets: { studentId: created }, expectedRevisions: { student: (await read(`students/${created}`)).revision },
      payload: { aliases: ['fine', 'also fine'] } }));
    localStorage.clear();
    await checkAll('EditStudent', editWrites, `students/${created}`, badLists);
    await replayBatch(sdk, dbFor(OP), editWrites);
    expect((await read(`students/${created}`)).aliases).toEqual(['fine', 'also fine']);

    // A command that does not edit aliases cannot change them either, valid or not.
    const rev = await revisions(created, today);
    const orderWrites = await captureBatch(async () => orders.createOrder({ commandId: id(), transactionId: id(), leaseEpoch: EPOCH,
      studentId: created, dayId: today, expectedStudentRevision: rev.student, expectedDayRevision: rev.day, mealKind: 'other',
      mealPrice: 80, paidAmount: 100, menuRevision: null, otherItemName: 'x', note: '' }));
    localStorage.clear();
    await checkAll('CreateOrder', orderWrites, `students/${created}`, [...badLists, { label: 'a different valid alias list', aliases: ['swapped'] }]);
    await replayBatch(sdk, dbFor(OP), orderWrites);
    expect((await read(`students/${created}`)).aliases).toEqual(['fine', 'also fine']);
  }, 180_000);

  describe('collections', () => {
    const resolve = async (template: string): Promise<string> => {
      const names: Record<string, string> = { ...ctx };
      if (template.includes('{command}')) names.command = (await adminList('commands'))[0]!;
      if (template.includes('{transaction}')) names.transaction = (await adminList('transactions'))[0]!;
      if (template.includes('{entry}')) names.entry = (await adminList('postCloseEntries'))[0]!;
      if (template.includes('{settlement}')) names.settlement = (await adminList(`days/${gap}/settlements`))[0]!;
      if (template.includes('{event}')) names.event = String(EPOCH);
      return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
        const value = names[name];
        if (!value) throw new Error(`P16b matrix: no value for {${name}} in ${template}`);
        return value;
      });
    };

    const seedCollectionState = async () => {
      await admin(async admin => {
        await setDoc(doc(admin, `operators/${OTHER.uid}`), { ...OTHER });
        await setDoc(doc(admin, `operators/${INACTIVE.uid}`), { ...INACTIVE });
        await setDoc(doc(admin, `accessEvents/${EPOCH}`), {
          kind: 'acquire', holderUid: OP.uid, previousHolderUid: null, actorUid: OP.uid, actorEmail: OP.email, at: Timestamp.now(),
        });
        await setDoc(doc(admin, 'daily_settlements/legacy'), { note: 'old collection, closed to everyone' });
        await setDoc(doc(admin, 'p16b-unnamed/doc'), { note: 'not named by any rule' });
      });
      await restoreBase();
    };

    const identities: Array<{ name: string; holderLike: boolean; approved: boolean; db: () => Firestore }> = [
      { name: 'unauthenticated', holderLike: false, approved: false, db: anonymousDb },
      { name: 'not on the allowlist', holderLike: false, approved: false, db: () => dbFor(STRANGER) },
      { name: 'inactive operator', holderLike: false, approved: false, db: () => dbFor(INACTIVE) },
      { name: 'approved, not the holder', holderLike: false, approved: true, db: () => dbFor(OTHER) },
      { name: 'lease holder', holderLike: true, approved: true, db: () => dbFor(OP) },
    ];
    const mayRead = (readers: Readers, who: { holderLike: boolean; approved: boolean }): boolean => {
      if (readers === 'holder') return who.holderLike;
      if (readers === 'approved') return who.approved;
      if (readers === 'self') return who.holderLike; // the sample document is the holder's own operators document
      return false;
    };

    const probe = async (entry: CollectionMatrixEntry) => {
      const docPath = await resolve(entry.doc);
      const listPath = await resolve(entry.listPath);
      const tally = { reads: 0, lists: 0, limitChecks: 0, bareWrites: 0 };
      await restoreBase();
      for (const who of identities) {
        const getAttempt = getDoc(doc(who.db(), docPath));
        if (mayRead(entry.readers, who)) await assertSucceeds(getAttempt); else await assertDenied(getAttempt, `${entry.match} get as ${who.name}`);
        tally.reads += 1;
        const listAttempt = getDocs(query(collection(who.db(), listPath), limit(5)));
        if (entry.listable && mayRead(entry.readers, who)) await assertSucceeds(listAttempt); else await assertDenied(listAttempt, `${entry.match} list as ${who.name}`);
        tally.lists += 1;
        if (entry.listable && mayRead(entry.readers, who)) {
          // P16c (R7): the identity that may list must still bring a limit of at most 500.
          await assertDenied(getDocs(collection(who.db(), listPath)), `${entry.match} list without a limit as ${who.name}`);
          await assertDenied(getDocs(query(collection(who.db(), listPath), limit(501))), `${entry.match} list with limit 501 as ${who.name}`);
          await assertSucceeds(getDocs(query(collection(who.db(), listPath), limit(500))));
          tally.limitChecks += 3;
        }
      }
      if (entry.readers === 'holder') {
        // The holder's own reads stop when the lease is not renewed.
        await setLease({ updatedAt: Timestamp.fromMillis(Date.now() - 10 * 60_000) });
        await assertDenied(getDoc(doc(dbFor(OP), docPath)), `${entry.match} get with an expired lease`);
        if (entry.listable) await assertDenied(getDocs(query(collection(dbFor(OP), listPath), limit(5))), `${entry.match} list with an expired lease`);
        tally.reads += 1;
        await restoreBase();
      }
      for (const bare of entry.bareWrites) {
        const before = await adminData(docPath);
        const holderDb = dbFor(OP);
        if (bare === 'update') await assertDenied(updateDoc(doc(holderDb, docPath), { updatedAt: serverTimestamp() }), `${entry.match} bare update`);
        else if (bare === 'delete') await assertDenied(deleteDoc(doc(holderDb, docPath)), `${entry.match} bare delete`);
        else {
          // A create needs a missing document: take the real one away, try to put the same content back, restore it.
          await admin(db => deleteDoc(doc(db, docPath)));
          try { await assertDenied(setDoc(doc(holderDb, docPath), before!), `${entry.match} bare create`); } finally {
            await admin(db => setDoc(doc(db, docPath), before!));
          }
        }
        expect(await adminData(docPath), `${entry.match} ${bare} changed the document`).toEqual(before);
        tally.bareWrites += 1;
      }
      collectionResults.set(entry.match, tally);
    };

    it('prepares one sample document per match', async () => { await seedCollectionState(); }, 60_000);
    for (const entry of COLLECTION_MATRIX) {
      it(`match ${entry.match}`, async () => { await probe(entry); }, 120_000);
    }
  });

  it('every kind and every collection ran, all ten mutation classes each, and nothing was skipped', async () => {
    expect([...results.keys()].sort()).toEqual([...ALL_COMMAND_KINDS].sort());
    for (const kind of ALL_COMMAND_KINDS) {
      const entry = KIND_MATRIX[kind]!;
      const result = results.get(kind)!;
      expect(result.step).toBe(entry.step);
      for (const mutationClass of MUTATIONS) {
        const count = result.attempts[mutationClass.id] ?? 0;
        if (entry.notApplicable[mutationClass.id]) expect(count, `${kind} ${mutationClass.id} is declared not applicable`).toBe(0);
        else expect(count, `${kind} ${mutationClass.id}`).toBeGreaterThan(0);
      }
    }
    expect([...collectionResults.keys()].sort()).toEqual(COLLECTION_MATRIX.map(entry => entry.match).sort());
    if (reportPath) {
      writeFileSync(reportPath, JSON.stringify({
        kinds: Object.fromEntries([...results.entries()]),
        collections: Object.fromEntries([...collectionResults.entries()]),
        maxTextCommandBytes: Object.fromEntries([...maxCommandBytes.entries()]),
        refusalsMentioningBudget: Object.fromEntries([...refusalsMentioningBudget.entries()]),
        totals: {
          kinds: results.size,
          refusedBatches: [...results.values()].reduce((sum, item) => sum + Object.values(item.attempts).reduce((a, b) => a + (b ?? 0), 0), 0),
        },
      }, null, 2));
    }
  });
});
