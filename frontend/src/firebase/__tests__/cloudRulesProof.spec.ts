import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import fixtureRules from './fixtures/cloudRulesProof.rules?raw';

declare const process: { env: Record<string, string | undefined> };

const projectId = 'demo-easyorder';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const requireEmulator = process.env.EASYORDER_REQUIRE_CLOUD_RULES_PROOF === 'true';

if (requireEmulator && !emulatorHost) {
  throw new Error('Cloud Rules proof gate requires FIRESTORE_EMULATOR_HOST; refusing to skip the suite.');
}

const describeWithEmulator = emulatorHost ? describe : describe.skip;
const dayId = '2026-10-14';
const studentId = 'stu-a';
const seedTime = new Date('2026-10-13T00:00:00.000Z');
const operatorA = { uid: 'uid-a', email: 'operator-a@example.test', displayName: 'Synthetic A', active: true };
const operatorB = { uid: 'uid-b', email: 'operator-b@example.test', displayName: 'Synthetic B', active: true };

type Data = Record<string, unknown>;
type SeedOptions = {
  holderUid?: string | null;
  epoch?: number;
  leaseExpired?: boolean;
  maintenance?: boolean;
  dayStatus?: 'open' | 'closed';
};
type SeedState = { head: Data; student: Data; day: Data; lease: Data };
type OrderDraft = {
  headBefore: Data;
  headAfter: Data;
  studentBefore: Data;
  studentAfter: Data;
  dayBefore: Data;
  dayAfter: Data;
  transaction: Data;
  command: Data;
};
type OrderOptions = {
  commandId?: string;
  kind?: 'CreateOrder' | 'CreatePayment';
  mealPrice?: number;
  paidAmount?: number;
  mealKind?: string | null;
  withCommand?: boolean;
  withHead?: boolean;
  withStudent?: boolean;
  withDay?: boolean;
  extraTransaction?: boolean;
  secondCommand?: boolean;
  leaseEpoch?: number;
  adjust?: (draft: OrderDraft) => void;
};

let env: RulesTestEnvironment;

function makeSeedState(options: SeedOptions = {}): SeedState {
  const head: Data = {
    schemaVersion: 1,
    datasetId: 'proof-dataset',
    seq: 0,
    lastCommandId: null,
    maintenance: options.maintenance ?? false,
    goLiveDate: '2026-10-13',
    updatedAt: seedTime,
  };
  const student: Data = {
    studentId,
    displayName: 'Synthetic Student',
    aliases: [],
    status: 'active',
    openingBalance: { amount: 0, asOfDate: '2026-10-13', note: '', createdAt: seedTime },
    currentBalance: 0,
    createdAt: seedTime,
    revision: 1,
    lastCommandId: 'seed-student',
    updatedAt: seedTime,
  };
  const day: Data = {
    status: options.dayStatus ?? 'open',
    revision: 1,
    menu: null,
    openingCash: 1000,
    openedBy: 'uid-a',
    openedAt: seedTime,
    totals: {
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: 'seed-day',
    updatedAt: seedTime,
  };
  const lease: Data = {
    holderUid: options.holderUid === undefined ? operatorA.uid : options.holderUid,
    epoch: options.epoch ?? 4,
    updatedAt: options.leaseExpired ? new Date(Date.now() - 10 * 60_000) : new Date(Date.now() - 1000),
  };
  return { head, student, day, lease };
}

async function seedBaseState(options: SeedOptions = {}): Promise<SeedState> {
  const state = makeSeedState(options);
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `operators/${operatorA.uid}`), operatorA),
      setDoc(doc(db, `operators/${operatorB.uid}`), operatorB),
      setDoc(doc(db, 'system/accessLease'), state.lease),
      setDoc(doc(db, 'system/dataHead'), state.head),
      setDoc(doc(db, `students/${studentId}`), state.student),
      setDoc(doc(db, `days/${dayId}`), state.day),
    ]);
  });
  return state;
}

