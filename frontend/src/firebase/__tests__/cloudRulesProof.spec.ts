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
const taipeiDateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const taipeiToday = Object.fromEntries(taipeiDateParts.map(part => [part.type, part.value]));
const dayId = `${taipeiToday.year}-${taipeiToday.month}-${taipeiToday.day}`;
function shiftDate(date: string, delta: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + delta);
  return value.toISOString().slice(0, 10);
}
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
  dayStatus?: 'open' | 'closed' | 'reopened';
  businessDate?: string;
  goLiveDate?: string;
  openingBalanceAsOfDate?: string;
};
type SeedState = { dayId: string; head: Data; student: Data; day: Data; lease: Data; settlement?: Data };
type OrderDraft = {
  dayId: string;
  headBefore: Data;
  headAfter: Data;
  studentBefore: Data;
  studentAfter: Data;
  dayBefore: Data;
  dayAfter: Data;
  transaction: Data;
  command: Data;
};
type DayCommandDraft = { dayId: string; command: Data; headAfter: Data; dayAfter: Data; settlement: Data };
type OrderOptions = {
  commandId?: string;
  transactionId?: string;
  actorUid?: string;
  actorEmail?: string;
  kind?: 'CreateOrder' | 'CreatePayment';
  mealPrice?: number;
  paidAmount?: number;
  mealKind?: string | null;
  withCommand?: boolean;
  withHead?: boolean;
  withStudent?: boolean;
  withDay?: boolean;
  withTransaction?: boolean;
  extraTransaction?: boolean;
  secondCommand?: boolean;
  leaseEpoch?: number;
  adjust?: (draft: OrderDraft) => void;
};

let env: RulesTestEnvironment;

function makeSeedState(options: SeedOptions = {}): SeedState {
  const businessDate = options.businessDate ?? dayId;
  const head: Data = {
    schemaVersion: 1,
    datasetId: 'proof-dataset',
    seq: 0,
    lastCommandId: null,
    maintenance: options.maintenance ?? false,
    goLiveDate: options.goLiveDate ?? dayId,
    updatedAt: seedTime,
  };
  const student: Data = {
    studentId,
    displayName: 'Synthetic Student',
    aliases: [],
    status: 'active',
    openingBalance: { amount: 0, asOfDate: options.openingBalanceAsOfDate ?? dayId, note: '', createdAt: seedTime },
    currentBalance: 0,
    createdAt: seedTime,
    revision: 1,
    lastCommandId: 'seed-student',
    updatedAt: seedTime,
  };
  const day: Data = {
    status: options.dayStatus ?? 'open',
    revision: 1,
    menu: {
      businessDate,
      itemName: 'Synthetic Bento',
      price: 100,
      vendorId: 'vendor-synth',
      vendorNameSnapshot: 'Synthetic Vendor',
      updatedAt: seedTime,
      revision: 1,
      inheritedFromDate: null,
    },
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
  return { dayId: businessDate, head, student, day, lease };
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
      setDoc(doc(db, `days/${state.dayId}`), state.day),
    ]);
  });
  return state;
}

