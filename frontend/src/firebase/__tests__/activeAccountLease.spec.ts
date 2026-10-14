import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  acquireLease,
  renewLease,
  releaseLease,
} from '../activeAccountLease';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

let env: RulesTestEnvironment;

const firestoreEmulatorHost =
  process.env.FIRESTORE_EMULATOR_HOST ?? process.env.FIREBASE_FIRESTORE_EMULATOR_ADDRESS;

const requiresLeaseProof = process.env.EASYORDER_REQUIRE_ACTIVE_ACCOUNT_LEASE_PROOF === 'true';
if (requiresLeaseProof && !firestoreEmulatorHost) {
  throw new Error('P04 lease proof requires FIRESTORE_EMULATOR_HOST; refusing to skip the emulator suite.');
}

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

async function seedOperators() {
  await env.withSecurityRulesDisabled(async context => {
    const fs = context.firestore();
    await setDoc(doc(fs, `operators/${operatorA.uid}`), operatorA);
    await setDoc(doc(fs, `operators/${operatorB.uid}`), operatorB);
    await setDoc(doc(fs, `operators/${inactiveOperator.uid}`), inactiveOperator);
  });
}

async function seedInitialLease(holderUid: string | null = null, epoch = 0, updatedAt?: Date) {
  await env.withSecurityRulesDisabled(async context => {
    const fs = context.firestore();
    await setDoc(doc(fs, 'system/accessLease'), {
      holderUid,
      epoch,
      updatedAt: updatedAt ?? new Date(),
    });
  });
}

function authedDb(
  uid: string,
  email: string,
  claims: { email_verified?: boolean; signInProvider?: 'google.com' | 'password' | 'anonymous' } = {},
) {
  return env.authenticatedContext(uid, {
    email,
    email_verified: claims.email_verified ?? true,
    firebase: { sign_in_provider: claims.signInProvider ?? 'google.com' },
  }).firestore();
}