async function seedExistingOrder(paidAmount: number): Promise<SeedState & { transaction: Data }> {
  const state = makeSeedState();
  const transaction: Data = {
    transactionId: 'tx-existing',
    studentId,
    businessDate: dayId,
    type: 'order',
    mealKind: 'bento',
    mealPrice: 100,
    paidAmount,
    status: 'active',
    revision: 1,
    createdAt: seedTime,
    createdSeq: 1,
    operatorUid: operatorA.uid,
    operatorEmail: operatorA.email,
    source: 'pc',
    lastCommandId: 'seed-order',
    updatedAt: seedTime,
  };
  const student: Data = {
    ...state.student,
    currentBalance: paidAmount - 100,
    revision: 2,
    lastCommandId: 'seed-order',
  };
  const previousTotals = state.day.totals as Data;
  const day: Data = {
    ...state.day,
    revision: 2,
    totals: {
      ...previousTotals,
      activeTransactionCount: 1,
      bentoCount: 1,
      mealTotal: 100,
      retainedReceipts: paidAmount,
    },
    lastCommandId: 'seed-order',
  };
  const head: Data = { ...state.head, seq: 1, lastCommandId: 'seed-order' };
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'system/dataHead'), head),
      setDoc(doc(db, `students/${studentId}`), student),
      setDoc(doc(db, `days/${dayId}`), day),
      setDoc(doc(db, 'transactions/tx-existing'), transaction),
      setDoc(doc(db, 'commands/seed-order'), { commandId: 'seed-order', kind: 'CreateOrder' }),
    ]);
  });
  return { ...state, head, student, day, transaction };
}

async function seedClosedDay(): Promise<SeedState & { settlement: Data }> {
  const state = makeSeedState();
  const day: Data = {
    ...state.day,
    status: 'closed',
    revision: 2,
    lastSettlementRevision: 1,
    lastCommandId: 'seed-close',
  };
  const head: Data = { ...state.head, seq: 1, lastCommandId: 'seed-close' };
  const settlement: Data = {
    dayId,
    revision: 1,
    status: 'closed',
    totals: day.totals,
    openingCash: 1000,
    expectedCash: 1000,
    countedCash: 1000,
    difference: 0,
    note: '',
    actorUid: operatorA.uid,
    actorEmail: operatorA.email,
    sourceSeq: 1,
    committedAt: seedTime,
    previousRevision: null,
    lastCommandId: 'seed-close',
  };
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'system/accessLease'), state.lease),
      setDoc(doc(db, 'system/dataHead'), head),
      setDoc(doc(db, `days/${dayId}`), day),
      setDoc(doc(db, `days/${dayId}/settlements/1`), settlement),
      setDoc(doc(db, `operators/${operatorA.uid}`), operatorA),
      setDoc(doc(db, `operators/${operatorB.uid}`), operatorB),
    ]);
  });
  return { ...state, head, day, settlement };
}

function operatorDb(
  uid = operatorA.uid,
  email = operatorA.email,
  claims: { email_verified?: boolean; signInProvider?: string } = {},
) {
  return env.authenticatedContext(uid, {
    email,
    email_verified: claims.email_verified ?? true,
    firebase: { sign_in_provider: claims.signInProvider ?? 'google.com' },
  }).firestore();
}