async function seedExistingOrder(paidAmount: number): Promise<SeedState & { transaction: Data }> {
  const state = makeSeedState();
  const transaction: Data = {
    transactionId: 'tx-existing',
    studentId,
    businessDate: state.dayId,
    type: 'order',
    mealKind: 'bento',
    mealPrice: 100,
    paidAmount,
    amount: paidAmount - 100,
    studentNameSnapshot: 'Synthetic Student',
    menuNameSnapshot: 'Synthetic Bento',
    menuPriceSnapshot: 100,
    vendorIdSnapshot: 'vendor-synth',
    vendorNameSnapshot: 'Synthetic Vendor',
    status: 'active',
    revision: 1,
    createdAt: seedTime,
    createdSeq: 1,
    operatorUid: operatorA.uid,
    operatorEmail: operatorA.email,
    sourceDevice: 'pc',
    note: '',
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
      setDoc(doc(db, `operators/${operatorA.uid}`), operatorA),
      setDoc(doc(db, `operators/${operatorB.uid}`), operatorB),
      setDoc(doc(db, 'system/accessLease'), state.lease),
      setDoc(doc(db, 'system/dataHead'), head),
      setDoc(doc(db, `students/${studentId}`), student),
      setDoc(doc(db, `days/${state.dayId}`), day),
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
      setDoc(doc(db, `days/${state.dayId}`), day),
      setDoc(doc(db, `days/${state.dayId}/settlements/1`), settlement),
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
  const actorUid = options.actorUid ?? operatorA.uid;
  const actorEmail = options.actorEmail ?? operatorA.email;
  const mealPrice = options.mealPrice ?? (kind === 'CreatePayment' ? 0 : 100);
  const paidAmount = options.paidAmount ?? 90;
  const mealKind = options.mealKind === undefined ? (kind === 'CreatePayment' ? null : 'bento') : options.mealKind;
  const menu = state.day.menu as Data;
  const transactionId = options.transactionId ?? 'tx-create-order-1';
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
    businessDate: state.dayId,
    type: kind === 'CreateOrder' ? 'order' : 'payment',
    mealKind,
    mealPrice,
    paidAmount,
    amount: paidAmount - mealPrice,
    studentNameSnapshot: state.student.displayName,
    menuNameSnapshot: kind === 'CreateOrder' && mealKind === 'bento' ? menu.itemName : '',
    menuPriceSnapshot: kind === 'CreateOrder' && mealKind === 'bento' ? menu.price : 0,
    vendorIdSnapshot: kind === 'CreateOrder' && mealKind === 'bento' ? menu.vendorId : '',
    vendorNameSnapshot: kind === 'CreateOrder' && mealKind === 'bento' ? menu.vendorNameSnapshot : '',
    status: 'active',
    revision: 1,
    createdAt: serverTimestamp(),
    createdSeq: Number(headBefore.seq) + 1,
    operatorUid: actorUid,
    operatorEmail: actorEmail,
    sourceDevice: 'pc',
    note: '',
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
    actor: { uid: actorUid, email: actorEmail },
    committedAt: serverTimestamp(),
    businessDate: state.dayId,
    studentId,
    targets: { transactionId, studentId, dayId: state.dayId },
    before: { head: headBefore, transaction: null, student: studentBefore, day: dayBefore, previousSettlement: null },
    after: { head: headAfter, transaction, student: studentAfter, day: dayAfter, settlement: null },
    reason: null,
    cashEffect: {
      before: 0,
      after: paidAmount,
      delta: paidAmount,
      reasonKind: paidAmount > 0 ? 'collection' : 'none',
      refundAmount: 0,
    },
    payload: kind === 'CreateOrder' && mealKind === 'bento'
      ? { mealPrice, paidAmount, mealKind, menuRevision: menu.revision }
      : { mealPrice, paidAmount, mealKind },
    inputFingerprint: 'synthetic-fingerprint-1',
  };
  const draft: OrderDraft = { dayId: state.dayId, headBefore, headAfter, studentBefore, studentAfter, dayBefore, dayAfter, transaction, command };
  options.adjust?.(draft);
  return draft;
}

function buildOrderBatch(db: ReturnType<typeof operatorDb>, state: SeedState, options: OrderOptions = {}) {
  const draft = orderDraft(state, options);
  const commandId = String(draft.command.commandId);
  const batch = writeBatch(db);
  if (options.withCommand !== false) batch.set(doc(db, `commands/${commandId}`), draft.command);
  if (options.withHead !== false) batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  if (options.withTransaction !== false) batch.set(doc(db, `transactions/${String(draft.transaction.transactionId)}`), draft.transaction);
  if (options.withStudent !== false) batch.update(doc(db, `students/${studentId}`), draft.studentAfter);
  if (options.withDay !== false) batch.update(doc(db, `days/${draft.dayId}`), draft.dayAfter);
  if (options.extraTransaction) {
    batch.set(doc(db, 'transactions/tx-extra'), { ...draft.transaction, transactionId: 'tx-extra' });
  }
  if (options.secondCommand) {
    batch.set(doc(db, 'commands/cmd-second'), { ...draft.command, commandId: 'cmd-second' });
  }
  return { batch, draft, commandId };
}

