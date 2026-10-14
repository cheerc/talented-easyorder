// P04 Cloud Authentication & Access Lease acceptance against Auth + Firestore Emulators.

import { test, expect, E2E_BASE_URL, openGoogleSession, signInGoogle } from './fixtures';
import {
  E2E_IDENTITIES,
  createPasswordEmulatorUserForRulesDenial,
  decodeFirebaseIdTokenClaims,
} from './helpers/auth';
import {
  readAccessLease,
  readLeaseWithIdToken,
  seedAccessLease,
  seedOperator,
  setOperatorActive,
} from './helpers/seed';

const VACANT_LEASE = { holderUid: null, epoch: 0, updatedAt: new Date() };

test.describe('P04 Cloud Authentication & Access Lease', () => {
  test.setTimeout(60000);

  test.beforeEach(async () => {
    // Each case starts from a known server document in the isolated demo project.
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test.afterEach(async () => {
    // Test-only Admin REST cleanup; never treated as application release behavior.
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test('A01: signed-out users see Google login', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
  });

  test('A02: idle lease remains vacant until an approved Google operator explicitly acquires it', async ({ googleSession }) => {
    const { page, uid, providerIds } = googleSession;
    expect(providerIds).toContain('google.com');
    await expect(page.getByRole('button', { name: '取得系統使用權' })).toBeVisible();
    await expect(page.locator('.operator-strip')).toHaveCount(0);
    await expect.poll(readAccessLease).toMatchObject({ holderUid: null, epoch: 0 });

    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toBeVisible();
    await expect.poll(readAccessLease).toMatchObject({ holderUid: uid, epoch: 1 });
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
  });

  test('A03: two operators contend on the server, 15-second recheck limit holds, then B explicitly acquires after A releases', async ({ browser }) => {
    const operatorA = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    const operatorB = await openGoogleSession(browser, E2E_IDENTITIES.operatorB.email);

    try {
      const acquireA = operatorA.page.getByRole('button', { name: '取得系統使用權' });
      await expect(acquireA).toBeVisible();
      await acquireA.click();
      await expect(operatorA.page.locator('.operator-strip')).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      await expect(operatorB.page.locator('.auth-gate-busy')).toBeVisible();
      await expect(operatorB.page.locator('.operator-strip')).toHaveCount(0);
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      const recheckB = operatorB.page.getByRole('button', { name: '重新檢查' });
      await recheckB.click();
      await expect(operatorB.page.getByText(new RegExp(`目前(仍)?由操作員 ${operatorA.uid} 使用中`))).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      await recheckB.click();
      await expect(operatorB.page.getByText(/檢查過於頻繁/)).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      await operatorA.page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: null, epoch: 2 });
      await expect(operatorB.page.getByRole('button', { name: '取得系統使用權' })).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: null, epoch: 2 });
      await expect(operatorB.page.locator('.operator-strip')).toHaveCount(0);

      await operatorB.page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(operatorB.page.locator('.operator-strip')).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorB.uid, epoch: 3 });
    } finally {
      await operatorA.close();
      await operatorB.close();
    }
  });

  test('A04: releasing from one same-UID page leaves the other page masked without auto-acquiring', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    try {
      const sessionA = await signInGoogle(pageA, E2E_IDENTITIES.operatorA.email);
      await pageA.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(pageA.locator('.operator-strip')).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });

      const sessionB = await signInGoogle(pageB, E2E_IDENTITIES.operatorA.email);
      expect(sessionB.uid).toBe(sessionA.uid);
      await expect(pageB.locator('.operator-strip')).toBeVisible();

      await pageA.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: null, epoch: 2 });
      await expect(pageB.locator('.operator-strip')).toHaveCount(0);
      await expect(pageB.locator('.auth-gate')).toBeVisible();
      await pageB.waitForTimeout(500);
      await expect.poll(readAccessLease).toMatchObject({ holderUid: null, epoch: 2 });
      await expect(pageB.locator('.operator-strip')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('A05: a fast client clock cannot acquire early; a slow clock cannot block server-expired handoff after the holder closes the tab', async ({ browser }) => {
    const operatorA = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    const operatorB = await openGoogleSession(browser, E2E_IDENTITIES.operatorB.email);

    try {
      await operatorA.page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(operatorA.page.locator('.operator-strip')).toBeVisible();
      const activeLease = await readAccessLease();
      expect(activeLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      await operatorB.page.clock.setFixedTime(new Date(Date.now() + 10 * 60 * 1000));
      await operatorB.page.reload();
      await expect(operatorB.page.locator('.auth-gate-busy, .auth-gate-acquire')).toBeVisible();
      const fastClockAction = operatorB.page.getByRole('button', { name: /取得系統使用權|重新檢查|重新確認使用權/ });
      await expect(fastClockAction).toBeVisible();
      await fastClockAction.click();
      await expect(operatorB.page.locator('.operator-strip')).toHaveCount(0);
      await expect(operatorB.page.locator('.auth-gate')).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      // Closing the actual holder tab does not release its server lease.
      await operatorA.close();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      // Admin REST simulates a lease whose server timestamp is six minutes old.
      await seedAccessLease({
        holderUid: operatorA.uid,
        epoch: 1,
        updatedAt: new Date(Date.now() - 6 * 60 * 1000),
      });
      await operatorB.page.clock.setFixedTime(new Date(Date.now() - 10 * 60 * 1000));
      await operatorB.page.reload();
      await expect(operatorB.page.locator('.auth-gate-busy, .auth-gate-acquire')).toBeVisible();
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operatorA.uid, epoch: 1 });

      const slowClockAction = operatorB.page.getByRole('button', { name: /取得系統使用權|重新檢查|重新確認使用權/ });
      await slowClockAction.click();
      await expect(operatorB.page.locator('.operator-strip')).toBeVisible();
      const handedOffLease = await readAccessLease();
      expect(handedOffLease.holderUid).toBe(operatorB.uid);
      expect(handedOffLease.epoch).toBe(2);
      expect(handedOffLease.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60 * 1000);
    } finally {
      await operatorA.close();
      await operatorB.close();
    }
  });

  test('A06: deactivating the current operator masks the app while the server holder remains unchanged', async ({ browser }) => {
    const operator = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      await operator.page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(operator.page.locator('.operator-strip')).toBeVisible();
      const heldLease = await readAccessLease();
      expect(heldLease).toMatchObject({ holderUid: operator.uid, epoch: 1 });

      await setOperatorActive(operator.uid, false);
      await expect(operator.page.locator('.auth-gate-inactive')).toBeVisible();
      await expect(operator.page.locator('.operator-strip')).toHaveCount(0);
      await expect.poll(readAccessLease).toMatchObject({ holderUid: operator.uid, epoch: 1 });
    } finally {
      await setOperatorActive(operator.uid, true);
      await operator.close();
    }
  });

  test('A07: the legacy test email cannot read the lease with password-provider credentials', async () => {
    const legacyEmail = 'test@talented.com.tw';
    const passwordUser = await createPasswordEmulatorUserForRulesDenial(legacyEmail, 'e2e-negative-only');
    await seedOperator(passwordUser.localId, legacyEmail, 'admin');
    const claims = decodeFirebaseIdTokenClaims(passwordUser.idToken);
    expect(claims.email_verified).toBe(true);
    expect((claims.firebase as Record<string, unknown> | undefined)?.sign_in_provider).toBe('password');

    const response = await readLeaseWithIdToken(passwordUser.idToken);
    const body = await response.text();
    expect(response.status, body).toBe(403);
    await expect.poll(readAccessLease).toMatchObject({ holderUid: null, epoch: 0 });
  });

  test('A08: same-UID pages preserve confirmed access across leader and follower heartbeats', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const heartbeatLockName = 'easyorder:system-access-lease-heartbeat';
    const initialClock = new Date();

    const heartbeatLockCounts = async (page: typeof pageA) => page.evaluate(async lockName => {
      const { held = [], pending = [] } = await navigator.locks.query();
      return {
        held: held.filter(lock => lock.name === lockName).length,
        pending: pending.filter(lock => lock.name === lockName).length,
      };
    }, heartbeatLockName);

    try {
      // Freeze only browser clocks. Firestore Emulator server time remains authoritative.
      await pageA.clock.install({ time: initialClock });
      await pageB.clock.install({ time: initialClock });

      const sessionA = await signInGoogle(pageA, E2E_IDENTITIES.operatorA.email);
      await pageA.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(pageA.locator('.operator-strip')).toBeVisible();
      await expect(pageA.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect.poll(readAccessLease).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });
      // Wait for A's real heartbeat request to hold the origin-wide Web Lock before B signs in.
      await expect.poll(() => heartbeatLockCounts(pageA)).toEqual({ held: 1, pending: 0 });

      const sessionB = await signInGoogle(pageB, E2E_IDENTITIES.operatorA.email);
      expect(sessionB.uid).toBe(sessionA.uid);
      // B's initial server-authorized renew probe confirms the existing same-UID lease.
      await expect(pageB.locator('.operator-strip')).toBeVisible();
      await expect(pageB.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect.poll(readAccessLease).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });
      // The native lock query is supporting evidence: A holds it while B is queued.
      await expect.poll(() => heartbeatLockCounts(pageA)).toEqual({ held: 1, pending: 1 });

      const beforeLeaderHeartbeat = await readAccessLease();
      expect(beforeLeaderHeartbeat).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });
      await pageA.clock.runFor(60_001);
      await expect.poll(async () => (await readAccessLease()).updatedAt.getTime()).toBeGreaterThan(
        beforeLeaderHeartbeat.updatedAt.getTime(),
      );
      await expect(pageA.locator('.operator-strip')).toBeVisible();
      await expect(pageA.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(pageB.locator('.operator-strip')).toBeVisible();
      await expect(pageB.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect.poll(readAccessLease).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });

      // Closing the leader releases its Web Lock without releasing the server lease.
      await pageA.close();
      await expect.poll(() => heartbeatLockCounts(pageB)).toEqual({ held: 1, pending: 0 });
      await expect(pageB.locator('.operator-strip')).toBeVisible();
      await expect(pageB.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      const beforeFollowerHeartbeat = await readAccessLease();
      expect(beforeFollowerHeartbeat).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });

      await pageB.clock.runFor(60_001);
      await expect.poll(async () => (await readAccessLease()).updatedAt.getTime()).toBeGreaterThan(
        beforeFollowerHeartbeat.updatedAt.getTime(),
      );
      await expect(pageB.locator('.operator-strip')).toBeVisible();
      await expect(pageB.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect.poll(readAccessLease).toMatchObject({ holderUid: sessionA.uid, epoch: 1 });
    } finally {
      await context.close();
    }
  });
});
