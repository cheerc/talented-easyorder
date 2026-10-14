import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

let env: RulesTestEnvironment;

const rulesPath = path.resolve(import.meta.dirname, '../../../../firestore.rules');

const firestoreEmulatorHost =
  process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;

const describeOrSkip = firestoreEmulatorHost ? describe : describe.skip;

const operatorA = {
  uid: 'uid-operator-a',
  email: 'operator-a@example.com',
  displayName: '操作員 A',
  active: true,
};

const operatorB = {
  uid: 'uid-operator-b',
  email: 'operator-b@example.com',
  displayName: '操作員 B',
  active: true,
};

const inactiveOperator = {
  uid: 'uid-inactive',
  email: 'inactive@example.com',
  displayName: '停用操作員',
  active: false,
};

async function seedOperatorDoc(op: { uid: string; email: string; displayName: string; active: boolean }) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), `operators/${op.uid}`), {
      uid: op.uid,
      email: op.email,
      displayName: op.displayName,
      active: op.active,
      createdAt: new Date('2026-10-14T08:00:00.000Z'),
      updatedAt: new Date('2026-10-14T08:00:00.000Z'),
    });
  });
}

function authedDb(
  uid: string,
  email: string,
  claims: { email_verified?: boolean; signInProvider?: 'google.com' | 'password' | 'anonymous' | 'github.com' } = {},
) {
  return env.authenticatedContext(uid, {
    email,
    email_verified: claims.email_verified ?? true,
    firebase: { sign_in_provider: claims.signInProvider ?? 'google.com' },
  }).firestore();
}

describeOrSkip('firestore.rules — P03 A01: Google 登入與等權白名單規範', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
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

  it('A01.1: 兩個已核准的 Google 測試身分都能讀取本人 operator 文件（等權，無 role）', async () => {
    await seedOperatorDoc(operatorA);
    await seedOperatorDoc(operatorB);

    const dbA = authedDb(operatorA.uid, operatorA.email);
    const dbB = authedDb(operatorB.uid, operatorB.email);

    await assertSucceeds(getDoc(doc(dbA, `operators/${operatorA.uid}`)));
    await assertSucceeds(getDoc(doc(dbB, `operators/${operatorB.uid}`)));
  });

  it('A01.2: 禁止讀取其他人的 operator 文件（跨 UID 讀取拒絕）', async () => {
    await seedOperatorDoc(operatorA);
    await seedOperatorDoc(operatorB);

    const dbA = authedDb(operatorA.uid, operatorA.email);
    // A 嘗試讀取 B 的 operator 文件
    await assertFails(getDoc(doc(dbA, `operators/${operatorB.uid}`)));
  });

  it('A01.3: 禁止 client 列出所有 operators 文件（list 拒絕，防名單外洩）', async () => {
    await seedOperatorDoc(operatorA);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    await assertFails(getDocs(collection(dbA, 'operators')));
  });

  it('A01.4: 禁止 client 自建、修改、刪除 operators 文件（只有維護者可管理）', async () => {
    await seedOperatorDoc(operatorA);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    // 嘗試建立新 operator
    await assertFails(
      setDoc(doc(dbA, 'operators/uid-attacker'), {
        uid: 'uid-attacker',
        email: 'attacker@example.com',
        displayName: '攻擊者',
        active: true,
      }),
    );

    // 嘗試修改本人 active 或 email
    await assertFails(
      updateDoc(doc(dbA, `operators/${operatorA.uid}`), {
        active: false,
      }),
    );

    // 嘗試刪除本人文件
    await assertFails(deleteDoc(doc(dbA, `operators/${operatorA.uid}`)));
  });

  it('A01.5: 同網域但未在白名單的 Google 帳號不可讀取他人文件，亦無法存取業務資料', async () => {
    // 未在 operators 文件中建立此 UID
    const unapprovedUid = 'uid-unapproved-colleague';
    const unapprovedEmail = 'colleague@example.com';
    const dbUnapproved = authedDb(unapprovedUid, unapprovedEmail);

    await assertFails(getDoc(doc(dbUnapproved, `operators/${operatorA.uid}`)));
    await assertFails(getDoc(doc(dbUnapproved, 'students/stu-1')));
  });

  it('A01.6: 改 email（Auth token email 與 operator doc 不吻合）拒絕認可為有效白名單', async () => {
    await seedOperatorDoc(operatorA);
    // 雖然 UID 吻合，但使用不同 email 登入
    const dbSpoofed = authedDb(operatorA.uid, 'spoofed@attacker.com');

    // 業務資料必須 deny
    await assertFails(getDoc(doc(dbSpoofed, 'students/stu-1')));
    await assertFails(getDoc(doc(dbSpoofed, 'transactions/tx-1')));
  });

  it('A01.7: 非 Google Provider 拒絕（必須為 google.com）', async () => {
    await seedOperatorDoc(operatorA);
    const dbPassword = authedDb(operatorA.uid, operatorA.email, { signInProvider: 'password' });

    // 非 Google provider 存取業務資料拒絕
    await assertFails(getDoc(doc(dbPassword, 'students/stu-1')));
  });

  it('A01.8: 未驗證 Email（email_verified == false）拒絕', async () => {
    await seedOperatorDoc(operatorA);
    const dbUnverified = authedDb(operatorA.uid, operatorA.email, { email_verified: false });

    // 未驗證 email 存取業務資料拒絕
    await assertFails(getDoc(doc(dbUnverified, 'students/stu-1')));
  });

  it('A01.9: 停用帳號（active == false）禁止存取業務資料', async () => {
    await seedOperatorDoc(inactiveOperator);
    const dbInactive = authedDb(inactiveOperator.uid, inactiveOperator.email);

    // 停用帳號可讀本人狀態以顯示停用通知
    await assertSucceeds(getDoc(doc(dbInactive, `operators/${inactiveOperator.uid}`)));

    // 但業務資料嚴格禁止
    await assertFails(getDoc(doc(dbInactive, 'students/stu-1')));
    await assertFails(getDoc(doc(dbInactive, 'transactions/tx-1')));
  });

  it('A01.10: P03 業務資料全面 Deny（核准身分亦不能在此 phase 讀寫 students, transactions, days 等）', async () => {
    await seedOperatorDoc(operatorA);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    // students deny
    await assertFails(getDoc(doc(dbA, 'students/stu-1')));
    await assertFails(setDoc(doc(dbA, 'students/stu-1'), { studentId: 'stu-1' }));

    // transactions deny
    await assertFails(getDoc(doc(dbA, 'transactions/tx-1')));
    await assertFails(setDoc(doc(dbA, 'transactions/tx-1'), { transactionId: 'tx-1' }));

    // commands deny
    await assertFails(getDoc(doc(dbA, 'commands/cmd-1')));
    await assertFails(setDoc(doc(dbA, 'commands/cmd-1'), { commandId: 'cmd-1' }));

    // days deny
    await assertFails(getDoc(doc(dbA, 'days/2026-10-14')));
    await assertFails(setDoc(doc(dbA, 'days/2026-10-14'), { businessDate: '2026-10-14' }));

    // vendors deny
    await assertFails(getDoc(doc(dbA, 'vendors/ven-1')));
    await assertFails(setDoc(doc(dbA, 'vendors/ven-1'), { vendorId: 'ven-1' }));

    // system deny
    await assertFails(getDoc(doc(dbA, 'system/accessLease')));
    await assertFails(setDoc(doc(dbA, 'system/accessLease'), { epoch: 1 }));
  });
});
