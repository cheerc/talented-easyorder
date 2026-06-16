import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;

const rulesPath = path.resolve(import.meta.dirname, '../../../../firestore.rules');

const firestoreEmulatorHost =
  process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;

/**
 * Ref: #333 — Firestore security rules integration tests.
 *
 * These tests require a running Firestore emulator and are automatically
 * skipped when FIRESTORE_EMULATOR_HOST is not set. This is intentional:
 * security rules can only be meaningfully tested against the actual rules
 * engine, not mocks.
 *
 * To run locally:
 *   firebase emulators:start --only firestore
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run src/firebase/__tests__/firestoreRules.spec.ts
 *
 * CI: Add a Firestore emulator service to the CI pipeline to enable these
 * tests. Until then, they remain skipped (not a code issue, infra gap).
 */
const describeOrSkip = firestoreEmulatorHost ? describe : describe.skip;

async function seedOperator(uid: string, email: string, role: 'counter' | 'admin' = 'counter', active = true) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `operators/${uid}`), {
      uid,
      email,
      displayName: email,
      role,
      active,
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      updatedAt: new Date('2026-05-16T08:00:00.000Z'),
    });
  });
}

async function seedStudent(studentId: string, balance = 500) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `students/${studentId}`), {
      id: studentId,
      displayName: '王小明',
      aliases: [],
      className: null,
      groupName: null,
      openingBalance: balance,
      currentBalance: balance,
      status: 'active',
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      createdBy: 'seed',
      updatedAt: new Date('2026-05-16T08:00:00.000Z'),
      updatedBy: 'seed',
      revision: 1,
      lastTransactionId: null,
    });
  });
}

async function seedTransaction(transactionId: string, studentId = '015', amount = 100) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `transactions/${transactionId}`), {
      id: transactionId,
      studentId,
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount,
      balanceBefore: 500,
      balanceAfter: 500 + amount,
      clientBalanceAfterPreview: 500 + amount,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: amount,
      operatorId: 'uid-counter',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: 'seeded transaction',
      status: 'pending',
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      committedAt: null,
    });
  });
}

function authedDb(uid: string, email: string) {
  return env.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

describeOrSkip('firestore.rules required cases', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'easyorder-rules-test',
      firestore: {
        rules: readFileSync(rulesPath, 'utf8'),
        host: firestoreEmulatorHost!.split(':')[0],
        port: Number(firestoreEmulatorHost!.split(':')[1] || '8080'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('allows active @talented.com.tw operator to create a transaction with matching operatorId', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertSucceeds(setDoc(doc(db, 'transactions/tx-1'), {
      id: 'tx-1',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 0,
      balanceAfter: 100,
      clientBalanceAfterPreview: 100,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-counter',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
      createdAt: new Date('2026-05-16T08:00:00.000Z'),
      committedAt: null,
    }));
  });

  it('rejects non-talented email even if signed in', async () => {
    await seedOperator('uid-outsider', 'outsider@gmail.com');
    const db = authedDb('uid-outsider', 'outsider@gmail.com');

    await assertFails(setDoc(doc(db, 'transactions/tx-outsider'), {
      id: 'tx-outsider',
      studentId: '015',
      type: 'payment',
      amount: 100,
      operatorId: 'uid-outsider',
      businessDate: '2026-05-16',
    }));
  });

  it('rejects hard deletion of students and transactions', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(deleteDoc(doc(db, 'students/015')));
    await assertFails(deleteDoc(doc(db, 'transactions/tx-1')));
  });

  it('rejects direct student balance changes without a matching transaction in the same write', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    await seedStudent('015', 500);
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(updateDoc(doc(db, 'students/015'), {
      currentBalance: 999,
      revision: 2,
      updatedAt: new Date('2026-05-16T08:01:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-missing',
    }));
  });

  it('rejects projection update that reuses an existing transaction ID', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    await seedStudent('015', 500);
    await seedTransaction('tx-existing', '015', 100);
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(updateDoc(doc(db, 'students/015'), {
      currentBalance: 600,
      revision: 2,
      updatedAt: new Date('2026-05-16T08:02:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-existing',
    }));
  });

  it('allows student balance projection only when the same batch creates the matching transaction', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    await seedStudent('015', 500);
    const db = authedDb('uid-counter', 'counter@talented.com.tw');
    const batch = writeBatch(db);

    batch.set(doc(db, 'transactions/tx-2'), {
      id: 'tx-2',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 500,
      balanceAfter: 600,
      clientBalanceAfterPreview: 600,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-counter',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
      createdAt: new Date('2026-05-16T08:01:00.000Z'),
      committedAt: null,
    });
    batch.update(doc(db, 'students/015'), {
      currentBalance: 600,
      revision: 2,
      updatedAt: new Date('2026-05-16T08:01:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-2',
    });

    await assertSucceeds(batch.commit());
  });

  it('rejects a second projection update with the same transaction ID', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    await seedStudent('015', 500);
    const db = authedDb('uid-counter', 'counter@talented.com.tw');
    const batch = writeBatch(db);

    batch.set(doc(db, 'transactions/tx-replay'), {
      id: 'tx-replay',
      studentId: '015',
      studentNameSnapshot: '王小明',
      type: 'payment',
      amount: 100,
      balanceBefore: 500,
      balanceAfter: 600,
      clientBalanceAfterPreview: 600,
      menuNameSnapshot: '',
      price: 0,
      paidAmount: 100,
      operatorId: 'uid-counter',
      operatorEmail: 'counter@talented.com.tw',
      deviceId: 'pc-1',
      businessDate: '2026-05-16',
      sourceDevice: 'pc',
      note: '補錢',
      status: 'pending',
      createdAt: new Date('2026-05-16T08:03:00.000Z'),
      committedAt: null,
    });
    batch.update(doc(db, 'students/015'), {
      currentBalance: 600,
      revision: 2,
      updatedAt: new Date('2026-05-16T08:03:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-replay',
    });
    await assertSucceeds(batch.commit());

    await assertFails(updateDoc(doc(db, 'students/015'), {
      currentBalance: 700,
      revision: 3,
      updatedAt: new Date('2026-05-16T08:04:00.000Z'),
      updatedBy: 'uid-counter',
      lastTransactionId: 'tx-replay',
    }));
  });

  it('rejects transaction create when operatorId does not match auth uid', async () => {
    await seedOperator('uid-counter', 'counter@talented.com.tw');
    const db = authedDb('uid-counter', 'counter@talented.com.tw');

    await assertFails(setDoc(doc(db, 'transactions/tx-mismatch'), {
      id: 'tx-mismatch',
      studentId: '015',
      type: 'payment',
      amount: 100,
      operatorId: 'different-uid',
      businessDate: '2026-05-16',
    }));
  });
});