describeOrSkip('activeAccountLease: P04 全公司單一活躍 Google 租約規範', () => {
  beforeAll(async () => {
    // @ts-expect-error dynamic node import in test environment
    const fs = await import('node:fs');
    // @ts-expect-error dynamic node import in test environment
    const path = await import('node:path');
    const rulesPath = path.resolve(process.cwd(), '../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: {
        rules,
        host: firestoreEmulatorHost!.split(':')[0],
        port: Number(firestoreEmulatorHost!.split(':')[1] || '8080'),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedOperators();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('A02.1: 空租約初始化，核准操作員 A 可以成功 acquire 租約（epoch 遞增為 1）', async () => {
    await seedInitialLease(null, 0);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 0);
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') {
      expect(result.holderUid).toBe(operatorA.uid);
      expect(result.epoch).toBe(1);
    }

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorA.uid);
    expect(leaseDoc.data()?.epoch).toBe(1);
  });

  it('A02.2: A 持有期間，B 同時嘗試 acquire 回傳 busy，且 Rules 拒絕 B 強制覆寫', async () => {
    await seedInitialLease(operatorA.uid, 1, new Date());
    const dbB = authedDb(operatorB.uid, operatorB.email);

    // Client transaction 檢查發現 busy
    const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1);
    expect(result.status).toBe('busy');

    // 直接以 Rules 攻擊覆寫也必須被 Rules 拒絕
    await assertFails(
      updateDoc(doc(dbB, 'system/accessLease'), {
        holderUid: operatorB.uid,
        epoch: 2,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('A02.3: 持有人 A 成功續約（renew），holderUid 與 epoch 保持不變', async () => {
    await seedInitialLease(operatorA.uid, 1, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);

    const result = await renewLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') {
      expect(result.holderUid).toBe(operatorA.uid);
      expect(result.epoch).toBe(1);
    }

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorA.uid);
    expect(leaseDoc.data()?.epoch).toBe(1);
  });

  it('A02.4: 非持有人 B 嘗試 renew 或 release A 的租約，被 Rules 拒絕', async () => {
    await seedInitialLease(operatorA.uid, 1, new Date());
    const dbB = authedDb(operatorB.uid, operatorB.email);

    // B 嘗試 renew A 的租約
    await assertFails(
      updateDoc(doc(dbB, 'system/accessLease'), {
        holderUid: operatorA.uid,
        epoch: 1,
        updatedAt: serverTimestamp(),
      }),
    );

    // B 嘗試 release A 的租約
    await assertFails(
      updateDoc(doc(dbB, 'system/accessLease'), {
        holderUid: null,
        epoch: 2,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('A02.5: A 釋放（release）後，holder 變 null，隨後 B 即可成功取得租約（epoch 遞增）', async () => {
    await seedInitialLease(operatorA.uid, 1, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);
    const dbB = authedDb(operatorB.uid, operatorB.email);

    // A release
    const released = await releaseLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(released).toBe(true);

    const leaseAfterRelease = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseAfterRelease.data()?.holderUid).toBeNull();
    expect(leaseAfterRelease.data()?.epoch).toBe(2);

    // B acquire
    const resultB = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 2);
    expect(resultB.status).toBe('acquired');
    if (resultB.status === 'acquired') {
      expect(resultB.holderUid).toBe(operatorB.uid);
      expect(resultB.epoch).toBe(3);
    }
  });

  it('A02.6: 租約逾期（超過 5 分鐘）：即使 A 未手動釋放，B 也能成功取得新租約', async () => {
    // 模擬 6 分鐘前的租約
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    await seedInitialLease(operatorA.uid, 1, sixMinutesAgo);

    const dbB = authedDb(operatorB.uid, operatorB.email);
    const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1);
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') {
      expect(result.holderUid).toBe(operatorB.uid);
      expect(result.epoch).toBe(2);
    }
  });

  it('A03.1: Stale epoch 防護：傳入舊 expectedEpoch 時在寫入前中止', async () => {
    await seedInitialLease(operatorA.uid, 2, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);

    // 嘗試以舊的 epoch: 1 續約或釋放
    const renewResult = await renewLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(renewResult.status).toBe('stale_epoch');

    const releaseResult = await releaseLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(releaseResult).toBe(false);
  });

  it('A04.1: 停用帳號（active == false）嘗試 acquire 遭 Rules 拒絕', async () => {
    await seedInitialLease(null, 0);
    const dbInactive = authedDb(inactiveOperator.uid, inactiveOperator.email);

    const result = await acquireLease(dbInactive as unknown as Firestore, inactiveOperator.uid, 0);
    expect(result.status).toBe('lost');
  });

  it('A03.2: stale expectedEpoch prevents acquire without changing the server lease', async () => {
    await seedInitialLease(operatorA.uid, 2, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);

    const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(result).toEqual({ status: 'stale_epoch', expectedEpoch: 1, actualEpoch: 2 });

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorA.uid);
    expect(leaseDoc.data()?.epoch).toBe(2);
  });

  it('A03.3: a slow client clock cannot block a server-approved expired handoff', async () => {
    const realNow = Date.now();
    await seedInitialLease(operatorA.uid, 1, new Date(realNow - 6 * 60 * 1000));
    const dbB = authedDb(operatorB.uid, operatorB.email);
    const fakeClock = vi.spyOn(Date, 'now').mockReturnValue(realNow - 10 * 60 * 1000);

    try {
      const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1);
      expect(result.status).toBe('acquired');
    } finally {
      fakeClock.mockRestore();
    }
  });

  it('A03.4: a fast client clock cannot acquire a lease that Rules still consider active', async () => {
    const realNow = Date.now();
    await seedInitialLease(operatorA.uid, 1, new Date(realNow));
    const dbB = authedDb(operatorB.uid, operatorB.email);
    const fakeClock = vi.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60 * 1000);

    try {
      const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1);
      expect(result.status).toBe('busy');
      if (result.status === 'busy') expect(result.currentHolderUid).toBe(operatorA.uid);
    } finally {
      fakeClock.mockRestore();
    }
  });

  it('A04.2: Client 禁止使用本機時間（非 serverTimestamp()）更新 updatedAt', async () => {
    await seedInitialLease(null, 0);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    // 嘗試送本機產生的 Date 時間
    await assertFails(
      updateDoc(doc(dbA, 'system/accessLease'), {
        holderUid: operatorA.uid,
        epoch: 1,
        updatedAt: new Date(),
      }),
    );
  });

  it('A04.3: Client 禁止 create 或 delete system/accessLease 文件', async () => {
    const dbA = authedDb(operatorA.uid, operatorA.email);

    // client delete 拒絕
    await assertFails(deleteDoc(doc(dbA, 'system/accessLease')));

    // client set 嘗試重建拒絕
    await assertFails(
      setDoc(doc(dbA, 'system/accessLease'), {
        holderUid: null,
        epoch: 0,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('A04.4: Client 禁止在 lease 文件中寫入非授權額外欄位', async () => {
    await seedInitialLease(null, 0);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    await assertFails(
      updateDoc(doc(dbA, 'system/accessLease'), {
        holderUid: operatorA.uid,
        epoch: 1,
        updatedAt: serverTimestamp(),
        extraField: 'not-allowed',
      }),
    );
  });
});
