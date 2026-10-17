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
  PROJECT,
} from './helpers/seed';

const VACANT_LEASE = { holderUid: null, epoch: 0, updatedAt: new Date() };
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';

type AdminDocument = Record<string, unknown> & { id: string };

function decodeAdminValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if ('stringValue' in raw) return raw.stringValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return raw.doubleValue;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('nullValue' in raw) return null;
  if ('timestampValue' in raw) return new Date(String(raw.timestampValue));
  if ('mapValue' in raw) {
    const fields = (raw.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    return decodeAdminFields(fields);
  }
  if ('arrayValue' in raw) {
    const values = (raw.arrayValue as { values?: unknown[] } | undefined)?.values ?? [];
    return values.map(decodeAdminValue);
  }
  return undefined;
}

function decodeAdminFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeAdminValue(value)]));
}

async function readAdminDocument(collection: string, documentId: string): Promise<AdminDocument | null> {
  const response = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(documentId)}`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to read Emulator ${collection}/${documentId}: ${await response.text()}`);
  const body = await response.json() as { name?: string; fields?: Record<string, unknown> };
  const id = body.name?.split('/').at(-1);
  if (!id) throw new Error(`Emulator returned an invalid document path for ${collection}/${documentId}`);
  return { id, ...decodeAdminFields(body.fields ?? {}) };
}

async function listAdminDocuments(collection: string): Promise<AdminDocument[]> {
  const documents: AdminDocument[] = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '100' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetch(
      `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?${query}`,
      { headers: { Authorization: 'Bearer owner' } },
    );
    if (!response.ok) throw new Error(`Failed to list Emulator ${collection}: ${await response.text()}`);
    const body = await response.json() as { documents?: Array<{ name?: string; fields?: Record<string, unknown> }>; nextPageToken?: string };
    for (const document of body.documents ?? []) {
      const id = document.name?.split('/').at(-1);
      if (!id) throw new Error(`Emulator returned an invalid ${collection} document path`);
      documents.push({ id, ...decodeAdminFields(document.fields ?? {}) });
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return documents;
}

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

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

  test('A09: an authenticated lease holder sees the P06 student surface without mounting POS controls', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toBeVisible();
    await expect.poll(readAccessLease).toMatchObject({ holderUid: uid, epoch: 1 });

    await expect(page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();
    await expect(page.locator('.app')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /訂餐|繳費|送出訂單/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '釋放使用權並登出' })).toBeVisible();
  });
});

