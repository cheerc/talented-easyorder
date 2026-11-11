import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import {
  acquireLease,
  renewLease,
  releaseLease,
  readLeaseTakerEmail,
  LEASE_DURATION_MS,
} from '../activeAccountLease';

declare const process: { env: Record<string, string | undefined>; cwd: () => string };

let env: RulesTestEnvironment;
let rulesSource = '';

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
    const defaultRulesPath = path.resolve(process.cwd(), process.cwd().endsWith('frontend') ? '../firestore.rules' : 'firestore.rules');
    const rulesPath = process.env.EASYORDER_TEST_RULES_PATH ?? defaultRulesPath;
    rulesSource = fs.readFileSync(rulesPath, 'utf8');

    env = await initializeTestEnvironment({
      projectId: 'demo-easyorder',
      firestore: {
        rules: rulesSource,
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

    const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 0, operatorA.email);
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') {
      expect(result.holderUid).toBe(operatorA.uid);
      expect(result.epoch).toBe(1);
    }

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorA.uid);
    expect(leaseDoc.data()?.epoch).toBe(1);
  });

  it('A02.2: A 持有有效租約期間，白名單 B 經確認後可立即接手（epoch +1，takeover 事件記錄 B）', async () => {
    await seedInitialLease(operatorA.uid, 1, new Date());
    const dbB = authedDb(operatorB.uid, operatorB.email);

    const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1, operatorB.email);
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') {
      expect(result.holderUid).toBe(operatorB.uid);
      expect(result.epoch).toBe(2);
    }

    const leaseDoc = await getDoc(doc(dbB, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorB.uid);
    expect(leaseDoc.data()?.epoch).toBe(2);
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
    const released = await releaseLease(dbA as unknown as Firestore, operatorA.uid, 1, operatorA.email);
    expect(released).toBe(true);

    const leaseAfterRelease = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseAfterRelease.data()?.holderUid).toBeNull();
    expect(leaseAfterRelease.data()?.epoch).toBe(2);

    // B acquire
    const resultB = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 2, operatorB.email);
    expect(resultB.status).toBe('acquired');
    if (resultB.status === 'acquired') {
      expect(resultB.holderUid).toBe(operatorB.uid);
      expect(resultB.epoch).toBe(3);
    }
  });

  it('A02.6: server time beyond the expiry boundary allows B to acquire (90-second safety window)', async () => {
    const expiredAt = new Date(Date.now() - LEASE_DURATION_MS - 90_000);
    await seedInitialLease(operatorA.uid, 1, expiredAt);

    const dbB = authedDb(operatorB.uid, operatorB.email);
    const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1, operatorB.email);
    expect(result.status).toBe('acquired');
    if (result.status === 'acquired') {
      expect(result.holderUid).toBe(operatorB.uid);
      expect(result.epoch).toBe(2);
    }
  });

  it('A02.7: a lease still inside its 5-minute window can be taken over by another approved operator', async () => {
    const expiresAt = new Date(Date.now() + 90_000);
    await seedInitialLease(operatorA.uid, 1, new Date(expiresAt.getTime() - LEASE_DURATION_MS));
    const dbB = authedDb(operatorB.uid, operatorB.email);

    const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1, operatorB.email);
    expect(result.status).toBe('acquired');

    const leaseDoc = await getDoc(doc(dbB, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorB.uid);
    expect(leaseDoc.data()?.epoch).toBe(2);
  });

  it('A02.8: concurrent acquire calls with the same expected epoch have exactly one winner', async () => {
    await seedInitialLease(null, 0);
    const dbA = authedDb(operatorA.uid, operatorA.email);
    const dbB = authedDb(operatorB.uid, operatorB.email);

    const results = await Promise.all([
      acquireLease(dbA as unknown as Firestore, operatorA.uid, 0, operatorA.email),
      acquireLease(dbB as unknown as Firestore, operatorB.uid, 0, operatorB.email),
    ]);
    const winners = results.filter(result => result.status === 'acquired');
    const losers = results.filter(result => result.status !== 'acquired');

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const winner = winners[0];
    expect(winner?.status).toBe('acquired');
    if (!winner || winner.status !== 'acquired') throw new Error('Expected one successful acquire');

    const loser = losers[0];
    expect(['busy', 'stale_epoch', 'lost']).toContain(loser?.status);
    if (loser?.status === 'busy') {
      expect(loser.currentHolderUid).toBe(winner.holderUid);
      expect(loser.epoch).toBe(1);
    }
    if (loser?.status === 'stale_epoch') {
      expect(loser.expectedEpoch).toBe(0);
      expect(loser.actualEpoch).toBe(1);
    }

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(winner.holderUid);
    expect(leaseDoc.data()?.epoch).toBe(1);
  });

  it('A02.9: concurrent renew and release leave the lease vacant at a new epoch', async () => {
    await seedInitialLease(operatorA.uid, 1, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);

    const [renewResult, releaseResult] = await Promise.all([
      renewLease(dbA as unknown as Firestore, operatorA.uid, 1),
      releaseLease(dbA as unknown as Firestore, operatorA.uid, 1, operatorA.email),
    ]);

    expect(['acquired', 'stale_epoch', 'lost']).toContain(renewResult.status);
    expect(releaseResult).toBe(true);

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBeNull();
    expect(leaseDoc.data()?.epoch).toBe(2);
  });

  it('A03.1: Stale epoch 防護：傳入舊 expectedEpoch 時在寫入前中止', async () => {
    await seedInitialLease(operatorA.uid, 2, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);

    // 嘗試以舊的 epoch: 1 續約或釋放
    const renewResult = await renewLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(renewResult.status).toBe('stale_epoch');

    const releaseResult = await releaseLease(dbA as unknown as Firestore, operatorA.uid, 1, operatorA.email);
    expect(releaseResult).toBe(false);
  });

  it('A04.1: 停用帳號（active == false）嘗試 acquire 遭 Rules 拒絕', async () => {
    await seedInitialLease(null, 0);
    const dbInactive = authedDb(inactiveOperator.uid, inactiveOperator.email);

    const result = await acquireLease(dbInactive as unknown as Firestore, inactiveOperator.uid, 0, inactiveOperator.email);
    expect(result.status).toBe('lost');
  });

  it('A03.2: stale expectedEpoch prevents acquire without changing the server lease', async () => {
    await seedInitialLease(operatorA.uid, 2, new Date());
    const dbA = authedDb(operatorA.uid, operatorA.email);

    const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 1, operatorA.email);
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
      const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1, operatorB.email);
      expect(result.status).toBe('acquired');
    } finally {
      fakeClock.mockRestore();
    }
  });

  it('A03.4: a client clock cannot change the outcome of a takeover; the server decides', async () => {
    const realNow = Date.now();
    await seedInitialLease(operatorA.uid, 1, new Date(realNow));
    const dbB = authedDb(operatorB.uid, operatorB.email);
    const fakeClock = vi.spyOn(Date, 'now').mockReturnValue(realNow - 10 * 60 * 1000);

    try {
      const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 1, operatorB.email);
      expect(result.status).toBe('acquired');
    } finally {
      fakeClock.mockRestore();
    }
  });

  it('A03.5: Rules reject renew after expiry and leave the server lease unchanged', async () => {
    const expiredAt = new Date(Date.now() - LEASE_DURATION_MS - 90_000);
    await seedInitialLease(operatorA.uid, 1, expiredAt);
    const dbA = authedDb(operatorA.uid, operatorA.email);

    const result = await renewLease(dbA as unknown as Firestore, operatorA.uid, 1);
    expect(result.status).toBe('lost');

    await assertFails(updateDoc(doc(dbA, 'system/accessLease'), {
      holderUid: operatorA.uid,
      epoch: 1,
      updatedAt: serverTimestamp(),
    }));

    const leaseDoc = await getDoc(doc(dbA, 'system/accessLease'));
    expect(leaseDoc.data()?.holderUid).toBe(operatorA.uid);
    expect(leaseDoc.data()?.epoch).toBe(1);
    expect((leaseDoc.data()?.updatedAt as { toDate: () => Date }).toDate().getTime()).toBe(expiredAt.getTime());
  });

  it('A04.5: static Rules contract makes exact equality expired (<= acquire, > renew)', () => {
    expect(rulesSource).toMatch(/resource\.data\.updatedAt\s*\+\s*duration\.value\(5,\s*'m'\)\s*<=\s*request\.time/);
    expect(rulesSource).toMatch(/resource\.data\.updatedAt\s*\+\s*duration\.value\(5,\s*'m'\)\s*>\s*request\.time/);
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
  describe('P13c1: accessEvents are written atomically with every epoch change', () => {
    type EventRow = { id: string; data: Record<string, unknown> };

    async function readEvents(): Promise<EventRow[]> {
      let rows: EventRow[] = [];
      await env.withSecurityRulesDisabled(async context => {
        const snapshot = await getDocs(collection(context.firestore(), 'accessEvents'));
        rows = snapshot.docs.map(row => ({ id: row.id, data: row.data() }));
      });
      return rows.sort((a, b) => Number(a.id) - Number(b.id));
    }

    async function seedEvent(id: string, data: Record<string, unknown> = { kind: 'acquire' }) {
      await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), `accessEvents/${id}`), data);
      });
    }

    function validEvent(overrides: Record<string, unknown> = {}) {
      return {
        kind: 'acquire',
        holderUid: operatorA.uid,
        previousHolderUid: null,
        actorUid: operatorA.uid,
        actorEmail: operatorA.email,
        at: serverTimestamp(),
        ...overrides,
      };
    }

    /** One batch = one atomic commit, so the Rules see the lease change and the event as a single transition. */
    function transition(
      db: ReturnType<typeof authedDb>,
      lease: { holderUid: string | null; epoch: number },
      event?: { id: string; data: Record<string, unknown> },
      extraLease: Record<string, unknown> = {},
    ) {
      const modular = db as unknown as Firestore;
      const batch = writeBatch(modular);
      batch.update(doc(modular, 'system/accessLease'), { ...lease, updatedAt: serverTimestamp(), ...extraLease });
      if (event) batch.set(doc(modular, `accessEvents/${event.id}`), event.data);
      return batch.commit();
    }

    it('E01: acquiring an empty lease writes exactly one acquire event whose id is the new epoch', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);

      const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 0, operatorA.email);
      expect(result.status).toBe('acquired');

      const events = await readEvents();
      expect(events.map(row => row.id)).toEqual(['1']);
      expect(events[0]?.data).toMatchObject({
        kind: 'acquire', holderUid: operatorA.uid, previousHolderUid: null,
        actorUid: operatorA.uid, actorEmail: operatorA.email,
      });
      expect(Object.keys(events[0]?.data ?? {}).sort()).toEqual(
        ['actorEmail', 'actorUid', 'at', 'holderUid', 'kind', 'previousHolderUid'],
      );
      const lease = await getDoc(doc(dbA, 'system/accessLease'));
      expect((events[0]?.data.at as { toMillis: () => number }).toMillis())
        .toBe((lease.data()?.updatedAt as { toMillis: () => number }).toMillis());
    });

    it('E02: taking over an expired lease writes a takeover event naming the previous holder', async () => {
      await seedInitialLease(operatorA.uid, 4, new Date(Date.now() - LEASE_DURATION_MS - 90_000));
      const dbB = authedDb(operatorB.uid, operatorB.email);

      const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 4, operatorB.email);
      expect(result.status).toBe('acquired');

      const events = await readEvents();
      expect(events.map(row => row.id)).toEqual(['5']);
      expect(events[0]?.data).toMatchObject({
        kind: 'takeover', holderUid: operatorB.uid, previousHolderUid: operatorA.uid,
        actorUid: operatorB.uid, actorEmail: operatorB.email,
      });
    });

    it('E03: the same operator re-acquiring after their own lease expired is also a takeover', async () => {
      await seedInitialLease(operatorA.uid, 2, new Date(Date.now() - LEASE_DURATION_MS - 90_000));
      const dbA = authedDb(operatorA.uid, operatorA.email);

      const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 2, operatorA.email);
      expect(result.status).toBe('acquired');
      const events = await readEvents();
      expect(events[0]?.data).toMatchObject({ kind: 'takeover', holderUid: operatorA.uid, previousHolderUid: operatorA.uid });
    });

    it('E04: releasing writes a release event with a null holder', async () => {
      await seedInitialLease(operatorA.uid, 1, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);

      expect(await releaseLease(dbA as unknown as Firestore, operatorA.uid, 1, operatorA.email)).toBe(true);

      const events = await readEvents();
      expect(events.map(row => row.id)).toEqual(['2']);
      expect(events[0]?.data).toMatchObject({
        kind: 'release', holderUid: null, previousHolderUid: operatorA.uid,
        actorUid: operatorA.uid, actorEmail: operatorA.email,
      });
    });

    it('E05: renewing ten times never writes an event', async () => {
      await seedInitialLease(operatorA.uid, 1, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);

      for (let index = 0; index < 10; index += 1) {
        const result = await renewLease(dbA as unknown as Firestore, operatorA.uid, 1);
        expect(result.status).toBe('acquired');
      }
      expect(await readEvents()).toEqual([]);
    });

    it('E06: a full acquire, takeover and release history keeps one event per epoch', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      const dbB = authedDb(operatorB.uid, operatorB.email);

      expect((await acquireLease(dbA as unknown as Firestore, operatorA.uid, 0, operatorA.email)).status).toBe('acquired');
      expect(await releaseLease(dbA as unknown as Firestore, operatorA.uid, 1, operatorA.email)).toBe(true);
      expect((await acquireLease(dbB as unknown as Firestore, operatorB.uid, 2, operatorB.email)).status).toBe('acquired');

      const events = await readEvents();
      expect(events.map(row => [row.id, row.data.kind])).toEqual([['1', 'acquire'], ['2', 'release'], ['3', 'acquire']]);
    });

    it('E07: positive control, a hand-written lease change plus a well-formed event commits', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      await assertSucceeds(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }, { id: '1', data: validEvent() }));
    });

    it('E08: an epoch change without its event is rejected for acquire and for release', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }));

      await seedInitialLease(operatorA.uid, 1, new Date());
      await assertFails(transition(dbA, { holderUid: null, epoch: 2 }));
    });

    it('E09: an event on its own, with no lease transition, is rejected', async () => {
      await seedInitialLease(operatorA.uid, 1, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);
      await assertFails(setDoc(doc(dbA, 'accessEvents/2'), validEvent({ kind: 'release', holderUid: null, previousHolderUid: operatorA.uid })));
      await assertFails(setDoc(doc(dbA, 'accessEvents/1'), validEvent()));
    });

    it('E10: the event id must be the new epoch', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      for (const id of ['0', '2', '01', 'x']) {
        await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }, { id, data: validEvent() }));
      }
    });

    it('E11: the kind must follow from the lease before and after', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      for (const kind of ['takeover', 'release', 'renew', 'other']) {
        await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }, { id: '1', data: validEvent({ kind }) }));
      }

      await seedInitialLease(operatorA.uid, 1, new Date(Date.now() - LEASE_DURATION_MS - 90_000));
      const dbB = authedDb(operatorB.uid, operatorB.email);
      const takeover = (kind: string) => validEvent({
        kind, holderUid: operatorB.uid, previousHolderUid: operatorA.uid, actorUid: operatorB.uid, actorEmail: operatorB.email,
      });
      await assertFails(transition(dbB, { holderUid: operatorB.uid, epoch: 2 }, { id: '2', data: takeover('acquire') }));
      await assertSucceeds(transition(dbB, { holderUid: operatorB.uid, epoch: 2 }, { id: '2', data: takeover('takeover') }));
    });

    it('E12: forged actor, holder, previous holder, time or extra fields are rejected', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      const forged: Array<Record<string, unknown>> = [
        { actorUid: operatorB.uid },
        { actorEmail: operatorB.email },
        { holderUid: operatorB.uid },
        { previousHolderUid: operatorB.uid },
        { at: new Date() },
        { extra: 'not-allowed' },
      ];
      for (const overrides of forged) {
        await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }, { id: '1', data: validEvent(overrides) }));
      }
      const withoutAt: Record<string, unknown> = { ...validEvent() };
      delete withoutAt.at;
      await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }, { id: '1', data: withoutAt }));
    });

    it('E13: a renew cannot carry an event', async () => {
      await seedInitialLease(operatorA.uid, 1, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);
      for (const id of ['1', '2']) {
        await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }, { id, data: validEvent({ previousHolderUid: operatorA.uid }) }));
      }
      expect(await readEvents()).toEqual([]);
    });

    it('E14: an existing event can neither be updated nor deleted', async () => {
      await seedInitialLease(null, 0);
      const dbA = authedDb(operatorA.uid, operatorA.email);
      expect((await acquireLease(dbA as unknown as Firestore, operatorA.uid, 0, operatorA.email)).status).toBe('acquired');

      await assertFails(updateDoc(doc(dbA, 'accessEvents/1'), { actorEmail: operatorB.email }));
      await assertFails(setDoc(doc(dbA, 'accessEvents/1'), validEvent()));
      await assertFails(deleteDoc(doc(dbA, 'accessEvents/1')));
      expect((await readEvents())[0]?.data.actorEmail).toBe(operatorA.email);
    });

    it('E15: only approved operators can read events', async () => {
      await seedInitialLease(null, 0);
      await seedEvent('1', validEvent({ at: new Date() }));
      const dbA = authedDb(operatorA.uid, operatorA.email);
      const dbInactive = authedDb(inactiveOperator.uid, inactiveOperator.email);
      const dbPassword = authedDb(operatorA.uid, operatorA.email, { signInProvider: 'password' });
      const unauthenticated = env.unauthenticatedContext().firestore();

      await assertSucceeds(getDoc(doc(dbA, 'accessEvents/1')));
      await assertSucceeds(getDocs(query(collection(dbA, 'accessEvents'), limit(500))));
      for (const db of [dbInactive, dbPassword, unauthenticated]) {
        await assertFails(getDoc(doc(db, 'accessEvents/1')));
        await assertFails(getDocs(query(collection(db, 'accessEvents'), limit(500))));
      }
    });

    it('E16: a leftover event at the next epoch blocks the acquire and is never overwritten (fail closed)', async () => {
      await seedInitialLease(null, 0);
      await seedEvent('1', { kind: 'acquire', marker: 'earlier history' });
      const dbA = authedDb(operatorA.uid, operatorA.email);

      const result = await acquireLease(dbA as unknown as Firestore, operatorA.uid, 0, operatorA.email);
      expect(result.status).not.toBe('acquired');

      const lease = await getDoc(doc(dbA, 'system/accessLease'));
      expect(lease.data()?.holderUid).toBeNull();
      expect(lease.data()?.epoch).toBe(0);
      expect((await readEvents())[0]?.data.marker).toBe('earlier history');
    });

    it('E17: a stale event at the next epoch cannot stand in for a missing one on a raw lease-only change', async () => {
      const dbA = authedDb(operatorA.uid, operatorA.email);

      // The event already exists before the commit, so `existsAfter` alone would be true without this commit writing anything.
      await seedInitialLease(null, 0);
      await seedEvent('1', { kind: 'acquire', marker: 'earlier history' });
      await assertFails(transition(dbA, { holderUid: operatorA.uid, epoch: 1 }));

      await seedInitialLease(operatorA.uid, 4, new Date());
      await seedEvent('5', { kind: 'release', marker: 'earlier history' });
      await assertFails(transition(dbA, { holderUid: null, epoch: 5 }));

      // Writing a fresh well-formed event over the stale one is an update of an existing document, which is denied too.
      await assertFails(transition(dbA, { holderUid: null, epoch: 5 }, {
        id: '5', data: validEvent({ kind: 'release', holderUid: null, previousHolderUid: operatorA.uid }),
      }));

      const lease = await getDoc(doc(dbA, 'system/accessLease'));
      expect(lease.data()?.holderUid).toBe(operatorA.uid);
      expect(lease.data()?.epoch).toBe(4);
      const events = await readEvents();
      expect(events.map(row => row.id)).toEqual(['1', '5']);
      expect(events.map(row => row.data.marker)).toEqual(['earlier history', 'earlier history']);
    });
  });

  describe('P7 #691: an approved operator can take over a live lease after explicit confirmation', () => {
    const rawTakeover = (db: ReturnType<typeof authedDb>, newHolder: string, epoch: number, event: Record<string, unknown> | null) => {
      const modular = db as unknown as Firestore;
      const batch = writeBatch(modular);
      batch.update(doc(modular, 'system/accessLease'), { holderUid: newHolder, epoch, updatedAt: serverTimestamp() });
      if (event) batch.set(doc(modular, `accessEvents/${epoch}`), event);
      return batch.commit();
    };
    const takeoverEvent = (overrides: Record<string, unknown> = {}) => ({
      kind: 'takeover',
      holderUid: operatorB.uid,
      previousHolderUid: operatorA.uid,
      actorUid: operatorB.uid,
      actorEmail: operatorB.email,
      at: serverTimestamp(),
      ...overrides,
    });

    it('T01: takeover of a live lease commits with epoch +1 and a takeover event naming the taker email and previous holder', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const dbB = authedDb(operatorB.uid, operatorB.email);

      const result = await acquireLease(dbB as unknown as Firestore, operatorB.uid, 3, operatorB.email);
      expect(result.status).toBe('acquired');

      const lease = await getDoc(doc(dbB, 'system/accessLease'));
      expect(lease.data()?.holderUid).toBe(operatorB.uid);
      expect(lease.data()?.epoch).toBe(4);

      // The taker (and any approved operator) can read the event: it is how the screens name who is in.
      const event = await getDoc(doc(dbB, 'accessEvents/4'));
      expect(event.data()).toMatchObject({
        kind: 'takeover', holderUid: operatorB.uid, previousHolderUid: operatorA.uid,
        actorUid: operatorB.uid, actorEmail: operatorB.email,
      });
    });

    it('T01b: readLeaseTakerEmail returns the actor email of the current epoch for the holder it was asked about, else null', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);
      const dbB = authedDb(operatorB.uid, operatorB.email);
      expect((await acquireLease(dbB as unknown as Firestore, operatorB.uid, 3, operatorB.email)).status).toBe('acquired');

      // Both the taker and the displaced holder (still an approved operator) can read it.
      expect(await readLeaseTakerEmail(dbA as unknown as Firestore, 4, operatorB.uid)).toBe(operatorB.email);
      expect(await readLeaseTakerEmail(dbB as unknown as Firestore, 4, operatorB.uid)).toBe(operatorB.email);
      // A record whose holder differs from the lease holder is not trusted, and a missing record reads as unknown.
      expect(await readLeaseTakerEmail(dbA as unknown as Firestore, 4, operatorA.uid)).toBeNull();
      expect(await readLeaseTakerEmail(dbA as unknown as Firestore, 99, operatorB.uid)).toBeNull();
      // Not an approved operator: the read is denied by Rules and reported as unknown, never thrown.
      const stranger = authedDb('uid-stranger', 'stranger@example.com');
      expect(await readLeaseTakerEmail(stranger as unknown as Firestore, 4, operatorB.uid)).toBeNull();
    });

    it('T02: after the takeover the old holder is rejected on renew, release, lease overwrite and a stale-epoch command', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);
      const dbB = authedDb(operatorB.uid, operatorB.email);
      expect((await acquireLease(dbB as unknown as Firestore, operatorB.uid, 3, operatorB.email)).status).toBe('acquired');

      expect((await renewLease(dbA as unknown as Firestore, operatorA.uid, 4)).status).toBe('lost');
      expect(await releaseLease(dbA as unknown as Firestore, operatorA.uid, 4, operatorA.email)).toBe(false);
      await assertFails(updateDoc(doc(dbA, 'system/accessLease'), {
        holderUid: operatorA.uid, epoch: 4, updatedAt: serverTimestamp(),
      }));
      await assertFails(updateDoc(doc(dbA, 'system/accessLease'), {
        holderUid: null, epoch: 5, updatedAt: serverTimestamp(),
      }));

      // Business read/command paths all require holderUid == caller; the old holder is no longer it.
      await assertFails(getDoc(doc(dbA, 'students/stu-1')));
      await assertFails(getDocs(query(collection(dbA, 'commands'), limit(1))));
      await assertFails(setDoc(doc(dbA, 'commands/cmd-stale-epoch'), {
        commandId: 'cmd-stale-epoch', leaseEpoch: 3, kind: 'CreateOrder',
      }));

      const lease = await getDoc(doc(dbB, 'system/accessLease'));
      expect(lease.data()?.holderUid).toBe(operatorB.uid);
      expect(lease.data()?.epoch).toBe(4);
    });

    it('T03: a non-whitelisted or inactive account cannot take over a live lease', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const stranger = authedDb('uid-stranger', 'stranger@example.com');
      const dbInactive = authedDb(inactiveOperator.uid, inactiveOperator.email);

      expect((await acquireLease(stranger as unknown as Firestore, 'uid-stranger', 3, 'stranger@example.com')).status).toBe('lost');
      expect((await acquireLease(dbInactive as unknown as Firestore, inactiveOperator.uid, 3, inactiveOperator.email)).status).toBe('lost');
      await assertFails(rawTakeover(stranger, 'uid-stranger', 4, takeoverEvent({
        holderUid: 'uid-stranger', actorUid: 'uid-stranger', actorEmail: 'stranger@example.com',
      })));

      const lease = await getDoc(doc(authedDb(operatorA.uid, operatorA.email), 'system/accessLease'));
      expect(lease.data()?.holderUid).toBe(operatorA.uid);
      expect(lease.data()?.epoch).toBe(3);
    });

    it('T04: the same UID cannot start a new epoch while its own lease is still valid (another tab keeps renewing, never re-acquiring)', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const dbA = authedDb(operatorA.uid, operatorA.email);

      expect((await acquireLease(dbA as unknown as Firestore, operatorA.uid, 3, operatorA.email)).status).not.toBe('acquired');
      await assertFails(rawTakeover(dbA, operatorA.uid, 4, takeoverEvent({
        holderUid: operatorA.uid, previousHolderUid: operatorA.uid, actorUid: operatorA.uid, actorEmail: operatorA.email,
      })));

      const lease = await getDoc(doc(dbA, 'system/accessLease'));
      expect(lease.data()?.holderUid).toBe(operatorA.uid);
      expect(lease.data()?.epoch).toBe(3);
    });

    it('T05: a takeover without its accessEvents record is rejected (P13c1 binding unchanged)', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const dbB = authedDb(operatorB.uid, operatorB.email);
      await assertFails(rawTakeover(dbB, operatorB.uid, 4, null));
      await assertFails(rawTakeover(dbB, operatorB.uid, 4, takeoverEvent({ kind: 'acquire' })));
      await assertFails(rawTakeover(dbB, operatorB.uid, 4, takeoverEvent({ actorEmail: operatorA.email })));
      await assertSucceeds(rawTakeover(dbB, operatorB.uid, 4, takeoverEvent()));
    });

    it('T06: a takeover cannot skip an epoch, hand the lease to someone else, or smuggle a null holder', async () => {
      await seedInitialLease(operatorA.uid, 3, new Date());
      const dbB = authedDb(operatorB.uid, operatorB.email);
      await assertFails(rawTakeover(dbB, operatorB.uid, 5, takeoverEvent()));
      await assertFails(rawTakeover(dbB, operatorA.uid, 4, takeoverEvent({ holderUid: operatorA.uid })));
      await assertFails(updateDoc(doc(dbB, 'system/accessLease'), {
        holderUid: operatorB.uid, epoch: 4, updatedAt: new Date(),
      }));
    });

    it('T07: static Rules contract keeps the 5-minute expiry only for the same UID (acquire branch compares holderUid with the caller)', () => {
      expect(rulesSource).toMatch(/resource\.data\.holderUid\s*!=\s*request\.auth\.uid\s*\|\|\s*resource\.data\.updatedAt\s*\+\s*duration\.value\(5,\s*'m'\)\s*<=\s*request\.time/);
    });
  });
});