function orderDraft(state: SeedState, options: OrderOptions = {}): OrderDraft {
  const commandId = options.commandId ?? 'cmd-create-order-1';
  const kind = options.kind ?? 'CreateOrder';
  const mealPrice = options.mealPrice ?? (kind === 'CreatePayment' ? 0 : 100);
  const paidAmount = options.paidAmount ?? 90;
  const mealKind = options.mealKind === undefined ? (kind === 'CreatePayment' ? null : 'bento') : options.mealKind;
  const transactionId = 'tx-create-order-1';
  const previousTotals = state.day.totals as Data;
  const headBefore = state.head;
  const headAfter: Data = {
    ...headBefore,
    seq: Number(headBefore.seq) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const transaction: Data = {
    transactionId,
    studentId,
    businessDate: dayId,
    type: kind === 'CreateOrder' ? 'order' : 'payment',
    mealKind,
    mealPrice,
    paidAmount,
    status: 'active',
    revision: 1,
    createdAt: serverTimestamp(),
    createdSeq: Number(headBefore.seq) + 1,
    operatorUid: operatorA.uid,
    operatorEmail: operatorA.email,
    source: 'pc',
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const studentBefore = state.student;
  const studentAfter: Data = {
    ...studentBefore,
    currentBalance: Number(studentBefore.currentBalance) + paidAmount - mealPrice,
    revision: Number(studentBefore.revision) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const dayBefore = state.day;
  const dayAfter: Data = {
    ...dayBefore,
    revision: Number(dayBefore.revision) + 1,
    totals: {
      ...previousTotals,
      activeTransactionCount: Number(previousTotals.activeTransactionCount) + 1,
      bentoCount: Number(previousTotals.bentoCount) + (kind === 'CreateOrder' && mealKind === 'bento' ? 1 : 0),
      otherMealCount: Number(previousTotals.otherMealCount) + (kind === 'CreateOrder' && mealKind === 'other' ? 1 : 0),
      mealTotal: Number(previousTotals.mealTotal) + mealPrice,
      retainedReceipts: Number(previousTotals.retainedReceipts) + paidAmount,
    },
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const command: Data = {
    commandId,
    kind,
    seq: Number(headBefore.seq) + 1,
    leaseEpoch: options.leaseEpoch ?? 4,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: dayId,
    studentId,
    targets: { transactionId, studentId, dayId },
    before: { head: headBefore, transaction: null, student: studentBefore, day: dayBefore, previousSettlement: null },
    after: { head: headAfter, transaction, student: studentAfter, day: dayAfter, settlement: null },
    payload: { mealPrice, paidAmount, mealKind },
    inputFingerprint: 'synthetic-fingerprint-1',
  };
  const draft: OrderDraft = { headBefore, headAfter, studentBefore, studentAfter, dayBefore, dayAfter, transaction, command };
  options.adjust?.(draft);
  return draft;
}

function buildOrderBatch(db: ReturnType<typeof operatorDb>, state: SeedState, options: OrderOptions = {}) {
  const draft = orderDraft(state, options);
  const commandId = String(draft.command.commandId);
  const batch = writeBatch(db);
  if (options.withCommand !== false) batch.set(doc(db, `commands/${commandId}`), draft.command);
  if (options.withHead !== false) batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  batch.set(doc(db, 'transactions/tx-create-order-1'), draft.transaction);
  if (options.withStudent !== false) batch.update(doc(db, `students/${studentId}`), draft.studentAfter);
  if (options.withDay !== false) batch.update(doc(db, `days/${dayId}`), draft.dayAfter);
  if (options.extraTransaction) {
    batch.set(doc(db, 'transactions/tx-extra'), { ...draft.transaction, transactionId: 'tx-extra' });
  }
  if (options.secondCommand) {
    batch.set(doc(db, 'commands/cmd-second'), { ...draft.command, commandId: 'cmd-second', seq: Number(draft.command.seq) + 1 });
  }
  return { batch, draft, commandId };
}

function correctionDraft(state: SeedState & { transaction: Data }, commandId = 'cmd-correct-1'): OrderDraft {
  const beforeTotals = state.day.totals as Data;
  const txBefore = state.transaction;
  const txAfter: Data = {
    ...txBefore,
    mealPrice: 110,
    revision: Number(txBefore.revision) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const headAfter: Data = {
    ...state.head,
    seq: Number(state.head.seq) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const studentAfter: Data = {
    ...state.student,
    currentBalance: Number(state.student.currentBalance) - 10,
    revision: Number(state.student.revision) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const dayAfter: Data = {
    ...state.day,
    revision: Number(state.day.revision) + 1,
    totals: { ...beforeTotals, mealTotal: Number(beforeTotals.mealTotal) + 10 },
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const command: Data = {
    commandId,
    kind: 'CorrectTransaction',
    seq: Number(state.head.seq) + 1,
    leaseEpoch: 4,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: dayId,
    studentId,
    targets: { transactionId: 'tx-existing', studentId, dayId },
    before: { head: state.head, transaction: txBefore, student: state.student, day: state.day, previousSettlement: null },
    after: { head: headAfter, transaction: txAfter, student: studentAfter, day: dayAfter, settlement: null },
    payload: { mealPrice: 110, paidAmount: 90, reason: 'synthetic correction' },
    inputFingerprint: 'synthetic-correction-fingerprint',
  };
  return {
    headBefore: state.head,
    headAfter,
    studentBefore: state.student,
    studentAfter,
    dayBefore: state.day,
    dayAfter,
    transaction: txAfter,
    command,
  };
}

function buildCorrectionBatch(db: ReturnType<typeof operatorDb>, state: SeedState & { transaction: Data }, adjust?: (draft: OrderDraft) => void) {
  const draft = correctionDraft(state);
  adjust?.(draft);
  const batch = writeBatch(db);
  batch.set(doc(db, 'commands/cmd-correct-1'), draft.command);
  batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  batch.update(doc(db, 'transactions/tx-existing'), draft.transaction);
  batch.update(doc(db, `students/${studentId}`), draft.studentAfter);
  batch.update(doc(db, `days/${dayId}`), draft.dayAfter);
  return { batch, draft };
}

function cancellationDraft(state: SeedState & { transaction: Data }, commandId = 'cmd-void-1'): OrderDraft {
  const beforeTotals = state.day.totals as Data;
  const txBefore = state.transaction;
  const txAfter: Data = { ...txBefore, status: 'voided', revision: Number(txBefore.revision) + 1, lastCommandId: commandId, updatedAt: serverTimestamp() };
  const headAfter: Data = { ...state.head, seq: Number(state.head.seq) + 1, lastCommandId: commandId, updatedAt: serverTimestamp() };
  const studentAfter: Data = {
    ...state.student,
    currentBalance: Number(state.student.currentBalance) - Number(txBefore.paidAmount) + Number(txBefore.mealPrice),
    revision: Number(state.student.revision) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const dayAfter: Data = {
    ...state.day,
    revision: Number(state.day.revision) + 1,
    totals: {
      ...beforeTotals,
      activeTransactionCount: Number(beforeTotals.activeTransactionCount) - 1,
      bentoCount: Number(beforeTotals.bentoCount) - 1,
      mealTotal: Number(beforeTotals.mealTotal) - Number(txBefore.mealPrice),
      retainedReceipts: Number(beforeTotals.retainedReceipts) - Number(txBefore.paidAmount),
    },
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const command: Data = {
    commandId,
    kind: 'VoidTransaction',
    seq: Number(state.head.seq) + 1,
    leaseEpoch: 4,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: dayId,
    studentId,
    targets: { transactionId: 'tx-existing', studentId, dayId },
    before: { head: state.head, transaction: txBefore, student: state.student, day: state.day, previousSettlement: null },
    after: { head: headAfter, transaction: txAfter, student: studentAfter, day: dayAfter, settlement: null },
    payload: { reason: 'synthetic zero-paid cancellation' },
    inputFingerprint: 'synthetic-void-fingerprint',
  };
  return { headBefore: state.head, headAfter, studentBefore: state.student, studentAfter, dayBefore: state.day, dayAfter, transaction: txAfter, command };
}

function buildCancellationBatch(db: ReturnType<typeof operatorDb>, state: SeedState & { transaction: Data }) {
  const draft = cancellationDraft(state);
  const batch = writeBatch(db);
  batch.set(doc(db, 'commands/cmd-void-1'), draft.command);
  batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  batch.update(doc(db, 'transactions/tx-existing'), draft.transaction);
  batch.update(doc(db, `students/${studentId}`), draft.studentAfter);
  batch.update(doc(db, `days/${dayId}`), draft.dayAfter);
  return { batch, draft };
}

function dayCommandDraft(state: SeedState, kind: 'CloseDay' | 'ReopenDay'): { command: Data; headAfter: Data; dayAfter: Data; settlement: Data } {
  const commandId = kind === 'CloseDay' ? 'cmd-close-1' : 'cmd-reopen-2';
  const seq = Number(state.head.seq) + 1;
  const headAfter: Data = { ...state.head, seq, lastCommandId: commandId, updatedAt: serverTimestamp() };
  const dayAfter: Data = {
    ...state.day,
    status: kind === 'CloseDay' ? 'closed' : 'open',
    revision: Number(state.day.revision) + 1,
    lastSettlementRevision: kind === 'CloseDay' ? 1 : 2,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const expectedCash = Number(state.day.openingCash) + Number((state.day.totals as Data).retainedReceipts)
    + Number((state.day.totals as Data).cashierIncome) - Number((state.day.totals as Data).cashierExpense);
  const previousSettlement = kind === 'ReopenDay' ? (state as SeedState & { settlement: Data }).settlement : null;
  const settlement: Data = {
    dayId,
    revision: kind === 'CloseDay' ? 1 : 2,
    status: kind === 'CloseDay' ? 'closed' : 'reopened',
    totals: state.day.totals,
    openingCash: state.day.openingCash,
    expectedCash: previousSettlement ? previousSettlement.expectedCash : expectedCash,
    countedCash: previousSettlement ? previousSettlement.countedCash : expectedCash,
    difference: 0,
    note: kind === 'CloseDay' ? '' : 'synthetic reopen reason',
    actorUid: operatorA.uid,
    actorEmail: operatorA.email,
    sourceSeq: seq,
    committedAt: serverTimestamp(),
    previousRevision: kind === 'CloseDay' ? null : 1,
    lastCommandId: commandId,
  };
  const command: Data = {
    commandId,
    kind,
    seq,
    leaseEpoch: 4,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: dayId,
    studentId: null,
    targets: { dayId, settlementRevision: kind === 'CloseDay' ? 1 : 2 },
    before: {
      head: state.head,
      transaction: null,
      student: null,
      day: state.day,
      previousSettlement,
    },
    after: { head: headAfter, transaction: null, student: null, day: dayAfter, settlement },
    payload: kind === 'CloseDay'
      ? { countedCash: expectedCash, note: '' }
      : { reason: 'synthetic reopen reason' },
    inputFingerprint: `synthetic-${kind.toLowerCase()}-fingerprint`,
  };
  return { command, headAfter, dayAfter, settlement };
}

function buildDayCommandBatch(db: ReturnType<typeof operatorDb>, state: SeedState, kind: 'CloseDay' | 'ReopenDay') {
  const draft = dayCommandDraft(state, kind);
  const batch = writeBatch(db);
  batch.set(doc(db, `commands/${String(draft.command.commandId)}`), draft.command);
  batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  batch.update(doc(db, `days/${dayId}`), draft.dayAfter);
  batch.set(doc(db, `days/${dayId}/settlements/${String(draft.settlement.revision)}`), draft.settlement);
  return { batch, draft };
}

async function expectCreateOrderFailureIsAtomic(
  db: ReturnType<typeof operatorDb>,
  state: SeedState,
  options: OrderOptions = {},
) {
  const { batch, commandId } = buildOrderBatch(db, state, options);
  await assertFails(batch.commit());
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    const [head, student, day, transaction, command, extra, second] = await Promise.all([
      getDoc(doc(adminDb, 'system/dataHead')),
      getDoc(doc(adminDb, `students/${studentId}`)),
      getDoc(doc(adminDb, `days/${dayId}`)),
      getDoc(doc(adminDb, 'transactions/tx-create-order-1')),
      getDoc(doc(adminDb, `commands/${commandId}`)),
      getDoc(doc(adminDb, 'transactions/tx-extra')),
      getDoc(doc(adminDb, 'commands/cmd-second')),
    ]);
    expect(head.data()?.seq).toBe(state.head.seq);
    expect(student.data()?.currentBalance).toBe(state.student.currentBalance);
    expect(day.data()?.revision).toBe(state.day.revision);
    expect(transaction.exists()).toBe(false);
    expect(command.exists()).toBe(false);
    expect(extra.exists()).toBe(false);
    expect(second.exists()).toBe(false);
  });
}

describeWithEmulator('P01 temporary cloud Rules proof', () => {
  beforeAll(async () => {
    if (!emulatorHost) throw new Error('Expected a Firestore Emulator host for this suite.');
    const [host, portText] = emulatorHost.split(':');
    env = await initializeTestEnvironment({
      projectId,
      firestore: { rules: fixtureRules, host, port: Number(portText || '8080') },
    });
  });

  beforeEach(async () => env.clearFirestore());
  afterAll(async () => env?.cleanup());

  it('allows a valid five-document CreateOrder with exact command, sequence, actor, time and projection snapshots', async () => {
    const state = await seedBaseState();
    const { batch } = buildOrderBatch(operatorDb(), state);
    await assertSucceeds(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      const [head, student, day, transaction, command] = await Promise.all([
        getDoc(doc(adminDb, 'system/dataHead')),
        getDoc(doc(adminDb, `students/${studentId}`)),
        getDoc(doc(adminDb, `days/${dayId}`)),
        getDoc(doc(adminDb, 'transactions/tx-create-order-1')),
        getDoc(doc(adminDb, 'commands/cmd-create-order-1')),
      ]);
      expect(head.data()?.seq).toBe(1);
      expect(head.data()?.lastCommandId).toBe('cmd-create-order-1');
      expect(student.data()?.currentBalance).toBe(-10);
      expect(student.data()?.revision).toBe(2);
      expect((day.data()?.totals as Data).mealTotal).toBe(100);
      expect((day.data()?.totals as Data).retainedReceipts).toBe(90);
      expect(transaction.data()?.createdSeq).toBe(1);
      expect(command.data()?.seq).toBe(1);
    });
  });

  it('allows a zero-paid order while preserving its unpaid balance and meal contribution', async () => {
    const state = await seedBaseState();
    const { batch } = buildOrderBatch(operatorDb(), state, { paidAmount: 0 });
    await assertSucceeds(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-100);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ activeTransactionCount: 1, bentoCount: 1, mealTotal: 100, retainedReceipts: 0 });
    });
  });

  it('allows positive CreatePayment and applies only its payment balance and receipt contribution', async () => {
    const state = await seedBaseState();
    const { batch } = buildOrderBatch(operatorDb(), state, { kind: 'CreatePayment', paidAmount: 25 });
    await assertSucceeds(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(25);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ activeTransactionCount: 1, bentoCount: 0, mealTotal: 0, retainedReceipts: 25 });
    });
  });

  it('rejects an uncommanded extra transaction atomically', async () => {
    const state = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, { extraTransaction: true });
  });

  it('rejects missing command, student or day counterparts atomically', async () => {
    for (const omission of ['command', 'student', 'day'] as const) {
      const state = await seedBaseState();
      const options: OrderOptions = omission === 'command'
        ? { withCommand: false }
        : omission === 'student'
          ? { withStudent: false }
          : { withDay: false };
      await expectCreateOrderFailureIsAtomic(operatorDb(), state, options);
    }
  });

  it('rejects two commands attempting to claim one sequence atomically', async () => {
    const state = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, { secondCommand: true });
  });

  it('rejects replay of a historical command without changing the original receipt or projections', async () => {
    const state = await seedBaseState();
    const first = buildOrderBatch(operatorDb(), state);
    await assertSucceeds(first.batch.commit());
    const replay = buildOrderBatch(operatorDb(), state);
    await assertFails(replay.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(1);
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-10);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.revision).toBe(2);
      expect((await getDoc(doc(db, 'transactions/tx-create-order-1'))).data()?.revision).toBe(1);
    });
  });

  it('rejects a skipped or forged global sequence atomically', async () => {
    const state = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, {
      adjust: ({ command }) => { command.seq = 7; },
    });
  });

  it('rejects spoofed actor, client timestamp and stale lease epoch atomically', async () => {
    for (const adjust of [
      ({ command }: OrderDraft) => { command.actor = { uid: operatorB.uid, email: operatorB.email }; },
      ({ command, transaction, studentAfter, dayAfter, headAfter }: OrderDraft) => {
        const fake = new Date('2020-01-01T00:00:00.000Z');
        command.committedAt = fake;
        transaction.createdAt = fake;
        transaction.updatedAt = fake;
        studentAfter.updatedAt = fake;
        dayAfter.updatedAt = fake;
        headAfter.updatedAt = fake;
      },
    ]) {
      const state = await seedBaseState();
      await expectCreateOrderFailureIsAtomic(operatorDb(), state, { adjust });
    }
    const state = await seedBaseState({ epoch: 5 });
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, { leaseEpoch: 4 });
  });

  it.each([
    ['negative meal price', { mealPrice: -1 }],
    ['fractional meal price', { mealPrice: 10.5 }],
    ['meal price over one million', { mealPrice: 1000001 }],
    ['negative paid amount', { paidAmount: -1 }],
    ['fractional paid amount', { paidAmount: 1.5 }],
    ['paid amount over one million', { paidAmount: 1000001 }],
  ])('rejects %s atomically', async (_label, amounts) => {
    const state = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, amounts);
  });

  it('rejects zero CreatePayment, extra schema fields and a transaction date outside its typed target', async () => {
    const zeroPaymentState = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), zeroPaymentState, { kind: 'CreatePayment', paidAmount: 0 });
    const extraFieldState = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), extraFieldState, {
      adjust: ({ transaction }) => { transaction.unreviewedField = 'not in schema'; },
    });
    const dateState = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), dateState, {
      adjust: ({ transaction }) => { transaction.businessDate = '2026-10-15'; },
    });
  });

  it('requires the exact active verified Google allowlist identity and current lease holder', async () => {
    for (const db of [
      operatorDb('uid-a', 'operator-a@example.test', { email_verified: false }),
      operatorDb('uid-a', 'operator-a@example.test', { signInProvider: 'password' }),
      operatorDb('uid-a', 'mismatched@example.test'),
      operatorDb('uid-unlisted', 'unlisted@example.test'),
      operatorDb(operatorB.uid, operatorB.email),
    ]) {
      const state = await seedBaseState();
      await expectCreateOrderFailureIsAtomic(db, state);
    }
  });

  it('rejects expired lease, closed business day, maintenance mode and direct uncommanded writes atomically', async () => {
    const expired = await seedBaseState({ leaseExpired: true });
    await expectCreateOrderFailureIsAtomic(operatorDb(), expired);
    const closed = await seedBaseState({ dayStatus: 'closed' });
    await expectCreateOrderFailureIsAtomic(operatorDb(), closed);
    const maintenance = await seedBaseState({ maintenance: true });
    await expectCreateOrderFailureIsAtomic(operatorDb(), maintenance);

    const direct = await seedBaseState();
    const db = operatorDb();
    await assertFails(updateDoc(doc(db, `students/${studentId}`), { currentBalance: 500 }));
    await assertFails(setDoc(doc(db, 'transactions/direct'), { transactionId: 'direct', studentId, businessDate: dayId }));
    await assertFails(setDoc(doc(db, 'system/dataHead'), { ...direct.head, seq: 1 }));
    await env.withSecurityRulesDisabled(async context => {
      expect((await getDoc(doc(context.firestore(), `students/${studentId}`))).data()?.currentBalance).toBe(0);
      expect((await getDoc(doc(context.firestore(), 'transactions/direct'))).exists()).toBe(false);
    });
  });

  it('allows CorrectTransaction with immutable account/date/creation identity and exact revision plus one', async () => {
    const state = await seedExistingOrder(90);
    const { batch } = buildCorrectionBatch(operatorDb(), state);
    await assertSucceeds(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ mealPrice: 110, paidAmount: 90, revision: 2, createdSeq: 1 });
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-20);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ mealTotal: 110, retainedReceipts: 90 });
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(2);
    });
  });

  it('rejects changing an existing transaction account, business date or revision atomically', async () => {
    for (const mutate of [
      (draft: OrderDraft) => { draft.transaction.studentId = 'stu-b'; },
      (draft: OrderDraft) => { draft.transaction.businessDate = '2026-10-15'; },
      (draft: OrderDraft) => { draft.transaction.revision = 9; },
    ]) {
      const state = await seedExistingOrder(90);
      const { batch } = buildCorrectionBatch(operatorDb(), state, mutate);
      await assertFails(batch.commit());
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(1);
        expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ studentId, businessDate: dayId, mealPrice: 100, revision: 1 });
        expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-10);
        expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ mealTotal: 100, retainedReceipts: 90 });
      });
    }
  });

  it('allows zero-paid cancellation as a void with zero remaining business contribution', async () => {
    const state = await seedExistingOrder(0);
    const { batch } = buildCancellationBatch(operatorDb(), state);
    await assertSucceeds(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ status: 'voided', paidAmount: 0, mealPrice: 100, revision: 2 });
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(0);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ activeTransactionCount: 0, bentoCount: 0, mealTotal: 0, retainedReceipts: 0 });
    });
  });

  it('allows CloseDay and then ReopenDay as immutable settlement revisions', async () => {
    const open = await seedBaseState();
    const close = buildDayCommandBatch(operatorDb(), open, 'CloseDay');
    await assertSucceeds(close.batch.commit());
    const closedState = await seedClosedDay();
    const reopen = buildDayCommandBatch(operatorDb(), closedState, 'ReopenDay');
    await assertSucceeds(reopen.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, `days/${dayId}`))).data()).toMatchObject({ status: 'open', revision: 3, lastSettlementRevision: 2 });
      expect((await getDoc(doc(db, `days/${dayId}/settlements/1`))).data()).toMatchObject({ status: 'closed', revision: 1 });
      expect((await getDoc(doc(db, `days/${dayId}/settlements/2`))).data()).toMatchObject({ status: 'reopened', revision: 2, previousRevision: 1 });
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(2);
    });
  });

  it('denies updates and deletes of historical immutable command and settlement documents', async () => {
    const orderState = await seedBaseState();
    const order = buildOrderBatch(operatorDb(), orderState);
    await assertSucceeds(order.batch.commit());
    const db = operatorDb();
    await assertFails(updateDoc(doc(db, 'commands/cmd-create-order-1'), { seq: 99 }));
    await assertFails(deleteDoc(doc(db, 'commands/cmd-create-order-1')));

    const closed = await seedClosedDay();
    await assertFails(updateDoc(doc(db, `days/${dayId}/settlements/1`), { expectedCash: 1 }));
    await assertFails(deleteDoc(doc(db, `days/${dayId}/settlements/1`)));
    await env.withSecurityRulesDisabled(async context => {
      expect((await getDoc(doc(context.firestore(), `days/${dayId}/settlements/1`))).data()?.expectedCash).toBe(closed.settlement.expectedCash);
    });
  });

  it('allows lease acquire, live-holder renew and release only with server timestamp and legal epoch transitions', async () => {
    const acquireState = await seedBaseState({ holderUid: null, epoch: 0 });
    await assertSucceeds(updateDoc(doc(operatorDb(), 'system/accessLease'), {
      holderUid: operatorA.uid,
      epoch: 1,
      updatedAt: serverTimestamp(),
    }));
    await env.withSecurityRulesDisabled(async context => {
      expect((await getDoc(doc(context.firestore(), 'system/accessLease'))).data()?.epoch).toBe(1);
    });

    await seedBaseState();
    await assertSucceeds(updateDoc(doc(operatorDb(), 'system/accessLease'), {
      holderUid: operatorA.uid,
      epoch: 4,
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(operatorDb(), 'system/accessLease'), {
      holderUid: null,
      epoch: 5,
      updatedAt: serverTimestamp(),
    }));
    expect(acquireState.lease.epoch).toBe(0);
  });

  it('rejects client lease time, expired renew, non-holder release, create and delete', async () => {
    await seedBaseState();
    const db = operatorDb();
    await assertFails(updateDoc(doc(db, 'system/accessLease'), {
      holderUid: operatorA.uid,
      epoch: 4,
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    }));
    await seedBaseState({ leaseExpired: true });
    await assertFails(updateDoc(doc(db, 'system/accessLease'), {
      holderUid: operatorA.uid,
      epoch: 4,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(operatorDb(operatorB.uid, operatorB.email), 'system/accessLease'), {
      holderUid: null,
      epoch: 5,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, 'system/accessLease'), { holderUid: null, epoch: 0, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'system/accessLease')));
  });

  it('denies business reads to an authenticated allowlist operator without the current lease', async () => {
    await seedBaseState();
    await assertFails(getDoc(doc(operatorDb(operatorB.uid, operatorB.email), `students/${studentId}`)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `days/${dayId}`)));
  });
});