test.describe('P06 Cloud Students', () => {
  test.setTimeout(120000);

  test.beforeEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test.afterEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test('D01: manually creates, edits, deactivates, restores and reloads three students from an empty server dataset', async ({ browser }) => {
    const startingHead = await readAdminDocument('system', 'dataHead');
    expect(startingHead).toMatchObject({ seq: 0, maintenance: false, goLiveDate: taipeiToday() });
    expect(await listAdminDocuments('students')).toEqual([]);

    const first = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      await first.page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(first.page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(first.page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();
      await expect(first.page.getByText('目前伺服器名單是空的，請手動新增學生。')).toBeVisible();

      const createStudent = async (input: { id: string; name: string; aliases: string; amount: string; mode: '沿用既有核對結餘' | '建立新學生' }) => {
        const page = first.page;
        await page.getByRole('button', { name: '新增學生' }).click();
        const form = page.getByRole('form', { name: '新增學生' });
        await form.getByLabel('學員編號').fill(input.id);
        await form.getByRole('textbox', { name: '姓名', exact: true }).fill(input.name);
        await form.getByRole('textbox', { name: /別名（逗號、頓號/ }).fill(input.aliases);
        await form.getByRole('textbox', { name: /期初結餘（整數/ }).fill(input.amount);
        await form.getByRole('radio', { name: new RegExp(input.mode) }).check();
        await form.getByRole('button', { name: '建立學生' }).click();
        await expect(page.getByTestId(`cloud-student-row-${input.id}`)).toBeVisible();
        await expect(page.getByText(new RegExp(`已確認 新增 ${input.id} 完成`))).toBeVisible();
      };

      await createStudent({ id: '001', name: 'P06 同名學生', aliases: '一號', amount: '0', mode: '沿用既有核對結餘' });
      await createStudent({ id: '002', name: 'P06 同名學生', aliases: '二號', amount: '-25', mode: '建立新學生' });
      await createStudent({ id: '003', name: 'P06 第三位', aliases: '', amount: '140', mode: '沿用既有核對結餘' });

      // The component rejects the duplicate ID before dispatch; the authoritative server head stays unchanged.
      await first.page.getByRole('button', { name: '新增學生' }).click();
      const duplicateForm = first.page.getByRole('form', { name: '新增學生' });
      await duplicateForm.getByLabel('學員編號').fill('001');
      await duplicateForm.getByRole('textbox', { name: '姓名', exact: true }).fill('重複編號');
      await duplicateForm.getByRole('textbox', { name: /期初結餘（整數/ }).fill('0');
      await duplicateForm.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await duplicateForm.getByRole('button', { name: '建立學生' }).click();
      await expect(first.page.getByRole('alert')).toContainText('學員編號 001 已存在');
      expect(await readAdminDocument('system', 'dataHead')).toMatchObject({ seq: 3 });
      await first.page.getByRole('button', { name: '取消' }).click();

      const row002 = first.page.getByTestId('cloud-student-row-002');
      await row002.getByRole('button', { name: '編輯姓名與別名' }).click();
      const editForm = row002.getByRole('form', { name: '編輯學生 002' });
      await editForm.getByLabel('姓名').fill('P06 已修改學生');
      await editForm.getByLabel('別名').fill('改名別名');
      await editForm.getByRole('button', { name: '儲存姓名與別名' }).click();
      await expect(first.page.getByText(/已確認 修改 002 完成/)).toBeVisible();
      await expect(row002).toContainText('P06 已修改學生');

      await row002.getByRole('button', { name: '停用' }).click();
      const deactivateForm = row002.getByRole('form', { name: '停用學生 002' });
      await deactivateForm.getByLabel('原因（必填）').fill('操作員確認資料後暫時停用此學生');
      await deactivateForm.getByRole('button', { name: '確認停用' }).click();
      await expect(row002).toContainText('已停用');

      await row002.getByRole('button', { name: '恢復' }).click();
      const restoreForm = row002.getByRole('form', { name: '恢復學生 002' });
      await restoreForm.getByLabel('原因（必填）').fill('已完成確認，恢復學生使用狀態');
      await restoreForm.getByRole('button', { name: '確認恢復' }).click();
      await expect(row002).toContainText('使用中');

      const head = await readAdminDocument('system', 'dataHead');
      expect(head).toMatchObject({ seq: 6, maintenance: false });
      const students = await listAdminDocuments('students');
      expect(students).toHaveLength(3);
      const byCode = new Map(students.map(student => [student.studentCode, student]));
      expect(byCode.get('001')).toMatchObject({ studentCode: '001', displayName: 'P06 同名學生', currentBalance: 0 });
      expect(byCode.get('002')).toMatchObject({
        studentCode: '002', displayName: 'P06 已修改學生', aliases: ['改名別名'], status: 'active', currentBalance: -25,
        openingBalance: { amount: -25, asOfDate: taipeiToday() },
      });
      expect(byCode.get('003')).toMatchObject({ studentCode: '003', currentBalance: 140 });
      for (const s of students) {
        expect(s.studentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      }
      const studentCodes = await listAdminDocuments('studentCodes');
      expect(studentCodes).toHaveLength(3);
      const codeMap = new Map(studentCodes.map(c => [c.id, c]));
      expect(codeMap.get('001')).toMatchObject({ studentId: byCode.get('001')!.studentId });
      expect(codeMap.get('002')).toMatchObject({ studentId: byCode.get('002')!.studentId });
      expect(codeMap.get('003')).toMatchObject({ studentId: byCode.get('003')!.studentId });
      expect(await listAdminDocuments('transactions')).toEqual([]);

      const commands = await listAdminDocuments('commands');
      expect(commands).toHaveLength(6);
      expect(commands.map(command => command.seq).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2, 3, 4, 5, 6]);
      expect(commands.map(command => command.kind).sort()).toEqual([
        'CreateStudent', 'CreateStudent', 'CreateStudent', 'EditStudent', 'SetStudentStatus', 'SetStudentStatus',
      ].sort());
      expect(commands.filter(command => String(command.kind).includes('Student')).every(command => command.businessDate === null)).toBe(true);

      await first.page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(first.page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();

      const second = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
      try {
        await second.page.getByRole('button', { name: '取得系統使用權' }).click();
        await expect(second.page.locator('.operator-strip')).toBeVisible();
        await expect(second.page.getByTestId('cloud-student-row-001')).toContainText('001');
        await expect(second.page.getByTestId('cloud-student-row-002')).toContainText('P06 已修改學生');
        await expect(second.page.getByTestId('cloud-student-row-002')).toContainText('使用中');
        await expect(second.page.getByTestId('cloud-student-row-003')).toContainText('003');
        await expect(second.page.locator('.app')).toHaveCount(0);
        await expect(second.page.getByRole('tab')).toHaveCount(0);
        await expect(second.page.getByRole('button', { name: /訂餐|繳費|送出訂單/ })).toHaveCount(0);

        // --- P06b: 改號 -> 重載 / 缺號列預填 / 搜尋隱藏缺號 / 搶號衝突 / 停用改號 ---
        const page = second.page;
        const row002 = page.getByTestId('cloud-student-row-002');
        await row002.getByRole('button', { name: '改編號' }).click();
        const codeForm002 = row002.getByRole('form', { name: '改編號 002' });
        await codeForm002.getByLabel('新編號').fill('015');
        await codeForm002.getByLabel('改號原因（必填）').fill('調班改號至十五號');
        await codeForm002.getByRole('button', { name: '確認改號' }).click();
        await expect(page.getByText(/已確認 改編號 002 → 015 完成/)).toBeVisible();
        await expect(page.getByTestId('cloud-student-row-015')).toBeVisible();
        await expect(page.getByTestId('cloud-student-row-002')).toHaveCount(0);

        // 重載驗證持久化
        await page.reload();
        await expect(page.getByTestId('cloud-student-row-015')).toBeVisible();
        await expect(page.getByTestId('cloud-student-row-002')).toHaveCount(0);

        // 缺號列驗證：目前有 001, 003, 015。002 釋出後成為空號，004–014 為連續空號
        await expect(page.getByTestId('cloud-student-gap-002')).toContainText('002 尚無人使用');
        const gap004 = page.getByTestId('cloud-student-gap-004');
        await expect(gap004).toContainText('004–014 尚無人使用（11 個號碼）');

        // 點擊缺號列預填新增
        await gap004.click();
        const createForm = page.getByRole('form', { name: '新增學生' });
        await expect(createForm.getByLabel('學員編號')).toHaveValue('004');
        await createForm.getByRole('button', { name: '取消' }).click();

        // 搜尋時隱藏缺號列
        await page.getByLabel('搜尋編號、姓名或別名').fill('修改學生');
        await expect(page.getByTestId('cloud-student-gap-002')).toHaveCount(0);
        await expect(page.getByTestId('cloud-student-gap-004')).toHaveCount(0);
        await expect(page.getByTestId('cloud-student-row-015')).toBeVisible();
        await page.getByLabel('搜尋編號、姓名或別名').fill('');
        await expect(page.getByTestId('cloud-student-gap-002')).toBeVisible();

        // 搶號衝突 UI 提示：015 嘗試改為已佔用的 001
        const row015 = page.getByTestId('cloud-student-row-015');
        await row015.getByRole('button', { name: '改編號' }).click();
        const codeForm015 = row015.getByRole('form', { name: '改編號 015' });
        await codeForm015.getByLabel('新編號').fill('001');
        await codeForm015.getByLabel('改號原因（必填）').fill('嘗試搶號');
        await codeForm015.getByRole('button', { name: '確認改號' }).click();
        await expect(page.getByRole('alert')).toContainText('編號 001 已經有人使用');
        await codeForm015.getByRole('button', { name: '取消' }).click();

        // 停用學生改號釋出號碼：停用 001，並將其編號改為 099
        const row001 = page.getByTestId('cloud-student-row-001');
        await row001.getByRole('button', { name: '停用' }).click();
        const statusForm001 = row001.getByRole('form', { name: '停用學生 001' });
        await statusForm001.getByLabel('原因（必填）').fill('停用讓號');
        await statusForm001.getByRole('button', { name: '確認停用' }).click();
        await expect(row001).toContainText('已停用');

        await row001.getByRole('button', { name: '改編號' }).click();
        const codeForm001 = row001.getByRole('form', { name: '改編號 001' });
        await codeForm001.getByLabel('新編號').fill('099');
        await codeForm001.getByLabel('改號原因（必填）').fill('停用學生退讓號碼');
        await codeForm001.getByRole('button', { name: '確認改號' }).click();
        await expect(page.getByText(/已確認 改編號 001 → 099 完成/)).toBeVisible();
        await expect(page.getByTestId('cloud-student-row-099')).toContainText('已停用');
        await expect(page.getByTestId('cloud-student-row-001')).toHaveCount(0);

        // 釋出的 001 立即供新學生建檔
        await page.getByRole('button', { name: '新增學生' }).click();
        const newForm001 = page.getByRole('form', { name: '新增學生' });
        await newForm001.getByLabel('學員編號').fill('001');
        await newForm001.getByRole('textbox', { name: '姓名', exact: true }).fill('新同學');
        await newForm001.getByRole('textbox', { name: /期初結餘（整數/ }).fill('50');
        await newForm001.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
        await newForm001.getByRole('button', { name: '建立學生' }).click();
        await expect(page.getByTestId('cloud-student-row-001')).toContainText('新同學');

        // 驗證後端 Firestore 最終文件狀態
        const finalStudents = await listAdminDocuments('students');
        expect(finalStudents).toHaveLength(4);
        const finalCodes = await listAdminDocuments('studentCodes');
        expect(finalCodes.map(c => c.id).sort()).toEqual(['001', '003', '015', '099']);
        expect(finalCodes.find(c => c.id === '002')).toBeUndefined();

        await second.page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      } finally {
        await second.close();
      }
    } finally {
      if (!first.page.isClosed()) {
        const release = first.page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
        if (await release.isVisible().catch(() => false)) await release.click();
      }
      await first.close();
    }
  });
});

test.describe('P08 Cloud Orders', () => {
  test.setTimeout(120000);

  test.beforeEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test.afterEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test('D03: creates bento and other meal orders, handles duplicate confirmation, displays E details and persists after reload', async ({ browser }) => {
    const session = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      const page = session.page;
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toBeVisible();

      // 1. 先至「日期與供應商」設定今日菜單
      const today = taipeiToday();
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const mainVendors = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      await expect(mainVendors.getByRole('heading', { name: '營業日、菜單與供應商' })).toBeVisible();
      const dateField = mainVendors.getByLabel('查看或設定日期');
      if ((await dateField.inputValue()) !== today) {
        await dateField.fill(today);
        await mainVendors.getByRole('button', { name: '載入日期' }).click();
      }
      await expect(mainVendors.getByRole('heading', { name: `${today} 營業日` })).toBeVisible();

      const createDayBtn = page.getByRole('button', { name: '建立空白營業日' });
      if (await createDayBtn.isVisible().catch(() => false)) {
        await createDayBtn.click();
      }
      const menuForm = mainVendors.getByRole('form', { name: `${today} 菜單` });
      await expect(menuForm).toBeVisible();

      // 新增供應商
      await page.getByRole('button', { name: '新增供應商' }).click();
      const vendorForm = mainVendors.getByRole('form', { name: '新增供應商' });
      await vendorForm.getByLabel('供應商編號').fill('p08-vendor-1');
      await vendorForm.getByLabel('供應商名稱').fill('阿榮排骨');
      await vendorForm.getByRole('button', { name: '建立供應商' }).click();
      await expect(page.getByTestId('cloud-vendor-row-p08-vendor-1')).toContainText('阿榮排骨');

      // 設定今日菜單
      await menuForm.getByLabel('菜單名稱').fill('排骨便當');
      await menuForm.getByLabel('價格（新臺幣整數）').fill('90');
      await menuForm.getByLabel('供應商').selectOption('p08-vendor-1');
      await menuForm.getByRole('button', { name: '儲存菜單' }).click();
      await expect(mainVendors.getByText(/已確認 設定 .* 菜單 完成/)).toBeVisible();

      // 設定開帳金額
      const openingForm = mainVendors.getByRole('form', { name: `${today} 開帳現金` });
      await openingForm.getByLabel(/開帳現金/).fill('3000');
      await openingForm.getByRole('button', { name: /開帳金額/ }).click();
      await expect(mainVendors.getByText(/已確認 確認 .* 開帳現金 完成/)).toBeVisible();

      // 2. 切換至「學生管理」建立學生 004 與 005
      await page.getByRole('button', { name: '學生管理' }).click();
      await expect(page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();

      // 建立學生 004
      await page.getByRole('button', { name: '新增學生' }).click();
      const studentForm1 = page.getByRole('form', { name: '新增學生' });
      await studentForm1.getByLabel('學員編號').fill('004');
      await studentForm1.getByRole('textbox', { name: '姓名', exact: true }).fill('王小明');
      await studentForm1.getByRole('textbox', { name: /期初結餘（整數/ }).fill('100');
      await studentForm1.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await studentForm1.getByRole('button', { name: '建立學生' }).click();
      await expect(page.getByTestId('cloud-student-row-004')).toContainText('王小明');

      // 建立學生 005
      await page.getByRole('button', { name: '新增學生' }).click();
      const studentForm2 = page.getByRole('form', { name: '新增學生' });
      await studentForm2.getByLabel('學員編號').fill('005');
      await studentForm2.getByRole('textbox', { name: '姓名', exact: true }).fill('李小華');
      await studentForm2.getByRole('textbox', { name: /期初結餘（整數/ }).fill('50');
      await studentForm2.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await studentForm2.getByRole('button', { name: '建立學生' }).click();
      await expect(page.getByTestId('cloud-student-row-005')).toContainText('李小華');

      // 3. 切換至「櫃台點餐」
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);

      // 驗證頂部兩行餐點計數（今日餐點 0，其他餐點 0）
      const bentoRow = page.getByTestId('cloud-topbar-bento');
      await expect(bentoRow).toContainText('今日餐點（排骨便當）');
      await expect(bentoRow).toContainText('0');
      const otherRow = page.getByTestId('cloud-topbar-other');
      await expect(otherRow).toContainText('其他餐點');
      await expect(otherRow).toContainText('0');

      // 4. 搜尋 004，選取王小明，訂購今日餐點（排骨便當 $90，實收 $100）
      const searchBox = page.getByLabel('搜尋編號、姓名或別名');
      await searchBox.fill('004');
      await page.getByTestId('search-result-004').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('王小明');

      await page.getByLabel('實收金額（留空為 0 元）').fill('100');
      await page.getByTestId('submit-order-button').click();
      await expect(page.getByText('已確認 004 王小明 訂餐完成')).toBeVisible();

      // 驗證頂部計數：今日餐點變 1，其他餐點 0
      await expect(bentoRow).toContainText('1');
      await expect(otherRow).toContainText('0');

      // 驗證最近帳戶列：出現 004 王小明，標籤「今日餐點 1」
      const recent004 = page.getByTestId('recent-item-004');
      await expect(recent004).toContainText('004 王小明');
      await expect(recent004).toContainText('今日餐點 1');

      // 5. 搜尋 005，選取李小華，訂購其他餐點（素食炒麵 $70，實收 0，扣結餘產生欠款）
      await searchBox.fill('005');
      await page.getByTestId('search-result-005').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('李小華');

      await page.getByRole('button', { name: '其他餐點' }).click();
      await page.getByLabel('餐點品名（必填）').fill('素食炒麵');
      await page.getByLabel('餐點單價（必填）').fill('70');
      await page.getByTestId('submit-order-button').click();
      await expect(page.getByText('已確認 005 李小華 訂餐完成')).toBeVisible();

      // 驗證頂部計數：今日餐點 1，其他餐點 1
      await expect(bentoRow).toContainText('1');
      await expect(otherRow).toContainText('1');

      // 驗證最近帳戶列：出現 005 李小華，標籤「其他餐點 1」
      const recent005 = page.getByTestId('recent-item-005');
      await expect(recent005).toContainText('005 李小華');
      await expect(recent005).toContainText('其他餐點 1');

      // 6. 再次選取 004 王小明，加訂今日餐點（觸發重複加訂確認）
      await recent004.click();
      await expect(page.getByTestId('selected-student-card')).toContainText('王小明');
      await page.getByTestId('submit-order-button').click();

      // 彈出加訂確認對話框
      await expect(page.getByText(/今天已訂 1 份餐點，確定要再加訂 1 份嗎？/)).toBeVisible();
      await page.getByTestId('confirm-duplicate-button').click();
      await expect(page.getByText('已確認 004 王小明 訂餐完成')).toBeVisible();

      // 頂部計數：今日餐點變 2，其他餐點 1
      await expect(bentoRow).toContainText('2');
      await expect(otherRow).toContainText('1');

      // 最近帳戶 004 標籤變為「今日餐點 2」
      await expect(recent004).toContainText('今日餐點 2');

      // 7. 選取 004，開啟 E「付款明細」
      await recent004.click();
      await page.getByTestId('open-payment-details-button').click();
      const modal = page.getByTestId('payment-details-modal');
      await expect(modal).toBeVisible();
      await expect(modal).toContainText('王小明 今日付款明細');
      await expect(modal.getByTestId('payment-details-summary')).toContainText('今日餐費：$180');
      await expect(modal.getByTestId('payment-details-summary')).toContainText('今日收款：$100');
      // 驗證不包含查看全部紀錄（P08 邊界）
      await expect(modal.getByRole('button', { name: '查看全部紀錄' })).toHaveCount(0);
      await page.getByTestId('close-payment-details-button').click();
      await expect(modal).toHaveCount(0);

      // 8. 瀏覽器重新整理（Reload）驗證遠端 Firestore 資料持久化
      await page.reload();
      await expect(page.locator('.operator-strip')).toBeVisible();
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);

      // 重新整理後計數與最近帳戶依然完全一致
      await expect(page.getByTestId('cloud-topbar-bento')).toContainText('今日餐點（排骨便當）');
      await expect(page.getByTestId('cloud-topbar-bento')).toContainText('2');
      await expect(page.getByTestId('cloud-topbar-other')).toContainText('其他餐點');
      await expect(page.getByTestId('cloud-topbar-other')).toContainText('1');
      await expect(page.getByTestId('recent-item-004')).toContainText('今日餐點 2');
      await expect(page.getByTestId('recent-item-005')).toContainText('其他餐點 1');

      // 9. 核對後端 Firestore 最終文件
      const transactions = await listAdminDocuments('transactions');
      expect(transactions).toHaveLength(3);
      expect(transactions.filter(t => (t as Record<string, unknown>).mealKind === 'bento')).toHaveLength(2);
      expect(transactions.filter(t => (t as Record<string, unknown>).mealKind === 'other')).toHaveLength(1);

      await page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
    } finally {
      await session.close();
    }
  });
});