function correctionDraft(state: SeedState & { transaction: Data }, commandId = 'cmd-correct-1'): OrderDraft {
  const beforeTotals = state.day.totals as Data;
  const txBefore = state.transaction;
  const txAfter: Data = {
    ...txBefore,
    mealPrice: 110,
    paidAmount: 70,
    amount: -40,
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
    currentBalance: Number(state.student.currentBalance) - 30,
    revision: Number(state.student.revision) + 1,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const dayAfter: Data = {
    ...state.day,
    revision: Number(state.day.revision) + 1,
    totals: {
      ...beforeTotals,
      mealTotal: Number(beforeTotals.mealTotal) + 10,
      retainedReceipts: Number(beforeTotals.retainedReceipts) - 20,
    },
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
    businessDate: state.dayId,
    studentId,
    targets: { transactionId: 'tx-existing', studentId, dayId: state.dayId },
    before: { head: state.head, transaction: txBefore, student: state.student, day: state.day, previousSettlement: null },
    after: { head: headAfter, transaction: txAfter, student: studentAfter, day: dayAfter, settlement: null },
    reason: 'synthetic correction',
    cashEffect: { before: 90, after: 70, delta: -20, reasonKind: 'correction', refundAmount: 0 },
    payload: { mealPrice: 110, paidAmount: 70 },
    inputFingerprint: 'synthetic-correction-fingerprint',
  };
  return {
    dayId: state.dayId,
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

function buildCorrectionBatch(
  db: ReturnType<typeof operatorDb>,
  state: SeedState & { transaction: Data },
  adjust?: (draft: OrderDraft) => void,
  options: { withTransaction?: boolean; withHead?: boolean; withStudent?: boolean; withDay?: boolean } = {},
) {
  const draft = correctionDraft(state);
  adjust?.(draft);
  const batch = writeBatch(db);
  batch.set(doc(db, 'commands/cmd-correct-1'), draft.command);
  if (options.withHead !== false) batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  if (options.withTransaction !== false) batch.update(doc(db, 'transactions/tx-existing'), draft.transaction);
  if (options.withStudent !== false) batch.update(doc(db, `students/${studentId}`), draft.studentAfter);
  if (options.withDay !== false) batch.update(doc(db, `days/${draft.dayId}`), draft.dayAfter);
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
    businessDate: state.dayId,
    studentId,
    targets: { transactionId: 'tx-existing', studentId, dayId: state.dayId },
    before: { head: state.head, transaction: txBefore, student: state.student, day: state.day, previousSettlement: null },
    after: { head: headAfter, transaction: txAfter, student: studentAfter, day: dayAfter, settlement: null },
    reason: 'synthetic zero-paid cancellation',
    cashEffect: {
      before: Number(txBefore.paidAmount),
      after: 0,
      delta: 0 - Number(txBefore.paidAmount),
      reasonKind: Number(txBefore.paidAmount) > 0 ? 'refund' : 'none',
      refundAmount: Number(txBefore.paidAmount),
    },
    payload: {},
    inputFingerprint: 'synthetic-void-fingerprint',
  };
  return { dayId: state.dayId, headBefore: state.head, headAfter, studentBefore: state.student, studentAfter, dayBefore: state.day, dayAfter, transaction: txAfter, command };
}

function buildCancellationBatch(
  db: ReturnType<typeof operatorDb>,
  state: SeedState & { transaction: Data },
  adjust?: (draft: OrderDraft) => void,
  options: { withTransaction?: boolean; withHead?: boolean; withStudent?: boolean; withDay?: boolean } = {},
) {
  const draft = cancellationDraft(state);
  adjust?.(draft);
  const batch = writeBatch(db);
  batch.set(doc(db, 'commands/cmd-void-1'), draft.command);
  if (options.withHead !== false) batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  if (options.withTransaction !== false) batch.update(doc(db, 'transactions/tx-existing'), draft.transaction);
  if (options.withStudent !== false) batch.update(doc(db, `students/${studentId}`), draft.studentAfter);
  if (options.withDay !== false) batch.update(doc(db, `days/${draft.dayId}`), draft.dayAfter);
  return { batch, draft };
}

function dayCommandDraft(state: SeedState, kind: 'CloseDay' | 'ReopenDay'): DayCommandDraft {
  const revision = Number(state.day.lastSettlementRevision) + 1;
  const commandId = `cmd-${kind.toLowerCase()}-${revision}`;
  const seq = Number(state.head.seq) + 1;
  const headAfter: Data = { ...state.head, seq, lastCommandId: commandId, updatedAt: serverTimestamp() };
  const dayAfter: Data = {
    ...state.day,
    status: kind === 'CloseDay' ? 'closed' : 'reopened',
    revision: Number(state.day.revision) + 1,
    lastSettlementRevision: revision,
    lastCommandId: commandId,
    updatedAt: serverTimestamp(),
  };
  const expectedCash = Number(state.day.openingCash) + Number((state.day.totals as Data).retainedReceipts)
    + Number((state.day.totals as Data).cashierIncome) - Number((state.day.totals as Data).cashierExpense);
  const previousSettlement = revision > 0 && Number(state.day.lastSettlementRevision) > 0 ? state.settlement ?? null : null;
  const countedCash = kind === 'CloseDay' ? expectedCash + 1 : expectedCash;
  const closeReason = kind === 'CloseDay' ? 'synthetic count variance' : null;
  const reopenReason = 'synthetic reopen reason';
  const reason = kind === 'CloseDay' ? closeReason : reopenReason;
  const settlement: Data = {
    dayId: state.dayId,
    revision,
    status: kind === 'CloseDay' ? 'closed' : 'reopened',
    totals: state.day.totals,
    openingCash: state.day.openingCash,
    expectedCash: kind === 'ReopenDay' ? previousSettlement?.expectedCash : expectedCash,
    countedCash: kind === 'ReopenDay' ? previousSettlement?.countedCash : countedCash,
    difference: kind === 'ReopenDay' ? previousSettlement?.difference : countedCash - expectedCash,
    note: kind === 'CloseDay' ? closeReason ?? '' : reopenReason,
    actorUid: operatorA.uid,
    actorEmail: operatorA.email,
    sourceSeq: seq,
    committedAt: serverTimestamp(),
    previousRevision: previousSettlement ? previousSettlement.revision : null,
    lastCommandId: commandId,
  };
  const command: Data = {
    commandId,
    kind,
    seq,
    leaseEpoch: 4,
    actor: { uid: operatorA.uid, email: operatorA.email },
    committedAt: serverTimestamp(),
    businessDate: state.dayId,
    studentId: null,
    targets: { dayId: state.dayId, settlementRevision: revision },
    before: {
      head: state.head,
      transaction: null,
      student: null,
      day: state.day,
      previousSettlement,
    },
    after: { head: headAfter, transaction: null, student: null, day: dayAfter, settlement },
    reason,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: kind === 'CloseDay'
      ? { countedCash }
      : {},
    inputFingerprint: `synthetic-${kind.toLowerCase()}-fingerprint`,
  };
  return { dayId: state.dayId, command, headAfter, dayAfter, settlement };
}

function buildDayCommandBatch(
  db: ReturnType<typeof operatorDb>,
  state: SeedState,
  kind: 'CloseDay' | 'ReopenDay',
  adjust?: (draft: DayCommandDraft) => void,
  settlementPathRevision?: number,
) {
  const draft = dayCommandDraft(state, kind);
  adjust?.(draft);
  const batch = writeBatch(db);
  batch.set(doc(db, `commands/${String(draft.command.commandId)}`), draft.command);
  batch.update(doc(db, 'system/dataHead'), draft.headAfter);
  batch.update(doc(db, `days/${draft.dayId}`), draft.dayAfter);
  batch.set(doc(db, `days/${draft.dayId}/settlements/${settlementPathRevision ?? String(draft.settlement.revision)}`), draft.settlement);
  return { batch, draft };
}

async function expectDayCommandFailureIsAtomic(
  state: SeedState,
  kind: 'CloseDay' | 'ReopenDay',
  adjust?: (draft: DayCommandDraft) => void,
  settlementPathRevision?: number,
) {
  const { batch, draft } = buildDayCommandBatch(operatorDb(), state, kind, adjust, settlementPathRevision);
  await assertFails(batch.commit());
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const [head, day, command, targetSettlement, alternateSettlement] = await Promise.all([
      getDoc(doc(db, 'system/dataHead')),
      getDoc(doc(db, `days/${state.dayId}`)),
      getDoc(doc(db, `commands/${String(draft.command.commandId)}`)),
      getDoc(doc(db, `days/${state.dayId}/settlements/${Number(state.day.lastSettlementRevision) + 1}`)),
      getDoc(doc(db, `days/${state.dayId}/settlements/${Number(state.day.lastSettlementRevision) + 2}`)),
    ]);
    expect(head.data()?.seq).toBe(state.head.seq);
    expect(day.data()?.revision).toBe(state.day.revision);
    expect(day.data()?.lastSettlementRevision).toBe(state.day.lastSettlementRevision);
    expect(command.exists()).toBe(false);
    expect(targetSettlement.exists()).toBe(false);
    expect(alternateSettlement.exists()).toBe(false);
  });
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
      getDoc(doc(adminDb, `days/${state.dayId}`)),
      getDoc(doc(adminDb, `transactions/${options.transactionId ?? 'tx-create-order-1'}`)),
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
      expect(transaction.data()).toMatchObject({
        businessDate: dayId,
        mealPrice: 100,
        menuNameSnapshot: 'Synthetic Bento',
        menuPriceSnapshot: 100,
        vendorIdSnapshot: 'vendor-synth',
        vendorNameSnapshot: 'Synthetic Vendor',
      });
      expect(transaction.data()?.createdSeq).toBe(1);
      expect(command.data()?.seq).toBe(1);
      expect(command.data()?.reason).toBeNull();
      expect(command.data()?.cashEffect).toMatchObject({ before: 0, after: 90, delta: 90, reasonKind: 'collection', refundAmount: 0 });
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

  it('requires head, student, day and transaction writes even when the command snapshot is forged unchanged', async () => {
    const missingProjectionCases: OrderOptions[] = [
      {
        withHead: false,
        adjust: draft => { draft.command.after.head = draft.headBefore; },
      },
      {
        withStudent: false,
        adjust: draft => { draft.command.after.student = draft.studentBefore; },
      },
      {
        withDay: false,
        adjust: draft => { draft.command.after.day = draft.dayBefore; },
      },
      {
        withTransaction: false,
        adjust: draft => { draft.command.after.transaction = null; },
      },
    ];
    for (const options of missingProjectionCases) {
      const state = await seedBaseState();
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
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, { leaseEpoch: 3 });
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

  it('rejects a bento command when the active day menu price, revision or snapshot is stale', async () => {
    for (const adjust of [
      ({ command }: OrderDraft) => { (command.payload as Data).menuRevision = 2; },
      ({ transaction }: OrderDraft) => { transaction.menuPriceSnapshot = 99; },
      ({ transaction }: OrderDraft) => { transaction.vendorNameSnapshot = 'Other Vendor'; },
      ({ transaction }: OrderDraft) => { transaction.studentNameSnapshot = 'Forged Student'; },
    ]) {
      const state = await seedBaseState();
      await expectCreateOrderFailureIsAtomic(operatorDb(), state, { adjust });
    }
    const state = await seedBaseState();
    await expectCreateOrderFailureIsAtomic(operatorDb(), state, { mealPrice: 101 });
  });

  it('rejects pre-go-live, pre-opening-balance, future and impossible business dates atomically', async () => {
    const beforeLive = await seedBaseState({ businessDate: shiftDate(dayId, -1), goLiveDate: dayId });
    await expectCreateOrderFailureIsAtomic(operatorDb(), beforeLive);

    const beforeOpening = await seedBaseState({
      businessDate: shiftDate(dayId, -1),
      goLiveDate: shiftDate(dayId, -1),
      openingBalanceAsOfDate: dayId,
    });
    await expectCreateOrderFailureIsAtomic(operatorDb(), beforeOpening);

    const future = await seedBaseState({ businessDate: shiftDate(dayId, 1) });
    await expectCreateOrderFailureIsAtomic(operatorDb(), future);

    const impossible = await seedBaseState({
      businessDate: '2026-02-30',
      goLiveDate: '2026-02-30',
      openingBalanceAsOfDate: '2026-02-30',
    });
    await expectCreateOrderFailureIsAtomic(operatorDb(), impossible);
  });

  it('requires the exact active verified Google allowlist identity and current lease holder', async () => {
    const cases = [
      { db: operatorDb('uid-a', 'operator-a@example.test', { email_verified: false }), actorUid: operatorA.uid, actorEmail: operatorA.email },
      { db: operatorDb('uid-a', 'operator-a@example.test', { signInProvider: 'password' }), actorUid: operatorA.uid, actorEmail: operatorA.email },
      { db: operatorDb('uid-a', 'mismatched@example.test'), actorUid: operatorA.uid, actorEmail: 'mismatched@example.test' },
      { db: operatorDb('uid-unlisted', 'unlisted@example.test'), actorUid: 'uid-unlisted', actorEmail: 'unlisted@example.test' },
      { db: operatorDb(operatorB.uid, operatorB.email), actorUid: operatorB.uid, actorEmail: operatorB.email },
    ];
    for (const { db, actorUid, actorEmail } of cases) {
      const state = await seedBaseState();
      await expectCreateOrderFailureIsAtomic(db, state, { actorUid, actorEmail });
    }
    const inactive = await seedBaseState();
    await env.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), `operators/${operatorA.uid}`), { active: false });
    });
    await expectCreateOrderFailureIsAtomic(operatorDb(), inactive);
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
      expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ mealPrice: 110, paidAmount: 70, revision: 2, createdSeq: 1 });
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-40);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ mealTotal: 110, retainedReceipts: 70 });
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(2);
    });
  });

  it('requires a CorrectTransaction writer even when command.after.transaction is forged unchanged', async () => {
    const state = await seedExistingOrder(90);
    const { batch } = buildCorrectionBatch(
      operatorDb(),
      state,
      draft => { draft.command.after.transaction = state.transaction; draft.transaction = state.transaction; },
      { withTransaction: false },
    );
    await assertFails(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(1);
      expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ paidAmount: 90, mealPrice: 100, revision: 1 });
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-10);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.revision).toBe(2);
      expect((await getDoc(doc(db, 'commands/cmd-correct-1'))).exists()).toBe(false);
    });
  });

  it('requires CorrectTransaction head, student and day projections when their command snapshots are forged unchanged', async () => {
    const omitCases: Array<{
      options: { withHead?: boolean; withStudent?: boolean; withDay?: boolean };
      adjust: (draft: OrderDraft, state: SeedState & { transaction: Data }) => void;
    }> = [
      { options: { withHead: false }, adjust: (draft, state) => { draft.command.after.head = state.head; } },
      { options: { withStudent: false }, adjust: (draft, state) => { draft.command.after.student = state.student; } },
      { options: { withDay: false }, adjust: (draft, state) => { draft.command.after.day = state.day; } },
    ];
    for (const { options, adjust } of omitCases) {
      const state = await seedExistingOrder(90);
      const { batch } = buildCorrectionBatch(operatorDb(), state, draft => adjust(draft, state), options);
      await assertFails(batch.commit());
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(1);
        expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ mealPrice: 100, paidAmount: 90, revision: 1 });
        expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-10);
        expect((await getDoc(doc(db, `days/${dayId}`))).data()?.revision).toBe(2);
        expect((await getDoc(doc(db, 'commands/cmd-correct-1'))).exists()).toBe(false);
      });
    }
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

  it('rejects a correction that labels a book adjustment as a refund or subtracts cash twice', async () => {
    const state = await seedExistingOrder(90);
    const { batch } = buildCorrectionBatch(operatorDb(), state, draft => {
      draft.command.cashEffect = { before: 90, after: 70, delta: -20, reasonKind: 'refund', refundAmount: 20 };
    });
    await assertFails(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(1);
      expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ mealPrice: 100, paidAmount: 90, revision: 1 });
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-10);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.totals).toMatchObject({ mealTotal: 100, retainedReceipts: 90 });
      expect((await getDoc(doc(db, 'commands/cmd-correct-1'))).exists()).toBe(false);
    });
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

  it('requires a VoidTransaction writer even when command.after.transaction is forged unchanged', async () => {
    const state = await seedExistingOrder(0);
    const { batch } = buildCancellationBatch(
      operatorDb(),
      state,
      draft => { draft.command.after.transaction = state.transaction; draft.transaction = state.transaction; },
      { withTransaction: false },
    );
    await assertFails(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(1);
      expect((await getDoc(doc(db, 'transactions/tx-existing'))).data()).toMatchObject({ status: 'active', paidAmount: 0, revision: 1 });
      expect((await getDoc(doc(db, `students/${studentId}`))).data()?.currentBalance).toBe(-100);
      expect((await getDoc(doc(db, `days/${dayId}`))).data()?.revision).toBe(2);
      expect((await getDoc(doc(db, 'commands/cmd-void-1'))).exists()).toBe(false);
    });
  });

  it('refunds a paid order once and closes against the effective receipt total', async () => {
    const state = await seedExistingOrder(90);
    const cancellation = buildCancellationBatch(operatorDb(), state);
    await assertSucceeds(cancellation.batch.commit());
    let afterVoid: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, day] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `days/${dayId}`)),
      ]);
      afterVoid = { ...state, head: head.data() as Data, day: day.data() as Data };
    });
    const close = buildDayCommandBatch(operatorDb(), afterVoid as SeedState, 'CloseDay');
    await assertSucceeds(close.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const day = (await getDoc(doc(db, `days/${dayId}`))).data() as Data;
      const settlement = (await getDoc(doc(db, `days/${dayId}/settlements/1`))).data() as Data;
      expect((day.totals as Data).retainedReceipts).toBe(0);
      expect(settlement.expectedCash).toBe(1000);
      expect(settlement.expectedCash).toBe(Number(day.openingCash) + Number((day.totals as Data).retainedReceipts));
      expect(settlement.expectedCash).not.toBe(910);
      expect(settlement.difference).toBe(1);
    });
  });

  it('allows CloseDay and then ReopenDay as immutable settlement revisions', async () => {
    const open = await seedBaseState();
    const close = buildDayCommandBatch(operatorDb(), open, 'CloseDay');
    await assertSucceeds(close.batch.commit());
    let closedState: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, day, settlement] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/1`)),
      ]);
      closedState = { ...open, head: head.data() as Data, day: day.data() as Data, settlement: settlement.data() as Data };
    });
    const reopen = buildDayCommandBatch(operatorDb(), closedState, 'ReopenDay');
    await assertSucceeds(reopen.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, `days/${dayId}`))).data()).toMatchObject({ status: 'reopened', revision: 3, lastSettlementRevision: 2 });
      expect((await getDoc(doc(db, `days/${dayId}/settlements/1`))).data()).toMatchObject({ status: 'closed', revision: 1 });
      expect((await getDoc(doc(db, `days/${dayId}/settlements/2`))).data()).toMatchObject({ status: 'reopened', revision: 2, previousRevision: 1 });
      expect((await getDoc(doc(db, 'system/dataHead'))).data()?.seq).toBe(2);
    });

    let reopenedState: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, student, day, settlement] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/2`)),
      ]);
      reopenedState = {
        ...closedState,
        head: head.data() as Data,
        student: student.data() as Data,
        day: day.data() as Data,
        settlement: settlement.data() as Data,
      };
    });
    expect(reopenedState?.day.status).toBe('reopened');
    const orderAfterReopen = buildOrderBatch(operatorDb(), reopenedState as SeedState, { commandId: 'cmd-create-order-after-reopen' });
    await assertSucceeds(orderAfterReopen.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const day = (await getDoc(doc(db, `days/${dayId}`))).data() as Data;
      expect(day.status).toBe('reopened');
      expect(day.lastSettlementRevision).toBe(2);
      expect((day.totals as Data).retainedReceipts).toBe(90);
    });
    let reopenedAfterOrder: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, student, day, settlement] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/2`)),
      ]);
      reopenedAfterOrder = {
        ...reopenedState,
        head: head.data() as Data,
        student: student.data() as Data,
        day: day.data() as Data,
        settlement: settlement.data() as Data,
      };
    });
    const closeAgain = buildDayCommandBatch(operatorDb(), reopenedAfterOrder as SeedState, 'CloseDay');
    await assertSucceeds(closeAgain.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      expect((await getDoc(doc(db, `days/${dayId}`))).data()).toMatchObject({ status: 'closed', lastSettlementRevision: 3 });
      expect((await getDoc(doc(db, `days/${dayId}/settlements/3`))).data()).toMatchObject({ status: 'closed', revision: 3, previousRevision: 2 });
    });

    let closedAgainState: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, student, day, settlement] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/3`)),
      ]);
      closedAgainState = {
        ...reopenedAfterOrder,
        head: head.data() as Data,
        student: student.data() as Data,
        day: day.data() as Data,
        settlement: settlement.data() as Data,
      };
    });
    const reopenFourth = buildDayCommandBatch(operatorDb(), closedAgainState as SeedState, 'ReopenDay');
    await assertSucceeds(reopenFourth.batch.commit());

    let reopenedFourthState: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, student, day, settlement] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/4`)),
      ]);
      reopenedFourthState = {
        ...closedAgainState,
        head: head.data() as Data,
        student: student.data() as Data,
        day: day.data() as Data,
        settlement: settlement.data() as Data,
      };
      expect(day.data()).toMatchObject({ status: 'reopened', lastSettlementRevision: 4 });
      expect(settlement.data()).toMatchObject({ status: 'reopened', revision: 4, previousRevision: 3 });
    });
    const secondOrderAfterReopen = buildOrderBatch(operatorDb(), reopenedFourthState as SeedState, {
      commandId: 'cmd-create-order-after-reopen-2',
      transactionId: 'tx-create-order-after-reopen-2',
    });
    await assertSucceeds(secondOrderAfterReopen.batch.commit());

    let reopenedFourthAfterOrder: SeedState | undefined;
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [head, student, day, settlement] = await Promise.all([
        getDoc(doc(db, 'system/dataHead')),
        getDoc(doc(db, `students/${studentId}`)),
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/4`)),
      ]);
      reopenedFourthAfterOrder = {
        ...reopenedFourthState,
        head: head.data() as Data,
        student: student.data() as Data,
        day: day.data() as Data,
        settlement: settlement.data() as Data,
      };
    });
    const closeFifth = buildDayCommandBatch(operatorDb(), reopenedFourthAfterOrder as SeedState, 'CloseDay');
    await assertSucceeds(closeFifth.batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      const [day, revisionOne, revisionTwo, revisionThree, revisionFour, revisionFive] = await Promise.all([
        getDoc(doc(db, `days/${dayId}`)),
        getDoc(doc(db, `days/${dayId}/settlements/1`)),
        getDoc(doc(db, `days/${dayId}/settlements/2`)),
        getDoc(doc(db, `days/${dayId}/settlements/3`)),
        getDoc(doc(db, `days/${dayId}/settlements/4`)),
        getDoc(doc(db, `days/${dayId}/settlements/5`)),
      ]);
      expect(day.data()).toMatchObject({ status: 'closed', lastSettlementRevision: 5 });
      expect(revisionOne.data()).toMatchObject({ status: 'closed', revision: 1 });
      expect(revisionTwo.data()).toMatchObject({ status: 'reopened', revision: 2, previousRevision: 1 });
      expect(revisionThree.data()).toMatchObject({ status: 'closed', revision: 3, previousRevision: 2 });
      expect(revisionFour.data()).toMatchObject({ status: 'reopened', revision: 4, previousRevision: 3 });
      expect(revisionFive.data()).toMatchObject({ status: 'closed', revision: 5, previousRevision: 4 });
    });
  });

  it('rejects forged close state transitions, missing variance reason and settlement path links atomically', async () => {
    const closeMutations: Array<{
      adjust?: (draft: DayCommandDraft) => void;
      pathRevision?: number;
    }> = [
      {
        adjust: draft => {
          draft.command.reason = null;
          draft.settlement.note = '';
        },
      },
      { adjust: draft => { (draft.command.targets as Data).settlementRevision = 9; } },
      { pathRevision: 2 },
      { adjust: draft => { draft.dayAfter.lastSettlementRevision = 9; } },
      { adjust: draft => { draft.dayAfter.status = 'reopened'; } },
    ];
    for (const mutation of closeMutations) {
      await env.clearFirestore();
      const state = await seedBaseState();
      await expectDayCommandFailureIsAtomic(state, 'CloseDay', mutation.adjust, mutation.pathRevision);
    }
  });

  it('rejects a ReopenDay with forged previous revision or a mismatched settlement path atomically', async () => {
    const reopenMutations: Array<{
      adjust?: (draft: DayCommandDraft) => void;
      pathRevision?: number;
    }> = [
      { adjust: (draft: DayCommandDraft) => { (((draft.command.before as Data).previousSettlement) as Data).revision = 9; } },
      { adjust: (draft: DayCommandDraft) => { draft.settlement.previousRevision = 9; } },
      { adjust: undefined, pathRevision: 3 },
    ];
    for (const mutation of reopenMutations) {
      await env.clearFirestore();
      const open = await seedBaseState();
      const firstClose = buildDayCommandBatch(operatorDb(), open, 'CloseDay');
      await assertSucceeds(firstClose.batch.commit());
      let closed: SeedState | undefined;
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        const [head, student, day, settlement] = await Promise.all([
          getDoc(doc(db, 'system/dataHead')),
          getDoc(doc(db, `students/${studentId}`)),
          getDoc(doc(db, `days/${dayId}`)),
          getDoc(doc(db, `days/${dayId}/settlements/1`)),
        ]);
        closed = {
          ...open,
          head: head.data() as Data,
          student: student.data() as Data,
          day: day.data() as Data,
          settlement: settlement.data() as Data,
        };
      });
      await expectDayCommandFailureIsAtomic(closed as SeedState, 'ReopenDay', mutation.adjust, mutation.pathRevision);
    }
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
