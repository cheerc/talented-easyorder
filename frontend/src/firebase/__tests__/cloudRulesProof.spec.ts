import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import fixtureRules from './fixtures/cloudRulesProof.rules?raw';

declare const process: { env: Record<string, string | undefined> };

const projectId = 'demo-easyorder';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;
const requireEmulator = process.env.EASYORDER_REQUIRE_CLOUD_RULES_PROOF === 'true';

if (requireEmulator && !emulatorHost) {
  throw new Error('Cloud Rules proof gate requires FIRESTORE_EMULATOR_HOST; refusing to skip the suite.');
}

const describeWithEmulator = emulatorHost ? describe : describe.skip;
let env: RulesTestEnvironment;

const seedTime = new Date('2026-10-13T00:00:00.000Z');

async function seedBaseState() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'operators/uid-a'), {
        uid: 'uid-a', email: 'operator-a@example.test', active: true,
      }),
      setDoc(doc(db, 'system/accessLease'), {
        holderUid: 'uid-a', epoch: 4, updatedAt: seedTime,
      }),
      setDoc(doc(db, 'system/dataHead'), {
        schemaVersion: 1, datasetId: 'proof-dataset', seq: 0,
        lastCommandId: null, maintenance: false, goLiveDate: '2026-10-13', updatedAt: seedTime,
      }),
      setDoc(doc(db, 'students/stu-a'), {
        studentId: 'stu-a', displayName: 'Synthetic Student', aliases: [], status: 'active',
        openingBalance: { amount: 0, asOfDate: '2026-10-13', note: '', createdAt: seedTime },
        currentBalance: 0, createdAt: seedTime, revision: 1,
        lastCommandId: 'seed-student', updatedAt: seedTime,
      }),
      setDoc(doc(db, 'days/2026-10-14'), {
        status: 'open', revision: 1, menu: null, openingCash: 1000,
        openedBy: 'uid-a', openedAt: seedTime,
        totals: { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0 },
        lastSettlementRevision: 0, lastCommandId: 'seed-day', updatedAt: seedTime,
      }),
    ]);
  });
}

function operatorDb(uid = 'uid-a', email = 'operator-a@example.test') {
  return env.authenticatedContext(uid, {
    email,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
  }).firestore();
}

function fiveDocumentCreateOrder(db: ReturnType<typeof operatorDb>, includeExtraTransaction: boolean) {
  const batch = writeBatch(db);
  const commandId = 'cmd-create-order-1';
  const transactionId = 'tx-create-order-1';
  const studentId = 'stu-a';
  const businessDate = '2026-10-14';
  const tx = {
    transactionId, studentId, businessDate, type: 'order',
    mealPrice: 100, paidAmount: 90, status: 'active', revision: 1,
    createdAt: serverTimestamp(), createdSeq: 1,
    operatorUid: 'uid-a', operatorEmail: 'operator-a@example.test', source: 'pc',
  };
  const student = {
    studentId, displayName: 'Synthetic Student', aliases: [], status: 'active',
    openingBalance: { amount: 0, asOfDate: '2026-10-13', note: '', createdAt: seedTime },
    currentBalance: -10, createdAt: seedTime, revision: 2,
    lastCommandId: commandId, updatedAt: serverTimestamp(),
  };
  const day = {
    status: 'open', revision: 2, menu: null, openingCash: 1000,
    openedBy: 'uid-a', openedAt: seedTime,
    totals: { activeTransactionCount: 1, bentoCount: 1, otherMealCount: 0, mealTotal: 100, retainedReceipts: 90, cashierIncome: 0, cashierExpense: 0 },
    lastSettlementRevision: 0, lastCommandId: commandId, updatedAt: serverTimestamp(),
  };

  batch.set(doc(db, `commands/${commandId}`), {
    commandId, kind: 'CreateOrder', seq: 1, leaseEpoch: 4,
    actor: { uid: 'uid-a', email: 'operator-a@example.test' },
    committedAt: serverTimestamp(), businessDate, studentId,
    targets: { transactionId, studentId, dayId: businessDate },
    before: { transaction: null, student: { revision: 1, currentBalance: 0 }, day: { revision: 1 } },
    after: { transaction: tx, student, day },
    payload: { mealPrice: 100, paidAmount: 90 }, inputFingerprint: 'synthetic-fingerprint-1',
  });
  batch.update(doc(db, 'system/dataHead'), {
    seq: 1, lastCommandId: commandId, updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, `transactions/${transactionId}`), tx);
  batch.update(doc(db, `students/${studentId}`), student);
  batch.update(doc(db, `days/${businessDate}`), day);
  if (includeExtraTransaction) {
    batch.set(doc(db, 'transactions/tx-extra'), { ...tx, transactionId: 'tx-extra' });
  }
  return { batch, commandId, transactionId };
}

describeWithEmulator('P01 temporary cloud Rules proof', () => {
  beforeAll(async () => {
    if (!emulatorHost) throw new Error('Expected a Firestore Emulator host for this suite.');
    const [host, portText] = emulatorHost.split(':');
    env = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: fixtureRules,
        host,
        port: Number(portText || '8080'),
      },
    });
  });

  beforeEach(async () => env.clearFirestore());
  afterAll(async () => env?.cleanup());

  it('RED witness: permissive fixture accepts an uncommanded extra transaction beside a five-document order', async () => {
    await seedBaseState();
    const db = operatorDb();
    const { batch } = fiveDocumentCreateOrder(db, true);
    await assertSucceeds(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const extra = await getDoc(doc(context.firestore(), 'transactions/tx-extra'));
      expect(extra.exists()).toBe(true);
    });
  });

  it('GREEN expectation: the same uncommanded extra transaction must be denied atomically', async () => {
    await seedBaseState();
    const db = operatorDb();
    const { batch } = fiveDocumentCreateOrder(db, true);
    await assertFails(batch.commit());
    await env.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore();
      const head = await getDoc(doc(adminDb, 'system/dataHead'));
      const transaction = await getDoc(doc(adminDb, 'transactions/tx-create-order-1'));
      const extra = await getDoc(doc(adminDb, 'transactions/tx-extra'));
      const student = await getDoc(doc(adminDb, 'students/stu-a'));
      const day = await getDoc(doc(adminDb, 'days/2026-10-14'));
      expect(head.data()?.seq).toBe(0);
      expect(transaction.exists()).toBe(false);
      expect(extra.exists()).toBe(false);
      expect(student.data()?.currentBalance).toBe(0);
      expect(day.data()?.revision).toBe(1);
    });
  });
});