test.describe('P09a Cloud Payments and Counter Cash', () => {
  test.setTimeout(120000);

  test.beforeEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test.afterEach(async () => {
    await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
  });

  test('D04: records a student payment, counter income and a vendor payout, shows expected cash and persists after reload', async ({ browser }) => {
    const session = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      const page = session.page;
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toBeVisible();

      // 1. 今日營業日存在且開帳現金確認為 1,000（前面的案例可能已建立營業日）
      const today = taipeiToday();
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const mainVendors = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const dateField = mainVendors.getByLabel('查看或設定日期');
      if ((await dateField.inputValue()) !== today) {
        await dateField.fill(today);
        await mainVendors.getByRole('button', { name: '載入日期' }).click();
      }
      await expect(mainVendors.getByRole('heading', { name: `${today} 營業日` })).toBeVisible();
      const createDayBtn = page.getByRole('button', { name: '建立空白營業日' });
      if (await createDayBtn.isVisible().catch(() => false)) {
        await createDayBtn.click();
      }
      const openingForm = mainVendors.getByRole('form', { name: `${today} 開帳現金` });
      await openingForm.getByLabel(/開帳現金/).fill('1000');
      await openingForm.getByRole('button', { name: /開帳金額/ }).click();
      await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 1,000/)).toBeVisible();

      // 2. 建立學生 006（期初 0）
      await page.getByRole('button', { name: '學生管理' }).click();
      await page.getByRole('button', { name: '新增學生' }).click();
      const studentForm = page.getByRole('form', { name: '新增學生' });
      await studentForm.getByLabel('學員編號').fill('006');
      await studentForm.getByRole('textbox', { name: '姓名', exact: true }).fill('陳小美');
      await studentForm.getByRole('textbox', { name: /期初結餘（整數/ }).fill('0');
      await studentForm.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await studentForm.getByRole('button', { name: '建立學生' }).click();
      await expect(page.getByTestId('cloud-student-row-006')).toContainText('陳小美');

      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);

      const before = await readAdminDocument('days', today);
      const beforeTotals = before?.totals as Record<string, number>;
      expect(before).toMatchObject({ openingCash: 1000 });
      const retained = beforeTotals.retainedReceipts;
      const income = beforeTotals.cashierIncome;
      const expense = beforeTotals.cashierExpense;
      const beforeTransactions = await listAdminDocuments('transactions');
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${1000 + retained + income - expense}`);

      // 3. 學生 006 繳費 $200（W 模式）
      await page.getByLabel('搜尋編號、姓名或別名').fill('006');
      await page.getByTestId('search-result-006').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('陳小美');
      await page.getByRole('button', { name: '繳費（W）' }).click();
      await page.getByLabel('繳費金額（必填）').fill('200');
      await page.getByTestId('submit-order-button').click();
      await expect(page.getByText(/已確認 006 陳小美 繳費 \$200 完成/)).toBeVisible();
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${1000 + retained + 200 + income - expense}`);

      // 4. 櫃台收入 $50（零錢補充）
      await page.getByTestId('open-cash-movement-button').click();
      const cashForm = page.getByRole('form', { name: '櫃台收支' });
      await cashForm.getByRole('button', { name: '收入' }).click();
      await cashForm.getByLabel('金額（必填）').fill('50');
      await cashForm.getByLabel('原因（必填）').fill('零錢補充');
      await page.getByTestId('submit-cash-movement-button').click();
      await expect(page.getByText(/已確認櫃台收入 \$50入帳/)).toBeVisible();

      // 5. 櫃台支出 $80（付餐費給廠商）
      await page.getByTestId('open-cash-movement-button').click();
      await cashForm.getByLabel('金額（必填）').fill('80');
      await cashForm.getByRole('button', { name: '付餐費給廠商' }).click();
      await page.getByTestId('submit-cash-movement-button').click();
      await expect(page.getByText(/已確認櫃台支出 \$80入帳/)).toBeVisible();

      const expectedCash = 1000 + retained + 200 + income + 50 - expense - 80;
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${expectedCash}`);
      const cashList = page.getByTestId('cash-movement-list');
      await expect(cashList).toContainText('收入 $50');
      await expect(cashList).toContainText('零錢補充');
      await expect(cashList).toContainText('支出 $80');
      await expect(cashList).toContainText('付餐費給廠商');

      // 6. 重新整理後仍從伺服器讀回同樣的現金口徑
      await page.reload();
      await expect(page.locator('.operator-strip')).toBeVisible();
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${expectedCash}`);
      await expect(page.getByTestId('cash-movement-list')).toContainText('付餐費給廠商');
      await expect(page.getByTestId('recent-item-006')).toContainText('006 陳小美');

      // 7. 核對伺服器文件：櫃台列不動學生、學生餘額 +200、day totals 正確
      const after = await readAdminDocument('days', today);
      expect(after?.totals).toMatchObject({
        retainedReceipts: retained + 200,
        cashierIncome: income + 50,
        cashierExpense: expense + 80,
      });
      const transactions = await listAdminDocuments('transactions');
      const added = transactions.filter(tx => !beforeTransactions.some(prior => prior.id === tx.id));
      expect(added).toHaveLength(3);
      const payment = added.find(tx => tx.type === 'payment');
      expect(payment).toMatchObject({ paidAmount: 200, mealPrice: 0, amount: 200 });
      const cashRows = added.filter(tx => tx.type === 'expense');
      expect(cashRows).toHaveLength(2);
      for (const row of cashRows) {
        expect(row).toMatchObject({ studentId: '__cashier__', studentNameSnapshot: '櫃台' });
      }
      expect(cashRows.map(row => [row.paidAmount, row.mealPrice, row.note]).sort())
        .toEqual([[0, 80, '付餐費給廠商'], [50, 0, '零錢補充']].sort());
      const student = await readAdminDocument('students', String(payment?.studentId));
      expect(student).toMatchObject({ currentBalance: 200 });

      await page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
    } finally {
      await session.close();
    }
  });

  test('D05: refunds part of a student balance from the W panel, subtracts it from expected cash once and persists after reload', async ({ browser }) => {
    const session = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      const page = session.page;
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toBeVisible();

      // 1. 今日營業日存在且開帳現金確認為 1,000
      const today = taipeiToday();
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const mainVendors = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const dateField = mainVendors.getByLabel('查看或設定日期');
      if ((await dateField.inputValue()) !== today) {
        await dateField.fill(today);
        await mainVendors.getByRole('button', { name: '載入日期' }).click();
      }
      await expect(mainVendors.getByRole('heading', { name: `${today} 營業日` })).toBeVisible();
      const createDayBtn = page.getByRole('button', { name: '建立空白營業日' });
      if (await createDayBtn.isVisible().catch(() => false)) {
        await createDayBtn.click();
      }
      const openingForm = mainVendors.getByRole('form', { name: `${today} 開帳現金` });
      await openingForm.getByLabel(/開帳現金/).fill('1000');
      await openingForm.getByRole('button', { name: /開帳金額/ }).click();
      await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 1,000/)).toBeVisible();

      // 2. 建立學生 007（期初 150）
      await page.getByRole('button', { name: '學生管理' }).click();
      await page.getByRole('button', { name: '新增學生' }).click();
      const studentForm = page.getByRole('form', { name: '新增學生' });
      await studentForm.getByLabel('學員編號').fill('007');
      await studentForm.getByRole('textbox', { name: '姓名', exact: true }).fill('林退款');
      await studentForm.getByRole('textbox', { name: /期初結餘（整數/ }).fill('150');
      await studentForm.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await studentForm.getByRole('button', { name: '建立學生' }).click();
      await expect(page.getByTestId('cloud-student-row-007')).toContainText('林退款');

      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);

      const before = await readAdminDocument('days', today);
      const beforeTotals = before?.totals as Record<string, number>;
      const openingCash = before?.openingCash as number;
      const beforeExpected = openingCash + beforeTotals.retainedReceipts + beforeTotals.cashierIncome
        - beforeTotals.cashierExpense - beforeTotals.accountRefunds;
      const beforeTransactions = await listAdminDocuments('transactions');
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${beforeExpected}`);

      // 3. 學生 007 在 W 面板退款 $100（預設全額 150，改成 100）
      await page.getByLabel('搜尋編號、姓名或別名').fill('007');
      await page.getByTestId('search-result-007').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('林退款');
      await page.getByRole('button', { name: '繳費（W）' }).click();
      await page.getByTestId('open-refund-button').click();
      const refundForm = page.getByRole('form', { name: '退款' });
      await expect(refundForm.getByLabel('退款金額（必填）')).toHaveValue('150');
      await refundForm.getByLabel('退款金額（必填）').fill('100');
      await refundForm.getByLabel('退款原因（必填）').fill('學期結束退還');
      await page.getByTestId('submit-refund-button').click();
      await expect(page.getByTestId('refund-confirm-modal')).toContainText('確定從 林退款 的帳戶退還 $100 現金嗎？退款後餘額 $50');
      await page.getByTestId('confirm-refund-button').click();
      await expect(page.getByText(/已確認 007 林退款 退款 \$100 完成/)).toBeVisible();

      const expectedCash = beforeExpected - 100;
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${expectedCash}`);
      await expect(page.getByTestId('cloud-account-refunds')).toHaveText(`$${beforeTotals.accountRefunds + 100}`);
      await expect(page.getByTestId('recent-item-007')).toContainText('僅退款');

      // 4. 重新整理後仍從伺服器讀回同樣的現金口徑
      await page.reload();
      await expect(page.locator('.operator-strip')).toBeVisible();
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${expectedCash}`);

      // 5. 核對伺服器文件：只動 accountRefunds 與筆數，學生餘額 −100
      const after = await readAdminDocument('days', today);
      expect(after?.totals).toMatchObject({
        retainedReceipts: beforeTotals.retainedReceipts,
        cashierIncome: beforeTotals.cashierIncome,
        cashierExpense: beforeTotals.cashierExpense,
        accountRefunds: beforeTotals.accountRefunds + 100,
        activeTransactionCount: beforeTotals.activeTransactionCount + 1,
      });
      const transactions = await listAdminDocuments('transactions');
      const added = transactions.filter(tx => !beforeTransactions.some(prior => prior.id === tx.id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ type: 'refund', amount: 100, mealPrice: 0, paidAmount: 0, note: '學期結束退還' });
      const student = await readAdminDocument('students', String(added[0].studentId));
      expect(student).toMatchObject({ currentBalance: 50 });

      await page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
    } finally {
      await session.close();
    }
  });

  test('D06: undoes a payment within 5 seconds, corrects a meal, cancels it with a refund and keeps every record after reload', async ({ browser }) => {
    const session = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      const page = session.page;
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toBeVisible();

      // 1. 今日營業日存在且開帳現金確認為 1,000
      const today = taipeiToday();
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const mainVendors = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const dateField = mainVendors.getByLabel('查看或設定日期');
      if ((await dateField.inputValue()) !== today) {
        await dateField.fill(today);
        await mainVendors.getByRole('button', { name: '載入日期' }).click();
      }
      await expect(mainVendors.getByRole('heading', { name: `${today} 營業日` })).toBeVisible();
      const createDayBtn = page.getByRole('button', { name: '建立空白營業日' });
      if (await createDayBtn.isVisible().catch(() => false)) {
        await createDayBtn.click();
      }
      const openingForm = mainVendors.getByRole('form', { name: `${today} 開帳現金` });
      await openingForm.getByLabel(/開帳現金/).fill('1000');
      await openingForm.getByRole('button', { name: /開帳金額/ }).click();
      await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 1,000/)).toBeVisible();

      // 2. 建立學生 008（期初 0）
      await page.getByRole('button', { name: '學生管理' }).click();
      await page.getByRole('button', { name: '新增學生' }).click();
      const studentForm = page.getByRole('form', { name: '新增學生' });
      await studentForm.getByLabel('學員編號').fill('008');
      await studentForm.getByRole('textbox', { name: '姓名', exact: true }).fill('林更正');
      await studentForm.getByRole('textbox', { name: /期初結餘（整數/ }).fill('0');
      await studentForm.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await studentForm.getByRole('button', { name: '建立學生' }).click();
      await expect(page.getByTestId('cloud-student-row-008')).toContainText('林更正');

      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
      const before = await readAdminDocument('days', today);
      const beforeTotals = before?.totals as Record<string, number>;
      const beforeExpected = (before?.openingCash as number) + beforeTotals.retainedReceipts + beforeTotals.cashierIncome
        - beforeTotals.cashierExpense - beforeTotals.accountRefunds;
      const beforeTransactions = await listAdminDocuments('transactions');
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${beforeExpected}`);

      // 3. 繳費 $200 後 5 秒內撤回：餘額與現金回復
      await page.getByLabel('搜尋編號、姓名或別名').fill('008');
      await page.getByTestId('search-result-008').click();
      await page.getByRole('button', { name: '繳費（W）' }).click();
      await page.getByLabel(/繳費金額/).fill('200');
      await page.getByTestId('submit-order-button').click();
      await expect(page.getByText(/已確認 008 林更正 繳費 \$200 完成/)).toBeVisible();
      await expect(page.getByTestId('undo-bar')).toContainText('現金 −$200，餘額回到 $0');
      await page.getByTestId('undo-button').click();
      await expect(page.getByText(/已撤回 008 林更正 的繳費/)).toBeVisible();
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${beforeExpected}`);

      // 4. 其他餐點 $80 實收 $100，再把餐費更正為 $70
      await page.getByLabel('搜尋編號、姓名或別名').fill('008');
      await page.getByTestId('search-result-008').click();
      await page.getByRole('button', { name: '其他餐點' }).click();
      await page.getByLabel(/餐點品名/).fill('炒麵');
      await page.getByLabel(/餐點單價/).fill('80');
      await page.getByLabel(/實收金額/).fill('100');
      await page.getByTestId('submit-order-button').click();
      await expect(page.getByText(/已確認 008 林更正 訂餐完成/)).toBeVisible();
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${beforeExpected + 100}`);

      await page.getByLabel('搜尋編號、姓名或別名').fill('008');
      await page.getByTestId('search-result-008').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('目前餘額：$20');
      await page.getByTestId('open-payment-details-button').click();
      const orderRow = page.getByTestId('payment-details-modal').locator('tbody tr').filter({ hasText: '炒麵' });
      await orderRow.getByRole('button', { name: '更正' }).click();
      const editModal = page.getByTestId('edit-transaction-modal');
      await editModal.getByLabel('餐費').fill('70');
      await expect(editModal.getByTestId('edit-preview')).toContainText('帳戶餘額：$20 → $30');
      await editModal.getByLabel(/修改理由/).fill('價格記錯');
      await editModal.getByTestId('submit-edit-button').click();
      await expect(page.getByText(/已確認 008 林更正 的更正完成/)).toBeVisible();

      // 5. 取消這筆訂餐並退還 $100：訂餐作廢、現金扣回 $100、餘額回到 0
      await page.getByLabel('搜尋編號、姓名或別名').fill('008');
      await page.getByTestId('search-result-008').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('目前餘額：$30');
      await page.getByTestId('open-payment-details-button').click();
      await page.getByTestId('payment-details-modal').locator('tbody tr').filter({ hasText: '炒麵' })
        .getByRole('button', { name: '取消' }).click();
      await editModal.getByRole('button', { name: '取消訂餐並退還 $100' }).click();
      await expect(editModal.getByTestId('edit-preview')).toContainText('現金影響：−$100（退還現金給學生）');
      await editModal.getByLabel(/修改理由/).fill('學生請假');
      await editModal.getByTestId('submit-edit-button').click();
      await expect(page.getByText(/已確認 008 林更正 的取消訂餐並退款完成/)).toBeVisible();
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${beforeExpected}`);

      // 6. 重新整理後從伺服器讀回：兩筆都保留、都已作廢，命令留著前後值與理由
      await page.reload();
      await expect(page.locator('.operator-strip')).toBeVisible();
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
      await expect(page.getByTestId('cloud-expected-cash')).toHaveText(`$${beforeExpected}`);
      await page.getByLabel('搜尋編號、姓名或別名').fill('008');
      await page.getByTestId('search-result-008').click();
      await expect(page.getByTestId('selected-student-card')).toContainText('目前餘額：$0');
      await page.getByTestId('open-payment-details-button').click();
      await expect(page.getByTestId('payment-details-modal').locator('tbody tr').filter({ hasText: '已作廢' })).toHaveCount(2);

      const transactions = await listAdminDocuments('transactions');
      const added = transactions.filter(tx => !beforeTransactions.some(prior => prior.id === tx.id));
      expect(added.map(tx => [tx.type, tx.status, tx.revision]).sort()).toEqual([['order', 'voided', 3], ['payment', 'voided', 2]]);
      expect(added.find(tx => tx.type === 'order')).toMatchObject({ mealPrice: 70, paidAmount: 100 });
      const commands = await listAdminDocuments('commands');
      const order = added.find(tx => tx.type === 'order')!;
      const orderCommands = commands.filter(command => (command.targets as Record<string, unknown>)?.transactionId === order.id);
      expect(orderCommands.map(command => command.kind).sort()).toEqual(['CancelRefund', 'CorrectTransaction', 'CreateOrder']);
      const correction = orderCommands.find(command => command.kind === 'CorrectTransaction')!;
      expect(correction).toMatchObject({ reason: '價格記錯' });
      expect(((correction.before as Record<string, Record<string, unknown>>).transaction).mealPrice).toBe(80);
      const after = await readAdminDocument('days', today);
      expect(after?.totals).toMatchObject({
        retainedReceipts: beforeTotals.retainedReceipts,
        accountRefunds: beforeTotals.accountRefunds,
        activeTransactionCount: beforeTotals.activeTransactionCount,
      });

      await page.keyboard.press('Escape');
      await page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
    } finally {
      await session.close();
    }
  });

  test('D07: corrects a student opening on its original date with a reason, leaves cash untouched and persists after reload', async ({ browser }) => {
    const session = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      const page = session.page;
      const today = taipeiToday();
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toBeVisible();
      await expect(page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();

      // 1. 建立學生 009，期初 100（期初日為上線日）
      await page.getByRole('button', { name: '新增學生' }).click();
      const studentForm = page.getByRole('form', { name: '新增學生' });
      await studentForm.getByLabel('學員編號').fill('009');
      await studentForm.getByRole('textbox', { name: '姓名', exact: true }).fill('陳期初');
      await studentForm.getByRole('textbox', { name: /期初結餘（整數/ }).fill('100');
      await studentForm.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      await studentForm.getByRole('button', { name: '建立學生' }).click();
      const row = page.getByTestId('cloud-student-row-009');
      await expect(row).toContainText('陳期初');
      const student = (await listAdminDocuments('students')).find(item => item.studentCode === '009')!;
      const openingDate = (student.openingBalance as Record<string, string>).asOfDate;
      expect(openingDate).toBe(today);

      // 2. 期初日沒有營業日時先建立（不影響現金），再回來更正
      await row.getByRole('button', { name: '更正期初' }).click();
      const ensureDay = row.getByRole('button', { name: `先建立營業日 ${openingDate}` });
      const openingForm = row.getByRole('form', { name: '更正期初 009' });
      await expect(ensureDay.or(openingForm)).toBeVisible();
      if (await ensureDay.isVisible()) {
        await ensureDay.click();
        await expect(page.getByText(/請再按該學生的「更正期初」繼續/)).toBeVisible();
        await row.getByRole('button', { name: '更正期初' }).click();
      }
      await expect(openingForm).toBeVisible();
      const dayBefore = await readAdminDocument('days', openingDate);

      // 3. 期初 100 → 70：預覽顯示期初與目前結餘的變化，送出需要原因
      await openingForm.getByLabel(/期初結餘/).fill('70');
      await openingForm.getByLabel(/期初備註/).fill('核對紙本後更正');
      await expect(openingForm.getByLabel('期初更正預覽')).toContainText('NT$ 100 → NT$ 70');
      await openingForm.getByRole('button', { name: '確認更正期初' }).click();
      await expect(page.getByRole('alert')).toContainText('請輸入具體的期初更正原因');
      await openingForm.getByLabel('更正原因（必填）').fill('期初抄錯 30 元');
      await openingForm.getByRole('button', { name: '確認更正期初' }).click();
      await expect(page.getByText(/已確認 更正 009 期初為 NT\$ 70 完成/)).toBeVisible();
      await expect(row).toContainText('NT$ 70');

      const corrected = (await listAdminDocuments('students')).find(item => item.studentCode === '009')!;
      expect(corrected).toMatchObject({
        currentBalance: 70, openingBalance: { amount: 70, asOfDate: openingDate, note: '核對紙本後更正' },
      });
      const dayAfter = await readAdminDocument('days', openingDate);
      expect(dayAfter).toMatchObject({ totals: dayBefore?.totals, openingCash: dayBefore?.openingCash, status: dayBefore?.status });
      expect(dayAfter?.revision).toBe(Number(dayBefore?.revision) + 1);
      const command = (await listAdminDocuments('commands')).find(item => item.kind === 'CorrectOpening'
        && (item.targets as Record<string, unknown>).studentId === student.id)!;
      expect(command).toMatchObject({
        reason: '期初抄錯 30 元', businessDate: openingDate,
        cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
      });
      expect((command.before as Record<string, Record<string, Record<string, number>>>).student.openingBalance.amount).toBe(100);

      await page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
    } finally {
      await session.close();
    }

    const second = await openGoogleSession(browser, E2E_IDENTITIES.operatorA.email);
    try {
      await second.page.getByRole('button', { name: '取得系統使用權' }).click();
      const row = second.page.getByTestId('cloud-student-row-009');
      await expect(row).toContainText('NT$ 70');
      await row.getByText('查看期初資料').click();
      await expect(row).toContainText('核對紙本後更正');
      await second.page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
    } finally {
      await second.close();
    }
  });
});
