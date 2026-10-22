import type { Page, Request } from '@playwright/test';
import { test, expect } from './fixtures';
import { removeDocument, seedAccessLease, upsertDocument } from './helpers/seed';

const DATASET_ID = 'e2e-empty-p06-dataset';
const APP_NAMESPACE = 'easyorder-cloud-command-journal:v1:demo-easyorder:%5BDEFAULT%5D';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

interface WriteGate {
  mode: 'before-server' | 'after-server';
  intercepted: ReturnType<typeof deferred>;
  release: ReturnType<typeof deferred>;
  completed: ReturnType<typeof deferred>;
  requests: number;
}

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function seedOrderRecoveryFixture(uid: string, today: string, studentId: string, studentCode: string, seedCommandId: string) {
  await upsertDocument('students', studentId, {
    studentId, studentCode, displayName: `P13b2b1 ${studentCode}`, aliases: [], status: 'active',
    openingBalance: { amount: 0, asOfDate: today, note: '', createdAt: new Date() },
    currentBalance: 0, createdAt: new Date(), revision: 1, lastCommandId: seedCommandId, updatedAt: new Date(),
  });
  await upsertDocument('studentCodes', studentCode, { studentId, lastCommandId: seedCommandId, updatedAt: new Date() });
  await upsertDocument('days', today, {
    status: 'open', revision: 1,
    menu: {
      businessDate: today, itemName: 'P13b2b1 Test Meal', price: 100, vendorId: 'p13b2b1-test-vendor',
      vendorNameSnapshot: 'P13b2b1 Test Vendor', updatedAt: new Date(), revision: 1, inheritedFromDate: null,
    },
    openingCash: 1000, openedBy: uid, openedAt: new Date(),
    totals: {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
    },
    lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: new Date(),
  });
  await upsertDocument('system', 'dataHead', {
    datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
  });
}

async function setDayVendorDataHead(datasetId: string, today: string, seq: number, lastCommandId: string | null) {
  await upsertDocument('system', 'dataHead', {
    schemaVersion: 1, datasetId, seq, lastCommandId, maintenance: false, goLiveDate: today, updatedAt: new Date(),
  });
}

async function seedDayVendorRecoveryFixture(today: string, datasetId: string) {
  const vendorId = 'p13b2b2b-recovery-vendor';
  const seedCommandId = 'd3000000-0000-4000-8000-000000000001';
  await upsertDocument('vendors', vendorId, {
    vendorId, name: 'P13b2b 回復供應商', phone: '', note: '', status: 'active', deleted: false,
    createdAt: new Date(), revision: 1, lastCommandId: seedCommandId, updatedAt: new Date(),
  });
  await upsertDocument('days', today, {
    status: 'open', revision: 1,
    menu: {
      businessDate: today, itemName: 'P13b2b 回復餐盒', price: 125, vendorId,
      vendorNameSnapshot: 'P13b2b 回復供應商', updatedAt: new Date(), revision: 1, inheritedFromDate: null,
    },
    openingCash: null, openedBy: null, openedAt: null,
    totals: {
      activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
      retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
    },
    lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: new Date(),
  });
  await setDayVendorDataHead(datasetId, today, 0, null);
  return { vendorId };
}

function commitWritesDocument(request: import('@playwright/test').Request, collection: string, id: string): boolean {
  try {
    const body = request.postDataJSON() as {
      writes?: Array<{ update?: { name?: string }; delete?: string }>;
    };
    return body.writes?.some(write => (write.update?.name ?? write.delete ?? '')
      .endsWith(`/documents/${collection}/${id}`)) ?? false;
  } catch {
    return false;
  }
}

async function waitForWriteGate(promise: Promise<void>, label: string, timeoutMs = 30000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readEmulatorDocument(collection: string, id: string) {
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/demo-easyorder/databases/(default)/documents/${collection}/${id}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) throw new Error(`Unable to read Emulator ${collection}/${id}: ${await response.text()}`);
  return response.json() as Promise<{ fields?: Record<string, unknown> }>;
}

function studentTargetFromReceipt(receipt: { fields?: Record<string, unknown> }): string | null {
  const targets = receipt.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined;
  return (targets?.mapValue?.fields?.studentId as { stringValue?: string } | undefined)?.stringValue ?? null;
}

async function listEmulatorDocumentIds(collection: string): Promise<string[]> {
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/demo-easyorder/databases/(default)/documents/${collection}?pageSize=100`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) throw new Error(`Unable to list Emulator ${collection}: ${await response.text()}`);
  const body = await response.json() as { documents?: Array<{ name?: string }> };
  return (body.documents ?? []).map(document => document.name?.split('/').at(-1) ?? '').filter(Boolean);
}

function shiftBusinessDate(day: string, delta: number): string {
  const shifted = new Date(`${day}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + delta);
  return shifted.toISOString().slice(0, 10);
}

async function setDayCloseDataHead(datasetId: string, goLiveDate: string, seq: number, lastCommandId: string | null) {
  await upsertDocument('system', 'dataHead', {
    schemaVersion: 1, datasetId, seq, lastCommandId, maintenance: false, goLiveDate, updatedAt: new Date(),
  });
}

const ZERO_TOTALS = {
  activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
  retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
};

/** An open day with a confirmed opening cash of 1,000 and no activity: the expected cash to close is 1,000. */
async function seedDayCloseFixture(today: string, uid: string, datasetId: string) {
  const seedCommandId = 'd4000000-0000-4000-8000-000000000001';
  await upsertDocument('days', today, {
    status: 'open', revision: 6,
    menu: {
      businessDate: today, itemName: 'P13b2b2c 日結餐盒', price: 90, vendorId: 'p13b2b2c-vendor',
      vendorNameSnapshot: 'P13b2b2c 供應商', updatedAt: new Date(), revision: 1, inheritedFromDate: null,
    },
    openingCash: 1000, openedBy: uid, openedAt: new Date(),
    totals: ZERO_TOTALS, lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: new Date(),
  });
  await setDayCloseDataHead(datasetId, today, 0, null);
}

/**
 * Holds the server response of one matching commit: the request reaches the Emulator and takes effect, but the browser
 * only gets the response after `release`. Other matching and non-matching commits pass straight through.
 */
function createHeldCommit(page: Page, matches: (request: Request) => boolean, heldIndex = 1) {
  const state = {
    matched: 0, returned: false,
    intercepted: deferred(), release: deferred(), completed: deferred(),
  };
  let armed = false;
  return {
    state,
    arm: () => { armed = true; },
    install: () => page.route('**/documents:commit*', async route => {
      if (!armed || route.request().method() !== 'POST' || !matches(route.request())) {
        await route.continue();
        return;
      }
      state.matched += 1;
      if (state.matched !== heldIndex) {
        await route.continue();
        return;
      }
      const response = await route.fetch({ timeout: 30000 });
      state.intercepted.resolve();
      await state.release.promise;
      await route.fulfill({ response });
      state.returned = true;
      state.completed.resolve();
    }),
    settle: async () => {
      state.release.resolve();
      if (state.matched > 0) await Promise.race([state.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*').catch(() => undefined);
    },
  };
}

async function lastCommandIdFromHead(): Promise<string | null> {
  const head = await readEmulatorDocument('system', 'dataHead').catch(() => null);
  return (head?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
}

async function rawStorageDump(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])),
    session: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)])),
  }));
}

/** Every journal entry of the app namespace keeps exactly the three minimal fields, nothing about the operation. */
async function expectMinimalJournal(page: Page, expected: Array<{ commandId: string; datasetId: string; uid: string }>) {
  const entries = await page.evaluate(namespace => Object.keys(localStorage)
    .filter(key => key.startsWith(`${namespace}:`))
    .map(key => JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown>), APP_NAMESPACE);
  for (const entry of entries) expect(Object.keys(entry).sort()).toEqual(['commandId', 'datasetId', 'uid']);
  expect(entries.sort((a, b) => String(a.commandId).localeCompare(String(b.commandId))))
    .toEqual([...expected].sort((a, b) => a.commandId.localeCompare(b.commandId)));
}

async function cleanupDayCloseRun(page: Page, options: { commandIds: string[]; days: string[]; settlementDays?: string[]; backfillDays?: string[] }) {
  const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
  if (await release.isVisible().catch(() => false)) await release.click();
  const ids = new Set(options.commandIds);
  const headId = await lastCommandIdFromHead();
  if (headId) ids.add(headId);
  for (const id of await listEmulatorDocumentIds('commands').catch(() => [])) ids.add(id);
  for (const id of ids) {
    await removeDocument('commands', id).catch(() => undefined);
    await page.evaluate(({ namespace, pendingCommandId }) => localStorage.removeItem(`${namespace}:${pendingCommandId}`), {
      namespace: APP_NAMESPACE, pendingCommandId: id,
    }).catch(() => undefined);
  }
  for (const day of options.settlementDays ?? []) {
    for (const revision of await listEmulatorDocumentIds(`days/${day}/settlements`).catch(() => [])) {
      await removeDocument(`days/${day}/settlements`, revision).catch(() => undefined);
    }
  }
  for (const day of options.backfillDays ?? []) await removeDocument('backfillDays', day).catch(() => undefined);
  for (const day of options.days) await removeDocument('days', day).catch(() => undefined);
  // The next case starts from a vacant lease at epoch 0.
  await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
}

async function storePendingIdentity(page: import('@playwright/test').Page, uid: string, commandId: string, datasetId = DATASET_ID) {
  await page.evaluate(({ currentUid, pendingCommandId, pendingDatasetId, namespace }) => {
    localStorage.setItem(`${namespace}:${pendingCommandId}`, JSON.stringify({
      commandId: pendingCommandId,
      datasetId: pendingDatasetId,
      uid: currentUid,
    }));
  }, { currentUid: uid, pendingCommandId: commandId, pendingDatasetId: datasetId, namespace: APP_NAMESPACE });
}

async function readPendingIdentity(page: import('@playwright/test').Page, commandId: string) {
  return page.evaluate(({ namespace, pendingCommandId }) =>
    localStorage.getItem(`${namespace}:${pendingCommandId}`),
  { namespace: APP_NAMESPACE, pendingCommandId: commandId });
}

test.describe('P13b2a pending command journal and recovery boundary', () => {
  test.setTimeout(90000);

  test.beforeEach(async () => {
    await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
  });

  test.afterEach(async () => {
    await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
  });

  test('migrates the legacy slot, requires explicit continuation for an absent receipt, and preserves the raw ID', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const commandId = 'a0111111-1111-4111-8111-111111111111';
    await page.evaluate(({ currentUid, pendingCommandId }) => {
      localStorage.setItem('easyorder-cloud-pending-order', JSON.stringify({
        uid: currentUid,
        datasetId: 'e2e-empty-p06-dataset',
        commandId: pendingCommandId,
      }));
    }, { currentUid: uid, pendingCommandId: commandId });

    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    await expect(page.getByRole('heading', { name: '待核對命令' })).toBeVisible();
    await expect(page.getByText(commandId)).toBeVisible();
    await expect(page.getByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。')).toBeVisible();
    await expect(page.getByRole('button', { name: '櫃台點餐' })).toHaveCount(0);

    const stored = await page.evaluate(({ namespace, pendingCommandId }) => {
      const prefix = `${namespace}:`;
      const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix));
      return {
        legacy: localStorage.getItem('easyorder-cloud-pending-order'),
        keys,
        raw: localStorage.getItem(`${prefix}${pendingCommandId}`),
        otherKeys: keys.filter(key => key !== `${prefix}${pendingCommandId}`),
      };
    }, { namespace: APP_NAMESPACE, pendingCommandId: commandId });
    expect(stored.legacy).toBeNull();
    expect(stored.keys).toEqual([`${APP_NAMESPACE}:${commandId}`]);
    expect(stored.otherKeys).toEqual([]);
    expect(stored.raw).toBe(JSON.stringify({ commandId, datasetId: DATASET_ID, uid }));
    expect(Object.keys(JSON.parse(stored.raw!))).toEqual(['commandId', 'datasetId', 'uid']);

    await page.getByLabel('我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。').check();
    await page.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' }).click();
    await expect(page.getByRole('button', { name: '櫃台點餐' })).toBeVisible();
    await expect(page.getByText(commandId)).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), `${APP_NAMESPACE}:${commandId}`)).toBe(stored.raw);
  });

  test('renders a complete 101-record journal as two bounded UI pages', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const ids = Array.from({ length: 101 }, (_, index) => (
      `c0000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`
    ));
    await page.evaluate(({ namespace, currentUid, commandIds }) => {
      for (const commandId of commandIds) {
        localStorage.setItem(`${namespace}:${commandId}`, JSON.stringify({
          commandId,
          datasetId: 'e2e-empty-p06-dataset',
          uid: currentUid,
        }));
      }
    }, { namespace: APP_NAMESPACE, currentUid: uid, commandIds: ids });

    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    await expect(page.getByText('共有 101 筆最小追蹤編號；每頁最多 100 筆，最多保留 1000 筆。未決編號不會自動淘汰。')).toBeVisible();
    await expect(page.getByText(ids[0])).toBeVisible();
    await expect(page.getByText(ids[99])).toBeVisible();
    await expect(page.getByText(ids[100])).toHaveCount(0);
    await expect(page.getByText('第 1 / 2 頁')).toBeVisible();
    await page.getByRole('button', { name: '下一頁' }).click();
    await expect(page.getByText(ids[100])).toBeVisible();
    await expect(page.getByText(ids[0])).toHaveCount(0);
    await expect(page.getByText('第 2 / 2 頁')).toBeVisible();
  });

  test('confirms a real Emulator commit after reload and clears only its ID without a second effect', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const studentId = 'd1000000-0000-4000-8000-000000000001';
    const studentCode = '901';
    const seedCommandId = 'd2000000-0000-4000-8000-000000000002';
    await upsertDocument('students', studentId, {
      studentId, studentCode, displayName: 'P13b2 Journal Test', aliases: [], status: 'active',
      openingBalance: { amount: 0, asOfDate: today, note: '', createdAt: new Date() },
      currentBalance: 0, createdAt: new Date(), revision: 1, lastCommandId: seedCommandId, updatedAt: new Date(),
    });
    await upsertDocument('studentCodes', studentCode, {
      studentId, lastCommandId: seedCommandId, updatedAt: new Date(),
    });
    await upsertDocument('days', today, {
      status: 'open', revision: 1,
      menu: {
        businessDate: today, itemName: 'P13b2 Test Meal', price: 100, vendorId: 'p13b2-test-vendor',
        vendorNameSnapshot: 'P13b2 Test Vendor', updatedAt: new Date(), revision: 1, inheritedFromDate: null,
      },
      openingCash: 1000, openedBy: uid, openedAt: new Date(),
      totals: {
        activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
        retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
      },
      lastSettlementRevision: 0, lastCommandId: seedCommandId, updatedAt: new Date(),
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);

      await page.evaluate(namespace => {
        const win = window as unknown as Record<string, unknown>;
        const original = Storage.prototype.removeItem;
        win.__p13b2NativeRemoveItem = original;
        Storage.prototype.removeItem = function (key: string) {
          if (key.startsWith(`${namespace}:`)) throw new DOMException('synthetic journal cleanup denial', 'SecurityError');
          return original.call(this, key);
        };
      }, APP_NAMESPACE);

      await page.getByLabel('搜尋編號、姓名或別名').fill(studentCode);
      await page.getByTestId(`search-result-${studentCode}`).click();
      await page.getByLabel('實收金額（留空為 0 元）').fill('100');
      await page.getByTestId('submit-order-button').click();
      await expect(page.getByText('已確認 901 P13b2 Journal Test 訂餐完成')).toBeVisible();

      const persisted = await page.evaluate(namespace => {
        const prefix = `${namespace}:`;
        return Object.keys(localStorage)
          .filter(key => key.startsWith(prefix))
          .map(key => ({ key, raw: localStorage.getItem(key) }));
      }, APP_NAMESPACE);
      expect(persisted).toHaveLength(1);
      const pending = JSON.parse(persisted[0]!.raw!) as { commandId: string; datasetId: string; uid: string };
      commandId = pending.commandId;
      expect(pending).toEqual({ commandId: pending.commandId, datasetId: DATASET_ID, uid });
      await expect(page.getByText('已確認原命令入帳；本機追蹤編號尚未清除，之後會再核對。')).toBeVisible();

      const receiptResponse = await readEmulatorDocument('commands', commandId);
      const receiptFields = receiptResponse.fields ?? {};
      const receiptSeq = Number((receiptFields.seq as { integerValue?: string } | undefined)?.integerValue);
      const transactionId = (((receiptFields.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
        ?.mapValue?.fields?.transactionId as { stringValue?: string } | undefined)?.stringValue);
      expect(receiptSeq).toBe(1);
      if (!transactionId) throw new Error('Emulator receipt has no transaction target');

      // A reload drops the synthetic method denial; startup resolves the receipt and removes its exact journal ID.
      await page.reload();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(page.locator('.cloud-app')).toBeVisible();
      await expect(page.getByText('目前沒有待核對命令。')).toBeVisible();
      await expect.poll(() => page.evaluate(({ namespace: journalNamespace, id }) => (
        localStorage.getItem(`${journalNamespace}:${id}`)
      ), { namespace: APP_NAMESPACE, id: commandId! })).toBeNull();

      const head = await readEmulatorDocument('system', 'dataHead');
      expect((head.fields?.seq as { integerValue?: string } | undefined)?.integerValue).toBe('1');
      expect((head.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue).toBe(commandId);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect(await listEmulatorDocumentIds('transactions')).toEqual([transactionId]);
    } finally {
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      if (commandId) {
        const receipt = await readEmulatorDocument('commands', commandId).catch(() => null);
        const transactionId = (((receipt?.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
          ?.mapValue?.fields?.transactionId as { stringValue?: string } | undefined)?.stringValue);
        if (transactionId) await removeDocument('transactions', transactionId);
        await removeDocument('commands', commandId);
      }
      for (const id of await listEmulatorDocumentIds('transactions')) await removeDocument('transactions', id);
      for (const id of await listEmulatorDocumentIds('commands')) await removeDocument('commands', id);
      await removeDocument('days', today);
      await removeDocument('students', studentId);
      await removeDocument('studentCodes', studentCode);
      await upsertDocument('system', 'dataHead', {
        datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
      });
    }
  });

  test('keeps the mounted shell across another-tab journal changes and uses a shared exclusive Web Lock', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const peer = await page.context().newPage();
    try {
      await peer.goto('/');
      await expect(peer.getByRole('button', { name: '取得系統使用權' })).toBeVisible();
      const migratedCommandId = 'a0222222-2222-4222-8222-222222222222';
      await page.evaluate(({ currentUid, pendingCommandId }) => {
        localStorage.setItem('easyorder-cloud-pending-order', JSON.stringify({
          uid: currentUid,
          datasetId: 'e2e-empty-p06-dataset',
          commandId: pendingCommandId,
        }));
      }, { currentUid: uid, pendingCommandId: migratedCommandId });

      // Both AuthGate instances become legal holders of the same UID/epoch and concurrently migrate one legacy slot.
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(peer.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(page.getByText(migratedCommandId)).toBeVisible();
      await expect(peer.getByText(migratedCommandId)).toBeVisible();
      const migratedStorage = await page.evaluate(({ namespace, pendingCommandId }) => ({
        legacy: localStorage.getItem('easyorder-cloud-pending-order'),
        value: localStorage.getItem(`${namespace}:${pendingCommandId}`),
      }), { namespace: APP_NAMESPACE, pendingCommandId: migratedCommandId });
      expect(migratedStorage.legacy).toBeNull();
      expect(migratedStorage.value).toBe(JSON.stringify({
        commandId: migratedCommandId, datasetId: DATASET_ID, uid,
      }));

      await page.getByLabel('我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。').check();
      await page.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' }).click();
      await expect(page.locator('.cloud-app')).toBeVisible();
      await page.evaluate(() => {
        const win = window as unknown as Record<string, unknown>;
        win.__p13b2ShellNode = document.querySelector('.cloud-app');
      });

      const commandId = 'a0333333-3333-4333-8333-333333333333';
      const key = `${APP_NAMESPACE}:${commandId}`;
      await peer.evaluate(({ journalKey, currentUid, pendingCommandId }) => {
        localStorage.setItem(journalKey, JSON.stringify({
          commandId: pendingCommandId,
          datasetId: 'e2e-empty-p06-dataset',
          uid: currentUid,
        }));
      }, { journalKey: key, currentUid: uid, pendingCommandId: commandId });

      await expect(page.getByText(commandId)).toBeVisible();
      await expect(page.getByRole('listitem').filter({ hasText: commandId }).getByText(
        '伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。',
      )).toBeVisible();
      const shellStillSameNode = await page.evaluate(() => {
        const win = window as unknown as Record<string, unknown>;
        return win.__p13b2ShellNode === document.querySelector('.cloud-app');
      });
      expect(shellStillSameNode).toBe(true);

      const lockName = `${APP_NAMESPACE}:exclusive`;
      await page.evaluate(name => {
        const win = window as unknown as Record<string, unknown>;
        win.__p13b2LockEntered = false;
        let release!: () => void;
        win.__p13b2ReleaseLock = () => release();
        void navigator.locks.request(name, { mode: 'exclusive' }, async () => {
          win.__p13b2LockEntered = true;
          await new Promise<void>(resolve => { release = resolve; });
        });
      }, lockName);
      await expect.poll(() => page.evaluate(() => (
        (window as unknown as Record<string, unknown>).__p13b2LockEntered
      ))).toBe(true);

      const acquiredBeforeRelease = await peer.evaluate(async name => {
        const win = window as unknown as Record<string, unknown>;
        win.__p13b2SecondLockEntered = false;
        void navigator.locks.request(name, { mode: 'exclusive' }, () => {
          win.__p13b2SecondLockEntered = true;
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        return win.__p13b2SecondLockEntered;
      }, lockName);
      expect(acquiredBeforeRelease).toBe(false);

      await page.evaluate(() => {
        const win = window as unknown as Record<string, unknown>;
        (win.__p13b2ReleaseLock as (() => void) | undefined)?.();
      });
      await expect.poll(() => peer.evaluate(() => (
        (window as unknown as Record<string, unknown>).__p13b2SecondLockEntered
      ))).toBe(true);
      await expect(page.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' })).toBeVisible();
    } finally {
      await peer.close();
    }
  });

  test('serializes real cross-tab journal writes, rejects UUID collisions, and admits only one final capacity slot', async ({ page }) => {
    const peer = await page.context().newPage();
    const driverUrl = 'http://127.0.0.1:4174';
    const driverApp = 'p13b2a-cross-tab-journal';
    const driverProject = 'p13b2a-journal-e2e';
    const prefix = `easyorder-cloud-command-journal:v1:${encodeURIComponent(driverProject)}:${encodeURIComponent(driverApp)}:`;
    type BrowserIdentity = { commandId: string; datasetId: string; uid: string };
    type BrowserJournal = {
      namespace: string;
      put(record: BrowserIdentity): Promise<void>;
      readAll(): Promise<{ records: BrowserIdentity[]; total: number; complete: boolean }>;
    };

    const installJournal = async (target: typeof page) => {
      await target.goto(driverUrl);
      await target.evaluate(async ({ appName, projectId }) => {
        const module = await import('/src/firebase/cloudPendingJournal.ts');
        const app = { name: appName, options: { projectId } };
        const journal = module.createCloudPendingJournal({ app } as never);
        (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal = journal;
      }, { appName: driverApp, projectId: driverProject });
    };

    try {
      await Promise.all([installJournal(page), installJournal(peer)]);
      await page.evaluate(() => localStorage.clear());
      const first = { commandId: 'b1111111-1111-4111-8111-111111111111', datasetId: 'dataset-a', uid: 'operator-a' };
      const second = { commandId: 'b2222222-2222-4222-8222-222222222222', datasetId: 'dataset-a', uid: 'operator-b' };
      await Promise.all([
        page.evaluate(async record => (
          (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record)
        ), first),
        peer.evaluate(async record => (
          (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record)
        ), second),
      ]);
      const concurrent = await page.evaluate(async () => (
        (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.readAll()
      ));
      expect(concurrent).toMatchObject({ total: 2, complete: true, records: [first, second] });
      const stored = await page.evaluate(keyPrefix => Object.keys(localStorage)
        .filter(key => key.startsWith(keyPrefix))
        .map(key => ({ key, raw: localStorage.getItem(key) })), prefix);
      expect(stored).toHaveLength(2);
      for (const item of stored) {
        expect(Object.keys(JSON.parse(item.raw!))).toEqual(['commandId', 'datasetId', 'uid']);
      }

      await page.evaluate(() => localStorage.clear());
      const collidingId = 'b3333333-3333-4333-8333-333333333333';
      const collisions = await Promise.all([
        page.evaluate(async record => {
          try {
            await (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record);
            return 'written';
          } catch (error) {
            return error instanceof Error ? error.name : 'rejected';
          }
        }, { commandId: collidingId, datasetId: 'dataset-a', uid: 'operator-a' }),
        peer.evaluate(async record => {
          try {
            await (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record);
            return 'written';
          } catch (error) {
            return error instanceof Error ? error.name : 'rejected';
          }
        }, { commandId: collidingId, datasetId: 'dataset-b', uid: 'operator-b' }),
      ]);
      expect(collisions.filter(result => result === 'written')).toHaveLength(1);
      expect(collisions.filter(result => result === 'PendingJournalUnavailableError')).toHaveLength(1);
      const collisionSnapshot = await page.evaluate(async () => (
        (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.readAll()
      ));
      expect(collisionSnapshot.total).toBe(1);
      expect(collisionSnapshot.records[0]).toMatchObject({ commandId: collidingId });

      await page.evaluate(() => localStorage.clear());
      await page.evaluate(({ keyPrefix, currentUid }) => {
        for (let index = 1; index <= 999; index += 1) {
          const commandId = `c0000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
          localStorage.setItem(`${keyPrefix}${commandId}`, JSON.stringify({
            commandId, datasetId: 'dataset-capacity', uid: currentUid,
          }));
        }
      }, { keyPrefix: prefix, currentUid: 'operator-capacity' });
      const lastWrites = await Promise.all([
        page.evaluate(async record => {
          try {
            await (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record);
            return 'written';
          } catch (error) {
            return error instanceof Error ? `${error.name}: ${error.message}` : 'rejected';
          }
        }, { commandId: 'f1111111-1111-4111-8111-111111111111', datasetId: 'dataset-capacity', uid: 'operator-a' }),
        peer.evaluate(async record => {
          try {
            await (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record);
            return 'written';
          } catch (error) {
            return error instanceof Error ? `${error.name}: ${error.message}` : 'rejected';
          }
        }, { commandId: 'f2222222-2222-4222-8222-222222222222', datasetId: 'dataset-capacity', uid: 'operator-b' }),
      ]);
      expect(lastWrites.filter(result => result === 'written'), JSON.stringify(lastWrites)).toHaveLength(1);
      expect(lastWrites.filter(result => result.startsWith('PendingJournalUnavailableError')), JSON.stringify(lastWrites)).toHaveLength(1);
      const full = await page.evaluate(async () => (
        (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.readAll()
      ));
      expect(full).toMatchObject({ total: 1000, complete: true });
      expect(full.records.filter(record => record.commandId.startsWith('f'))).toHaveLength(1);
      expect(await page.evaluate(keyPrefix => Object.keys(localStorage).filter(key => key.startsWith(keyPrefix)).length, prefix)).toBe(1000);
    } finally {
      await peer.close();
    }
  });

  test('rejects a pending async cleanup guard without blocking peer operations on real Web Locks', async ({ page }) => {
    const peer = await page.context().newPage();
    const driverUrl = 'http://127.0.0.1:4174';
    const driverApp = 'p13b2a-r2-async-guard';
    const driverProject = 'p13b2a-r2-lock-driver';
    const prefix = `easyorder-cloud-command-journal:v1:${encodeURIComponent(driverProject)}:${encodeURIComponent(driverApp)}:`;
    type BrowserIdentity = { commandId: string; datasetId: string; uid: string };
    type BrowserJournal = {
      namespace: string;
      put(record: BrowserIdentity): Promise<void>;
      readAll(): Promise<{ records: BrowserIdentity[]; total: number; complete: boolean }>;
      removeIf(record: BrowserIdentity, guard?: () => boolean): Promise<boolean>;
    };

    const installJournal = async (target: typeof page) => {
      await target.goto(driverUrl);
      await target.evaluate(async ({ appName, projectId }) => {
        const module = await import('/src/firebase/cloudPendingJournal.ts');
        const app = { name: appName, options: { projectId } };
        const journal = module.createCloudPendingJournal({ app } as never);
        (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal = journal;
      }, { appName: driverApp, projectId: driverProject });
    };

    try {
      await Promise.all([installJournal(page), installJournal(peer)]);
      await page.evaluate(keyPrefix => {
        for (const key of Object.keys(localStorage)) if (key.startsWith(keyPrefix)) localStorage.removeItem(key);
      }, prefix);
      const first = { commandId: 'b4444444-4444-4444-8444-444444444444', datasetId: 'dataset-a', uid: 'operator-a' };
      const second = { commandId: 'b5555555-5555-4555-8555-555555555555', datasetId: 'dataset-a', uid: 'operator-b' };
      await page.evaluate(async record => (
        (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal.put(record)
      ), first);

      await page.evaluate(async record => {
        const journal = (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal;
        let signalGuardStarted!: () => void;
        let releaseRemoteCheck!: (value: boolean) => void;
        const guardStarted = new Promise<void>(resolve => { signalGuardStarted = resolve; });
        const pendingRemoteCheck = new Promise<boolean>(resolve => { releaseRemoteCheck = resolve; });
        const removal = journal.removeIf(record, (() => {
          signalGuardStarted();
          return pendingRemoteCheck;
        }) as unknown as () => boolean);
        await guardStarted;
        (window as unknown as { __p13b2PendingGuard: {
          releaseRemoteCheck: (value: boolean) => void;
          removal: Promise<boolean>;
        } }).__p13b2PendingGuard = { releaseRemoteCheck, removal };
      }, first);

      const lockName = `${prefix.slice(0, -1)}:exclusive`;
      const peerObservation = await peer.evaluate(async ({ peerRecord, lockName }) => {
        const peerJournal = (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal;
        const peerWrite = peerJournal.put(peerRecord).then(() => true, () => false);
        const peerRead = peerJournal.readAll().then(snapshot => snapshot.total === 2, () => false);
        const within = (promise: Promise<boolean>): Promise<boolean> => Promise.race([
          promise,
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 250)),
        ]);
        const peerCompletedBeforeRemoteCheck = await Promise.all([within(peerWrite), within(peerRead)]);
        const locksWhileRemoteCheckPending = await navigator.locks.query();
        return {
          peerCompletedBeforeRemoteCheck,
          heldForNamespace: locksWhileRemoteCheckPending.held.some(lock => lock.name === lockName),
          peerPendingForNamespace: locksWhileRemoteCheckPending.pending.some(lock => lock.name === lockName),
        };
      }, { peerRecord: second, lockName });

      const removalObservation = await page.evaluate(async () => {
        const state = (window as unknown as { __p13b2PendingGuard: {
          releaseRemoteCheck: (value: boolean) => void;
          removal: Promise<boolean>;
        } }).__p13b2PendingGuard;
        state.releaseRemoteCheck(true);
        const removed = await state.removal;
        const journal = (window as unknown as { __p13b2BrowserJournal: BrowserJournal }).__p13b2BrowserJournal;
        const snapshot = await journal.readAll();
        return { removed, total: snapshot.total };
      });

      expect(peerObservation.peerCompletedBeforeRemoteCheck, JSON.stringify(peerObservation)).toEqual([true, true]);
      expect(peerObservation.heldForNamespace).toBe(false);
      expect(peerObservation.peerPendingForNamespace).toBe(false);
      expect(removalObservation.removed).toBe(false);
      expect(removalObservation.total).toBe(2);
    } finally {
      await page.evaluate(async keyPrefix => {
        const state = (window as unknown as { __p13b2PendingGuard?: {
          releaseRemoteCheck: (value: boolean) => void;
          removal: Promise<boolean>;
        } }).__p13b2PendingGuard;
        state?.releaseRemoteCheck(true);
        await state?.removal.catch(() => false);
        for (const key of Object.keys(localStorage)) if (key.startsWith(keyPrefix)) localStorage.removeItem(key);
      }, prefix).catch(() => undefined);
      await peer.close();
    }
  });

  test('reconnect rechecks a changed dataset before releasing the manually continued shell', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const commandId = 'd7777777-7777-4777-8777-777777777777';
    await storePendingIdentity(page, uid, commandId);
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.getByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。')).toBeVisible();
    await page.getByLabel('我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。').check();
    await page.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' }).click();
    await expect(page.locator('.cloud-app')).toBeVisible();
    const before = await readPendingIdentity(page, commandId);
    expect(before).toBe(JSON.stringify({ commandId, datasetId: DATASET_ID, uid }));

    try {
      await page.context().setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await expect(page.locator('.cloud-app').locator('..')).toHaveAttribute('inert', '');
      await upsertDocument('system', 'dataHead', {
        schemaVersion: 1,
        datasetId: 'reconnect-different-dataset',
        seq: 0,
        lastCommandId: null,
        maintenance: false,
        goLiveDate: taipeiToday(),
        updatedAt: new Date(),
      });
      await page.context().setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));

      await expect(page.getByText('原資料集與目前不同；已保留編號，需由維護者核對。')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.cloud-app')).toHaveCount(1);
      await expect(page.locator('.cloud-app').locator('..')).toHaveAttribute('inert', '');
      await expect(page.getByLabel('我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。')).toHaveCount(0);
      expect(await readPendingIdentity(page, commandId)).toBe(before);

      const receiptResponse = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/demo-easyorder/databases/(default)/documents/commands/${commandId}`, {
        headers: { Authorization: 'Bearer owner' },
      });
      expect(receiptResponse.status).toBe(404);
    } finally {
      await page.context().setOffline(false);
      await upsertDocument('system', 'dataHead', {
        schemaVersion: 1,
        datasetId: DATASET_ID,
        seq: 0,
        lastCommandId: null,
        maintenance: false,
        goLiveDate: taipeiToday(),
        updatedAt: new Date(),
      });
    }
  });

  test('same-dataset reconnect requires fresh acknowledgement and retains the original journal identity', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const commandId = 'd8888888-8888-4888-8888-888888888888';
    await storePendingIdentity(page, uid, commandId);
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.getByText('伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。')).toBeVisible();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    const confirmation = page.getByLabel('我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。');
    await confirmation.check();
    await page.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' }).click();
    await expect(page.locator('.cloud-app')).toBeVisible();
    const before = await readPendingIdentity(page, commandId);

    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await upsertDocument('system', 'accessLease', { holderUid: uid, epoch: 2, updatedAt: new Date() });
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.locator('.cloud-app')).toHaveCount(0);
    await expect(confirmation).not.toBeChecked();
    await expect(page.getByRole('button', { name: '保留編號，移交人工核對並繼續其他作業' })).toBeDisabled();
    expect(await readPendingIdentity(page, commandId)).toBe(before);

    const receiptResponse = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/demo-easyorder/databases/(default)/documents/commands/${commandId}`, {
      headers: { Authorization: 'Bearer owner' },
    });
    expect(receiptResponse.status).toBe(404);
  });

  test('rechecks the initial journal failure on the same page without a business effect', async ({ googleSession }) => {
    const { page } = googleSession;
    await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      const nativeGetItem = Storage.prototype.getItem;
      win.__p13b2R5LegacyReads = 0;
      win.__p13b2R5DocumentToken = `r5-${Date.now()}`;
      Storage.prototype.getItem = function (key: string) {
        if (key === 'easyorder-cloud-pending-order') {
          const nextRead = Number(win.__p13b2R5LegacyReads) + 1;
          win.__p13b2R5LegacyReads = nextRead;
          if (nextRead === 1) throw new DOMException('synthetic one-time journal denial', 'SecurityError');
        }
        return nativeGetItem.call(this, key);
      };
    });
    const documentToken = await page.evaluate(() => (
      (window as unknown as Record<string, unknown>).__p13b2R5DocumentToken
    ));

    const headBefore = await readEmulatorDocument('system', 'dataHead');
    const commandsBefore = await listEmulatorDocumentIds('commands');
    const transactionsBefore = await listEmulatorDocumentIds('transactions');
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    await expect(page.getByText('本機待核對日誌無法安全讀取或保存。資料未確認，已停止開放新操作；請聯絡系統維護者。')).toBeVisible();

    const retry = page.getByRole('button', { name: '重新檢查' });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(page.locator('.cloud-app')).toBeVisible();
    await expect(page.getByText('目前沒有待核對命令。')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新檢查' })).toHaveCount(0);

    const browserState = await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      return {
        documentToken: win.__p13b2R5DocumentToken,
        legacyReads: win.__p13b2R5LegacyReads,
      };
    });
    expect(browserState.documentToken).toBe(documentToken);
    expect(browserState.legacyReads).toBeGreaterThanOrEqual(2);
    expect(await readEmulatorDocument('system', 'dataHead')).toEqual(headBefore);
    expect(await listEmulatorDocumentIds('commands')).toEqual(commandsBefore);
    expect(await listEmulatorDocumentIds('transactions')).toEqual(transactionsBefore);
  });

  test('confirms a real Emulator order while the committed write response is held past ten seconds', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const studentId = 'd1000000-0000-4000-8000-000000000031';
    const studentCode = '931';
    const seedCommandId = 'd2000000-0000-4000-8000-000000000032';
    await seedOrderRecoveryFixture(uid, today, studentId, studentCode, seedCommandId);

    const gate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeGate: WriteGate | null = null;
    await page.route('**/documents:commit*', async route => {
      const current = activeGate;
      if (!current || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch();
      if (current.mode === 'after-server') {
        current.intercepted.resolve();
        await current.release.promise;
      }
      await route.fulfill({ response });
      current.completed.resolve();
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(page.getByTestId('cloud-orders-page')).toBeVisible();
      await page.getByLabel('搜尋編號、姓名或別名').fill(studentCode);
      await page.getByTestId(`search-result-${studentCode}`).click();
      await page.getByLabel('實收金額（留空為 0 元）').fill('100');
      activeGate = gate;
      await page.getByTestId('submit-order-button').click();

      const interceptResult = await Promise.race([
        gate.intercepted.promise.then(() => 'intercepted' as const),
        new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 20000)),
      ]);
      if (interceptResult === 'timeout') throw new Error('No Firestore documents:commit request was intercepted');
      await expect(page.getByText('結果確認中，勿重新收款。')).toBeVisible({ timeout: 15000 });
      commandId = await page.getByTestId('order-recovery-command-id').textContent();
      if (!commandId) throw new Error('The pending command ID was not shown');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.commandId as { stringValue?: string } | undefined)?.stringValue).toBe(commandId);
      expect(gate.requests).toBe(1);

      await page.getByTestId('order-recovery-query').click();
      await expect(page.getByText('伺服器已確認入帳，正在重新載入資料')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('order-recovery-command-id')).toHaveText(commandId);
      await expect(page.getByTestId('cloud-orders-loading')).toBeVisible();
      await expect(page.getByTestId('submit-order-button')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '學生管理' })).toBeDisabled();
      await expect(page.getByTestId('undo-bar')).toHaveCount(0);
      expect(gate.requests).toBe(1);
      gate.release.resolve();
      await gate.completed.promise;
      await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
      await expect(page.getByTestId('cloud-topbar-bento')).toContainText('1');
      await expect(page.getByText(new RegExp(`已確認 ${studentCode} P13b2b1 ${studentCode} 訂餐完成`))).toBeVisible();
      await expect(page.getByTestId('order-recovery-panel')).toHaveCount(0);
      await expect(page.getByTestId('undo-bar')).toBeVisible();
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '學生管理' })).toBeEnabled();

      const transactionId = (((receipt.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
        ?.mapValue?.fields?.transactionId as { stringValue?: string } | undefined)?.stringValue);
      if (!transactionId) throw new Error('The Emulator receipt has no transaction target');
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect(await listEmulatorDocumentIds('transactions')).toEqual([transactionId]);
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
    } finally {
      gate.release.resolve();
      if (gate.requests > 0) {
        await Promise.race([gate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      }
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      if (commandId) {
        const receipt = await readEmulatorDocument('commands', commandId).catch(() => null);
        const transactionId = (((receipt?.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
          ?.mapValue?.fields?.transactionId as { stringValue?: string } | undefined)?.stringValue);
        if (transactionId) await removeDocument('transactions', transactionId);
        await removeDocument('commands', commandId);
      }
      for (const id of await listEmulatorDocumentIds('transactions')) await removeDocument('transactions', id);
      for (const id of await listEmulatorDocumentIds('commands')) await removeDocument('commands', id);
      await removeDocument('days', today);
      await removeDocument('students', studentId);
      await removeDocument('studentCodes', studentCode);
      await upsertDocument('system', 'dataHead', {
        datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
      });
    }
  });

  test('confirms Student create through Lite, stays locked, then refreshes after the write response returns', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const seedStudentId = 'd1000000-0000-4000-8000-000000000041';
    const seedStudentCode = '930';
    const seedCommandId = 'd2000000-0000-4000-8000-000000000042';
    const studentCode = '931';
    await seedOrderRecoveryFixture(uid, today, seedStudentId, seedStudentCode, seedCommandId);

    const writeGate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    let writeResponseReturned = false;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch();
      current.intercepted.resolve();
      await current.release.promise;
      await route.fulfill({ response });
      writeResponseReturned = true;
      current.completed.resolve();
    });

    let commandId: string | null = null;
    let createdStudentId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();
      await expect(page.getByTestId(`cloud-student-row-${seedStudentCode}`)).toBeVisible();

      await page.getByRole('button', { name: '新增學生' }).click();
      const form = page.getByRole('form', { name: '新增學生' });
      await form.getByLabel('學員編號').fill(studentCode);
      await form.getByRole('textbox', { name: '姓名', exact: true }).fill('P13b2b2a 新學生');
      await form.getByRole('textbox', { name: /期初結餘（整數/ }).fill('0');
      await form.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      activeWriteGate = writeGate;
      await form.getByRole('button', { name: '建立學生' }).click();

      const intercepted = await Promise.race([
        writeGate.intercepted.promise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20000)),
      ]);
      if (!intercepted) throw new Error('Student create did not reach the Firestore Emulator commit endpoint');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const headAfterCommit = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterCommit.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The committed Student command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.commandId as { stringValue?: string } | undefined)?.stringValue).toBe(commandId);
      createdStudentId = studentTargetFromReceipt(receipt);
      expect(createdStudentId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(writeGate.requests).toBe(1);

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByText('已找到伺服器回執，名單尚待再次讀取。')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('button', { name: '重新讀取伺服器名單' })).toBeDisabled();
      await expect(page.getByRole('button', { name: '載入中…' })).toBeDisabled();
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(writeResponseReturned).toBe(false);
      expect(writeGate.requests).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);

      writeGate.release.resolve();
      await writeGate.completed.promise;
      await expect(page.getByTestId(`cloud-student-row-${studentCode}`)).toContainText('P13b2b2a 新學生');
      await expect(page.getByText(new RegExp(`已確認 新增 ${studentCode} 完成`))).toBeVisible();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeEnabled();
      expect(writeResponseReturned).toBe(true);
      expect(writeGate.requests).toBe(1);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) await removeDocument('commands', commandId);
      if (createdStudentId) await removeDocument('students', createdStudentId);
      await removeDocument('studentCodes', studentCode);
      await removeDocument('days', today);
      await removeDocument('students', seedStudentId);
      await removeDocument('studentCodes', seedStudentCode);
      await upsertDocument('system', 'dataHead', {
        datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
      });
    }
  });

  test('confirms a real Student edit through Lite and ignores the late original response', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const studentId = 'd1000000-0000-4000-8000-000000000061';
    const studentCode = '932';
    const seedCommandId = 'd2000000-0000-4000-8000-000000000062';
    await seedOrderRecoveryFixture(uid, today, studentId, studentCode, seedCommandId);

    const writeGate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    let writeResponseReturned = false;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch();
      current.intercepted.resolve();
      await current.release.promise;
      await route.fulfill({ response });
      writeResponseReturned = true;
      current.completed.resolve();
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      const row = page.getByTestId(`cloud-student-row-${studentCode}`);
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: '編輯姓名與別名' }).click();
      const form = row.getByRole('form', { name: `編輯學生 ${studentCode}` });
      await form.getByLabel('姓名').fill('P13b2b2a 已更名');
      await form.getByLabel('別名').fill('恢復核對別名');
      activeWriteGate = writeGate;
      await form.getByRole('button', { name: '儲存姓名與別名' }).click();

      const intercepted = await Promise.race([
        writeGate.intercepted.promise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20000)),
      ]);
      if (!intercepted) throw new Error('Student edit did not reach the Firestore Emulator commit endpoint');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      commandId = (await readEmulatorDocument('system', 'dataHead')).fields?.lastCommandId
        ? (((await readEmulatorDocument('system', 'dataHead')).fields?.lastCommandId as { stringValue?: string }).stringValue ?? null)
        : null;
      if (!commandId) throw new Error('The committed Student edit command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.kind as { stringValue?: string } | undefined)?.stringValue).toBe('EditStudent');
      expect(studentTargetFromReceipt(receipt)).toBe(studentId);

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByText('已找到伺服器回執，名單尚待再次讀取。')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('button', { name: '重新讀取伺服器名單' })).toBeDisabled();
      await expect(page.getByRole('button', { name: '載入中…' })).toBeDisabled();
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(writeResponseReturned).toBe(false);
      expect(writeGate.requests).toBe(1);

      writeGate.release.resolve();
      await writeGate.completed.promise;
      await expect(page.getByTestId(`cloud-student-row-${studentCode}`)).toContainText('P13b2b2a 已更名');
      await expect(page.getByText(new RegExp(`已確認 修改 ${studentCode} 完成`))).toBeVisible();
      expect(writeResponseReturned).toBe(true);
      expect(writeGate.requests).toBe(1);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) await removeDocument('commands', commandId);
      await removeDocument('days', today);
      await removeDocument('students', studentId);
      await removeDocument('studentCodes', studentCode);
      await upsertDocument('system', 'dataHead', {
        datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
      });
    }
  });

  test('does not enable retry when a successful Lite read finds no Student receipt while the write is still in flight', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const seedStudentId = 'd1000000-0000-4000-8000-000000000051';
    const seedStudentCode = '940';
    const seedCommandId = 'd2000000-0000-4000-8000-000000000052';
    const studentCode = '941';
    await seedOrderRecoveryFixture(uid, today, seedStudentId, seedStudentCode, seedCommandId);

    const writeGate: WriteGate = {
      mode: 'before-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      current.requests += 1;
      current.intercepted.resolve();
      await current.release.promise;
      const response = await route.fetch();
      await route.fulfill({ response });
      current.completed.resolve();
    });

    let commandId: string | null = null;
    let createdStudentId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '新增學生' }).click();
      const form = page.getByRole('form', { name: '新增學生' });
      await form.getByLabel('學員編號').fill(studentCode);
      await form.getByRole('textbox', { name: '姓名', exact: true }).fill('P13b2b2a 尚未送達');
      await form.getByRole('textbox', { name: /期初結餘（整數/ }).fill('0');
      await form.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      activeWriteGate = writeGate;
      await form.getByRole('button', { name: '建立學生' }).click();
      const intercepted = await Promise.race([
        writeGate.intercepted.promise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20000)),
      ]);
      if (!intercepted) throw new Error('Student create did not reach the Firestore Emulator commit endpoint');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const headBeforeRelease = await readEmulatorDocument('system', 'dataHead');
      commandId = (headBeforeRelease.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      expect(commandId).toBeNull();

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByText(/原命令仍在送出中；目前不能重試/)).toBeVisible();
      await expect(page.getByRole('button', { name: '以相同命令編號重試' })).toHaveCount(0);
      expect(writeGate.requests).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([]);

      writeGate.release.resolve();
      await writeGate.completed.promise;
      await expect(page.getByTestId(`cloud-student-row-${studentCode}`)).toContainText('P13b2b2a 尚未送達');
      expect(writeGate.requests).toBe(1);
      const headAfterRelease = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterRelease.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The original Student command did not commit after the route was released');
      createdStudentId = studentTargetFromReceipt(await readEmulatorDocument('commands', commandId));
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect((headAfterRelease.fields?.seq as { integerValue?: string } | undefined)?.integerValue).toBe('1');
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) await removeDocument('commands', commandId);
      if (createdStudentId) await removeDocument('students', createdStudentId);
      await removeDocument('studentCodes', studentCode);
      await removeDocument('days', today);
      await removeDocument('students', seedStudentId);
      await removeDocument('studentCodes', seedStudentCode);
      await upsertDocument('system', 'dataHead', {
        datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
      });
    }
  });

  test('keeps the confirmed Student operation locked when its fresh list switches datasets', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const seedStudentId = 'd1000000-0000-4000-8000-000000000071';
    const seedStudentCode = '942';
    const seedCommandId = 'd2000000-0000-4000-8000-000000000072';
    const studentCode = '943';
    await seedOrderRecoveryFixture(uid, today, seedStudentId, seedStudentCode, seedCommandId);

    const writeGate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    let writeResponseReturned = false;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch();
      current.intercepted.resolve();
      await current.release.promise;
      await route.fulfill({ response });
      writeResponseReturned = true;
      current.completed.resolve();
    });

    let commandId: string | null = null;
    let createdStudentId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();
      await expect(page.getByTestId(`cloud-student-row-${seedStudentCode}`)).toBeVisible();

      await page.getByRole('button', { name: '新增學生' }).click();
      const form = page.getByRole('form', { name: '新增學生' });
      await form.getByLabel('學員編號').fill(studentCode);
      await form.getByRole('textbox', { name: '姓名', exact: true }).fill('P13b2b2a Dataset A 新學生');
      await form.getByRole('textbox', { name: /期初結餘（整數/ }).fill('0');
      await form.getByRole('radio', { name: /沿用既有核對結餘/ }).check();
      activeWriteGate = writeGate;
      await form.getByRole('button', { name: '建立學生' }).click();

      const intercepted = await Promise.race([
        writeGate.intercepted.promise.then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20000)),
      ]);
      if (!intercepted) throw new Error('Student create did not reach the Firestore Emulator commit endpoint');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const headAfterCommit = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterCommit.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The committed Student command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.commandId as { stringValue?: string } | undefined)?.stringValue).toBe(commandId);
      createdStudentId = studentTargetFromReceipt(receipt);
      expect(createdStudentId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(writeGate.requests).toBe(1);

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByText('已找到伺服器回執，名單尚待再次讀取。')).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(writeResponseReturned).toBe(false);
      expect(writeGate.requests).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);

      // The receipt and journal cleanup are valid for A. A new head makes the held full-SDK list B.
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
      await upsertDocument('system', 'dataHead', {
        datasetId: 'p13b2b2a-replacement-dataset', seq: 1, lastCommandId: commandId, maintenance: false, goLiveDate: today,
      });
      writeGate.release.resolve();
      await writeGate.completed.promise;

      const recovery = page.getByRole('alert', { name: '命令結果確認' });
      await expect(recovery).toBeVisible();
      await expect(recovery).toContainText(commandId);
      await expect(recovery).toContainText('伺服器命令序號 1');
      await expect(page.getByText(/資料集已變更/)).toBeVisible();
      await expect(page.getByTestId(`cloud-student-row-${studentCode}`)).toHaveCount(0);
      await expect(page.getByRole('button', { name: '新增學生' })).toHaveCount(0);
      await expect(page.getByText(new RegExp(`已確認 新增 ${studentCode} 完成`))).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(writeResponseReturned).toBe(true);
      expect(writeGate.requests).toBe(1);

      await page.getByRole('button', { name: '重新讀取伺服器名單' }).click();
      await expect(page.getByText(/資料集已變更/)).toBeVisible();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toContainText(commandId);
      await expect(page.getByTestId(`cloud-student-row-${studentCode}`)).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect(await readPendingIdentity(page, commandId)).toBeNull();
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) await removeDocument('commands', commandId);
      if (createdStudentId) await removeDocument('students', createdStudentId);
      await removeDocument('studentCodes', studentCode);
      await removeDocument('days', today);
      await removeDocument('students', seedStudentId);
      await removeDocument('studentCodes', seedStudentCode);
      await upsertDocument('system', 'dataHead', {
        datasetId: DATASET_ID, seq: 0, lastCommandId: null, maintenance: false, goLiveDate: today,
      });
    }
  });

  test('confirms SetOpeningCash through the registered Lite reader and waits for a same-dataset/day full snapshot', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2b-day-vendor-opening';
    const { vendorId } = await seedDayVendorRecoveryFixture(today, datasetId);
    const writeGate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    let writeResponseReturned = false;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST' || !commitWritesDocument(route.request(), 'days', today)) {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch({ timeout: 30000 });
      current.intercepted.resolve();
      await current.release.promise;
      await route.fulfill({ response });
      writeResponseReturned = true;
      current.completed.resolve();
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const openingForm = main.getByRole('form', { name: `${today} 開帳現金` });
      await expect(openingForm).toBeVisible();
      await expect(openingForm.getByRole('button', { name: '確認開帳金額' })).toBeEnabled({ timeout: 15000 });
      await openingForm.getByLabel(/開帳現金/).fill('250');
      activeWriteGate = writeGate;
      await openingForm.getByRole('button', { name: '確認開帳金額' }).click();

      await waitForWriteGate(writeGate.intercepted.promise, 'SetOpeningCash commit response gate');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const headAfterCommit = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterCommit.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The committed SetOpeningCash command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.commandId as { stringValue?: string } | undefined)?.stringValue).toBe(commandId);
      expect((receipt.fields?.kind as { stringValue?: string } | undefined)?.stringValue).toBe('SetOpeningCash');
      expect((receipt.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
        ?.mapValue?.fields?.dayId).toEqual({ stringValue: today });
      expect(writeGate.requests).toBe(1);
      expect((headAfterCommit.fields?.seq as { integerValue?: string } | undefined)?.integerValue).toBe('1');

      const tracked = JSON.parse((await readPendingIdentity(page, commandId))!) as Record<string, unknown>;
      expect(Object.keys(tracked).sort()).toEqual(['commandId', 'datasetId', 'uid']);
      expect(tracked).toEqual({ commandId, datasetId, uid });

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      const recovery = page.getByRole('alert', { name: '命令結果確認' });
      await expect(recovery).toContainText('已找到伺服器回執，資料尚待再次讀取。');
      await expect(recovery.getByRole('button', { name: '重新讀取伺服器資料' })).toBeDisabled();
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(writeResponseReturned).toBe(false);
      expect(writeGate.requests).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);

      writeGate.release.resolve();
      await waitForWriteGate(writeGate.completed.promise, 'SetOpeningCash response release');
      await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 250/)).toBeVisible();
      await expect(page.getByText(new RegExp(`已確認 確認 ${today} 開帳現金 完成`))).toBeVisible();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toHaveCount(0);
      expect(writeResponseReturned).toBe(true);
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();

      await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 250/)).toBeVisible();
      expect(writeGate.requests).toBe(1);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect((await readEmulatorDocument('days', today)).fields?.openingCash).toEqual({ integerValue: '250' });
      expect(await readPendingIdentity(page, commandId)).toBeNull();
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) {
        await removeDocument('commands', commandId);
        await page.evaluate(({ namespace, pendingCommandId }) => localStorage.removeItem(`${namespace}:${pendingCommandId}`), {
          namespace: APP_NAMESPACE, pendingCommandId: commandId,
        });
      }
      await removeDocument('days', today);
      await removeDocument('vendors', vendorId);
      await setDayVendorDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('revokes a confirmed opening operation before the held response when cleanup finds a new same-UID epoch', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2b-day-vendor-opening';
    const { vendorId } = await seedDayVendorRecoveryFixture(today, datasetId);
    const writeGate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    let writeResponseReturned = false;
    let recoveryLeaseReads = 0;
    let enableLeaseChange = false;
    const leaseChanged = deferred();

    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST' || !commitWritesDocument(route.request(), 'days', today)) {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch({ timeout: 30000 });
      current.intercepted.resolve();
      await current.release.promise;
      await route.fulfill({ response });
      writeResponseReturned = true;
      current.completed.resolve();
    });

    await page.route('**/documents:batchGet*', async route => {
      const body = route.request().postDataJSON() as { documents?: string[] };
      if (enableLeaseChange && body.documents?.some(name => name.endsWith('/system/accessLease'))) {
        recoveryLeaseReads += 1;
        if (recoveryLeaseReads === 3) {
          await seedAccessLease({ holderUid: uid, epoch: 2, updatedAt: new Date() });
          leaseChanged.resolve();
        }
      }
      await route.continue();
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const openingForm = main.getByRole('form', { name: `${today} 開帳現金` });
      await expect(openingForm).toBeVisible();
      await expect(openingForm.getByRole('button', { name: '確認開帳金額' })).toBeEnabled({ timeout: 15000 });
      await openingForm.getByLabel(/開帳現金/).fill('250');
      activeWriteGate = writeGate;
      await openingForm.getByRole('button', { name: '確認開帳金額' }).click();

      await waitForWriteGate(writeGate.intercepted.promise, 'SetOpeningCash commit response gate');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const headAfterCommit = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterCommit.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The committed SetOpeningCash command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.commandId as { stringValue?: string } | undefined)?.stringValue).toBe(commandId);
      expect((receipt.fields?.kind as { stringValue?: string } | undefined)?.stringValue).toBe('SetOpeningCash');
      expect((receipt.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
        ?.mapValue?.fields?.dayId).toEqual({ stringValue: today });
      expect((headAfterCommit.fields?.seq as { integerValue?: string } | undefined)?.integerValue).toBe('1');
      expect(writeGate.requests).toBe(1);
      expect(writeResponseReturned).toBe(false);
      expect(JSON.parse((await readPendingIdentity(page, commandId))!)).toEqual({ commandId, datasetId, uid });

      enableLeaseChange = true;
      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await waitForWriteGate(leaseChanged.promise, 'cleanup context epoch switch');
      try {
        await expect.poll(async () => {
          const pageHidden = await page.getByRole('main', { name: '雲端日期設定與供應商管理' }).count() === 0;
          const revoked = await page.getByText('使用權已變更；敏感操作內容已清除。').isVisible().catch(() => false);
          return pageHidden || revoked;
        }).toBe(true);
      } catch (error) {
        console.log('DayVendor cleanup epoch before response release', JSON.stringify({
          recoveryLeaseReads,
          writeResponseReturned,
          serverLease: await readEmulatorDocument('system', 'accessLease'),
          body: await page.locator('body').innerText(),
        }));
        throw error;
      }

      expect(recoveryLeaseReads).toBe(3);
      expect(writeResponseReturned).toBe(false);
      expect(writeGate.requests).toBe(1);
      if (await page.getByRole('main', { name: '雲端日期設定與供應商管理' }).count()) {
        const recovery = page.getByRole('alert', { name: '命令結果確認' });
        await expect(recovery).toContainText(commandId);
        await expect(recovery).not.toContainText('開帳現金');
      }
      expect(JSON.parse((await readPendingIdentity(page, commandId))!)).toEqual({ commandId, datasetId, uid });

      writeGate.release.resolve();
      await waitForWriteGate(writeGate.completed.promise, 'SetOpeningCash response release');
      await expect.poll(async () => {
        const pageHidden = await page.getByRole('main', { name: '雲端日期設定與供應商管理' }).count() === 0;
        const revoked = await page.getByText('使用權已變更；敏感操作內容已清除。').isVisible().catch(() => false);
        return pageHidden || revoked;
      }).toBe(true);
      expect(writeGate.requests).toBe(1);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect((await readEmulatorDocument('days', today)).fields?.openingCash).toEqual({ integerValue: '250' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      await page.unroute('**/documents:batchGet*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) {
        await removeDocument('commands', commandId);
        await page.evaluate(({ namespace, pendingCommandId }) => localStorage.removeItem(`${namespace}:${pendingCommandId}`), {
          namespace: APP_NAMESPACE, pendingCommandId: commandId,
        });
      }
      await removeDocument('days', today);
      await removeDocument('vendors', vendorId);
      await setDayVendorDataHead(DATASET_ID, today, 0, null);
      await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
    }
  });

  test('keeps the confirmed opening result when real journal removal fails', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2b-day-vendor-opening';
    const { vendorId } = await seedDayVendorRecoveryFixture(today, datasetId);
    let openingWrites = 0;

    await page.route('**/documents:commit*', async route => {
      if (route.request().method() === 'POST' && commitWritesDocument(route.request(), 'days', today)) openingWrites += 1;
      await route.continue();
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const openingForm = main.getByRole('form', { name: `${today} 開帳現金` });
      await expect(openingForm).toBeVisible();
      await expect(openingForm.getByRole('button', { name: '確認開帳金額' })).toBeEnabled({ timeout: 15000 });

      await page.evaluate(namespace => {
        const win = window as unknown as Record<string, unknown>;
        const original = Storage.prototype.removeItem;
        win.__p13b2NativeRemoveItem = original;
        Storage.prototype.removeItem = function (key: string) {
          if (key.startsWith(`${namespace}:`)) throw new DOMException('synthetic journal cleanup denial', 'SecurityError');
          return original.call(this, key);
        };
      }, APP_NAMESPACE);

      await openingForm.getByLabel(/開帳現金/).fill('250');
      await openingForm.getByRole('button', { name: '確認開帳金額' }).click();
      await expect(page.getByText(new RegExp(`已確認 確認 ${today} 開帳現金 完成`))).toBeVisible();
      await expect(page.getByText('本機命令追蹤清理未完成；伺服器回執仍已確認。')).toBeVisible();
      await expect(openingForm.getByText(/伺服器已確認開帳現金 NT\$ 250/)).toBeVisible();

      const head = await readEmulatorDocument('system', 'dataHead');
      commandId = (head.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The confirmed SetOpeningCash command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.kind as { stringValue?: string } | undefined)?.stringValue).toBe('SetOpeningCash');
      expect((head.fields?.seq as { integerValue?: string } | undefined)?.integerValue).toBe('1');
      expect((await readEmulatorDocument('days', today)).fields?.openingCash).toEqual({ integerValue: '250' });
      expect(openingWrites).toBe(1);
      expect(JSON.parse((await readPendingIdentity(page, commandId))!)).toEqual({ commandId, datasetId, uid });
    } finally {
      await page.evaluate(() => {
        const win = window as unknown as Record<string, unknown>;
        const original = win.__p13b2NativeRemoveItem as ((key: string) => void) | undefined;
        if (original) Storage.prototype.removeItem = original;
        delete win.__p13b2NativeRemoveItem;
      }).catch(() => undefined);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) {
        await removeDocument('commands', commandId);
        await page.evaluate(({ namespace, pendingCommandId }) => localStorage.removeItem(`${namespace}:${pendingCommandId}`), {
          namespace: APP_NAMESPACE, pendingCommandId: commandId,
        });
      }
      await removeDocument('days', today);
      await removeDocument('vendors', vendorId);
      await setDayVendorDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('keeps a confirmed DayMenu receipt locked when its fresh full read changes from dataset A to B', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetA = 'p13b2b2b-day-vendor-a';
    const datasetB = 'p13b2b2b-day-vendor-b';
    const { vendorId } = await seedDayVendorRecoveryFixture(today, datasetA);
    const writeGate: WriteGate = {
      mode: 'after-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    let writeResponseReturned = false;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST' || !commitWritesDocument(route.request(), 'days', today)) {
        await route.continue();
        return;
      }
      current.requests += 1;
      const response = await route.fetch({ timeout: 30000 });
      current.intercepted.resolve();
      await current.release.promise;
      await route.fulfill({ response });
      writeResponseReturned = true;
      current.completed.resolve();
    });
    let commandId: string | null = null;

    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      const menuForm = main.getByRole('form', { name: `${today} 菜單` });
      await expect(menuForm).toBeVisible();
      await menuForm.getByLabel('菜單名稱').fill('P13b2b2b Dataset A 菜單');
      await menuForm.getByLabel('價格（新臺幣整數）').fill('165');
      await menuForm.getByLabel('供應商').selectOption(vendorId);
      activeWriteGate = writeGate;
      await menuForm.getByRole('button', { name: '儲存菜單' }).click();

      await waitForWriteGate(writeGate.intercepted.promise, 'SetDayMenu commit response gate');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const headAfterCommit = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterCommit.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null;
      if (!commandId) throw new Error('The committed SetDayMenu command ID was not visible in dataHead');
      const receipt = await readEmulatorDocument('commands', commandId);
      expect((receipt.fields?.kind as { stringValue?: string } | undefined)?.stringValue).toBe('SetDayMenu');
      expect(writeGate.requests).toBe(1);
      expect(JSON.parse((await readPendingIdentity(page, commandId))!)).toEqual({ commandId, datasetId: datasetA, uid });

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toContainText('已找到伺服器回執，資料尚待再次讀取。');
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
      await setDayVendorDataHead(datasetB, today, 1, commandId);
      writeGate.release.resolve();
      await waitForWriteGate(writeGate.completed.promise, 'SetDayMenu response release');

      const recovery = page.getByRole('alert', { name: '命令結果確認' });
      await expect(recovery).toContainText(commandId);
      await expect(recovery).toContainText('伺服器命令序號 1');
      await expect(page.locator('.cloud-day-vendors__alert')).toContainText(/伺服器資料集或營業日已變更/);
      await expect(page.getByRole('heading', { name: `${today} 營業日` })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      await expect(page.getByText(new RegExp(`已確認 設定 ${today} 菜單 完成`))).toHaveCount(0);
      expect(writeResponseReturned).toBe(true);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.datasetId).toEqual({ stringValue: datasetB });

      await page.getByRole('button', { name: '重新載入伺服器資料' }).click();
      await expect(page.getByText(/伺服器資料集或營業日已變更/)).toBeVisible();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toContainText(commandId);
      await expect(page.getByRole('heading', { name: `${today} 營業日` })).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(await readPendingIdentity(page, commandId)).toBeNull();

      expect(writeResponseReturned).toBe(true);
      expect(writeGate.requests).toBe(1);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) {
        await removeDocument('commands', commandId);
        await page.evaluate(({ namespace, pendingCommandId }) => localStorage.removeItem(`${namespace}:${pendingCommandId}`), {
          namespace: APP_NAMESPACE, pendingCommandId: commandId,
        });
      }
      await removeDocument('days', today);
      await removeDocument('vendors', vendorId);
      await setDayVendorDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('does not retry a DayVendor while its first commit is in flight and Lite has no receipt', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2b-day-vendor-pending';
    const { vendorId } = await seedDayVendorRecoveryFixture(today, datasetId);
    const writeGate: WriteGate = {
      mode: 'before-server', intercepted: deferred(), release: deferred(), completed: deferred(), requests: 0,
    };
    let activeWriteGate: WriteGate | null = null;
    await page.route('**/documents:commit*', async route => {
      const current = activeWriteGate;
      if (!current || route.request().method() !== 'POST'
        || !commitWritesDocument(route.request(), 'vendors', 'p13b2b2b-not-found-vendor')) {
        await route.continue();
        return;
      }
      current.requests += 1;
      current.intercepted.resolve();
      await current.release.promise;
      const response = await route.fetch({ timeout: 30000 });
      await route.fulfill({ response });
      current.completed.resolve();
    });

    let commandId: string | null = null;
    try {
      await page.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await page.getByRole('button', { name: '日期與供應商' }).click();
      const main = page.getByRole('main', { name: '雲端日期設定與供應商管理' });
      await page.getByRole('button', { name: '新增供應商' }).click();
      const form = main.getByRole('form', { name: '新增供應商' });
      await form.getByLabel('供應商編號').fill('p13b2b2b-not-found-vendor');
      await form.getByLabel('供應商名稱').fill('P13b2b2b 查無回執');
      activeWriteGate = writeGate;
      await form.getByRole('button', { name: '建立供應商' }).click();

      await waitForWriteGate(writeGate.intercepted.promise, 'DayVendor create commit gate');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const alert = page.getByRole('alert', { name: '命令結果確認' });
      const match = (await alert.textContent())?.match(/命令編號 ([0-9a-f-]{36})/i);
      commandId = match?.[1] ?? null;
      if (!commandId) throw new Error('The pending DayVendor command ID was not shown');
      const tracked = JSON.parse((await readPendingIdentity(page, commandId))!) as Record<string, unknown>;
      expect(tracked).toEqual({ commandId, datasetId, uid });

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByText(/查詢尚未找到回執，但原命令仍在送出中/)).toBeVisible({ timeout: 15000 });
      await expect(alert).toContainText(commandId);
      await expect(page.getByRole('button', { name: '以相同命令編號重試' })).toHaveCount(0);
      expect(writeGate.requests).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([]);

      writeGate.release.resolve();
      await waitForWriteGate(writeGate.completed.promise, 'DayVendor create response release');
      await expect(page.getByTestId('cloud-vendor-row-p13b2b2b-not-found-vendor')).toContainText('P13b2b2b 查無回執');
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toHaveCount(0);
      expect(writeGate.requests).toBe(1);
      const headAfterCommit = await readEmulatorDocument('system', 'dataHead');
      commandId = (headAfterCommit.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? commandId;
      expect((headAfterCommit.fields?.seq as { integerValue?: string } | undefined)?.integerValue).toBe('1');
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
      expect(await readPendingIdentity(page, commandId)).toBeNull();
    } finally {
      writeGate.release.resolve();
      if (writeGate.requests > 0) await Promise.race([writeGate.completed.promise, new Promise(resolve => setTimeout(resolve, 5000))]);
      await page.unroute('**/documents:commit*');
      const release = page.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' });
      if (await release.isVisible().catch(() => false)) await release.click();
      commandId ??= (((await readEmulatorDocument('system', 'dataHead').catch(() => null))?.fields?.lastCommandId as { stringValue?: string } | undefined)?.stringValue ?? null);
      if (commandId) {
        await removeDocument('commands', commandId);
        await page.evaluate(({ namespace, pendingCommandId }) => localStorage.removeItem(`${namespace}:${pendingCommandId}`), {
          namespace: APP_NAMESPACE, pendingCommandId: commandId,
        });
      }
      await removeDocument('vendors', 'p13b2b2b-not-found-vendor');
      await removeDocument('days', today);
      await removeDocument('vendors', vendorId);
      await setDayVendorDataHead(DATASET_ID, today, 0, null);
    }
  });
});

test.describe('P13b2b2c DayClose command and backfill-step recovery', () => {
  async function openDayClose(page: Page) {
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    await page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '日結', exact: true }).click();
  }

  async function submitHeldClose(page: Page, today: string, held: ReturnType<typeof createHeldCommit>) {
    const form = page.getByRole('form', { name: `${today} 關帳`, exact: true });
    await expect(form).toBeVisible();
    await form.getByRole('textbox', { name: '實點現金（元）' }).fill('1000');
    held.arm();
    await form.getByRole('button', { name: '確認關帳' }).click();
    await waitForWriteGate(held.state.intercepted.promise, 'CloseDay commit response gate');
    await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
    const commandId = await lastCommandIdFromHead();
    if (!commandId) throw new Error('The committed CloseDay command ID was not visible in dataHead');
    return commandId;
  }

  async function expectOneCloseEffect(today: string, commandId: string) {
    const receipt = await readEmulatorDocument('commands', commandId);
    expect((receipt.fields?.kind as { stringValue?: string } | undefined)?.stringValue).toBe('CloseDay');
    expect((receipt.fields?.targets as { mapValue?: { fields?: Record<string, unknown> } } | undefined)
      ?.mapValue?.fields?.dayId).toEqual({ stringValue: today });
    expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '1' });
    expect((await readEmulatorDocument('days', today)).fields?.status).toEqual({ stringValue: 'closed' });
    expect(await listEmulatorDocumentIds(`days/${today}/settlements`)).toEqual(['1']);
    expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
  }

  test('confirms a real CloseDay through the registered Lite reader while the response is held past ten seconds', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2c-day-close';
    await seedDayCloseFixture(today, uid, datasetId);
    const held = createHeldCommit(page, request => commitWritesDocument(request, 'days', today));
    await held.install();
    let commandId: string | null = null;
    try {
      await openDayClose(page);
      commandId = await submitHeldClose(page, today, held);
      await expectMinimalJournal(page, [{ commandId, datasetId, uid }]);
      expect(await rawStorageDump(page)).not.toContain('實點');
      expect(held.state.matched).toBe(1);

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      const recovery = page.getByRole('alert', { name: '命令結果確認' });
      await expect(recovery).toContainText('已找到伺服器回執，資料尚待再次讀取。');
      await expect(recovery.getByRole('button', { name: '重新讀取伺服器資料' })).toBeDisabled();
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();
      expect(held.state.returned).toBe(false);
      expect(held.state.matched).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);

      held.state.release.resolve();
      await waitForWriteGate(held.state.completed.promise, 'CloseDay response release');
      await expect(page.getByText(new RegExp(`已確認 ${today} 關帳 完成`))).toBeVisible();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toHaveCount(0);
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
      await expect(page.getByRole('form', { name: `${today} 關帳`, exact: true })).toHaveCount(0);
      expect(held.state.matched).toBe(1);
      await expectOneCloseEffect(today, commandId);
    } finally {
      await held.settle();
      await cleanupDayCloseRun(page, { commandIds: commandId ? [commandId] : [], days: [today], settlementDays: [today] });
      await setDayCloseDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('keeps a confirmed CloseDay receipt locked when its fresh full read changes from dataset A to B', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetA = 'p13b2b2c-close-a';
    const datasetB = 'p13b2b2c-close-b';
    await seedDayCloseFixture(today, uid, datasetA);
    const held = createHeldCommit(page, request => commitWritesDocument(request, 'days', today));
    await held.install();
    let commandId: string | null = null;
    try {
      await openDayClose(page);
      commandId = await submitHeldClose(page, today, held);
      await expectMinimalJournal(page, [{ commandId, datasetId: datasetA, uid }]);

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toContainText('已找到伺服器回執，資料尚待再次讀取。');
      // The legitimately cleaned journal entry is not recreated by what follows.
      await expect.poll(() => readPendingIdentity(page, commandId!)).toBeNull();
      await setDayCloseDataHead(datasetB, today, 1, commandId);
      held.state.release.resolve();
      await waitForWriteGate(held.state.completed.promise, 'CloseDay response release');

      const recovery = page.getByRole('alert', { name: '命令結果確認' });
      await expect(recovery).toContainText(commandId);
      await expect(recovery).toContainText('伺服器命令序號 1');
      await expect(page.getByText(/伺服器資料集或營業日已變更/).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: `${today} 日結` })).toHaveCount(0);
      await expect(page.getByText(new RegExp(`已確認 ${today} 關帳 完成`))).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: '雲端資料管理' }).getByRole('button', { name: '櫃台點餐' })).toBeDisabled();

      await page.getByRole('button', { name: '重新載入伺服器資料' }).first().click();
      await expect(page.getByText(/伺服器資料集或營業日已變更/).first()).toBeVisible();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toContainText(commandId);
      await expect(page.getByRole('heading', { name: `${today} 日結` })).toHaveCount(0);
      expect(await readPendingIdentity(page, commandId)).toBeNull();
      expect(held.state.matched).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([commandId]);
    } finally {
      await held.settle();
      await cleanupDayCloseRun(page, { commandIds: commandId ? [commandId] : [], days: [today], settlementDays: [today] });
      await setDayCloseDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('revokes a confirmed CloseDay before the held response when cleanup finds a new same-UID epoch', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2c-close-epoch';
    await seedDayCloseFixture(today, uid, datasetId);
    const held = createHeldCommit(page, request => commitWritesDocument(request, 'days', today));
    await held.install();
    let leaseReads = 0;
    let enableLeaseChange = false;
    const leaseChanged = deferred();
    await page.route('**/documents:batchGet*', async route => {
      const body = route.request().postDataJSON() as { documents?: string[] };
      if (enableLeaseChange && body.documents?.some(name => name.endsWith('/system/accessLease'))) {
        leaseReads += 1;
        if (leaseReads === 3) {
          await seedAccessLease({ holderUid: uid, epoch: 2, updatedAt: new Date() });
          leaseChanged.resolve();
        }
      }
      await route.continue();
    });
    let commandId: string | null = null;
    try {
      await openDayClose(page);
      commandId = await submitHeldClose(page, today, held);
      await expectMinimalJournal(page, [{ commandId, datasetId, uid }]);

      enableLeaseChange = true;
      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await waitForWriteGate(leaseChanged.promise, 'cleanup context epoch switch');
      const lost = async () => {
        const pageHidden = await page.locator('main.cloud-day-close').count() === 0;
        const revoked = await page.getByText('使用權已變更；操作內容已清除。').isVisible().catch(() => false)
          || await page.getByText(/授權狀態已失效/).isVisible().catch(() => false);
        return pageHidden || revoked;
      };
      await expect.poll(lost).toBe(true);
      expect(leaseReads).toBe(3);
      expect(held.state.returned).toBe(false);
      expect(held.state.matched).toBe(1);
      // The accepted journal entry survives; no confirmed notice and no refreshed data were shown.
      await expect(page.getByText(new RegExp(`已確認 ${today} 關帳 完成`))).toHaveCount(0);
      expect(JSON.parse((await readPendingIdentity(page, commandId))!)).toEqual({ commandId, datasetId, uid });

      held.state.release.resolve();
      await waitForWriteGate(held.state.completed.promise, 'CloseDay response release');
      await expect.poll(lost).toBe(true);
      await expect(page.getByText(new RegExp(`已確認 ${today} 關帳 完成`))).toHaveCount(0);
      expect(held.state.matched).toBe(1);
      await expectOneCloseEffect(today, commandId);
    } finally {
      await held.settle();
      await page.unroute('**/documents:batchGet*').catch(() => undefined);
      await cleanupDayCloseRun(page, { commandIds: commandId ? [commandId] : [], days: [today], settlementDays: [today] });
      await setDayCloseDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('keeps the confirmed CloseDay result when real journal removal fails', async ({ googleSession }) => {
    test.setTimeout(120000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const datasetId = 'p13b2b2c-close-local-remove';
    await seedDayCloseFixture(today, uid, datasetId);
    let closeWrites = 0;
    await page.route('**/documents:commit*', async route => {
      if (route.request().method() === 'POST' && commitWritesDocument(route.request(), 'days', today)) closeWrites += 1;
      await route.continue();
    });
    let commandId: string | null = null;
    try {
      await openDayClose(page);
      const form = page.getByRole('form', { name: `${today} 關帳`, exact: true });
      await expect(form).toBeVisible();
      await page.evaluate(namespace => {
        const win = window as unknown as Record<string, unknown>;
        const original = Storage.prototype.removeItem;
        win.__p13b2NativeRemoveItem = original;
        Storage.prototype.removeItem = function (key: string) {
          if (key.startsWith(`${namespace}:`)) throw new DOMException('synthetic journal cleanup denial', 'SecurityError');
          return original.call(this, key);
        };
      }, APP_NAMESPACE);
      await form.getByRole('textbox', { name: '實點現金（元）' }).fill('1000');
      await form.getByRole('button', { name: '確認關帳' }).click();
      await expect(page.getByText(new RegExp(`已確認 ${today} 關帳 完成`))).toBeVisible();
      await expect(page.getByText('本機命令追蹤清理未完成；伺服器回執仍已確認。')).toBeVisible();
      commandId = await lastCommandIdFromHead();
      if (!commandId) throw new Error('The confirmed CloseDay command ID was not visible in dataHead');
      expect(closeWrites).toBe(1);
      await expectOneCloseEffect(today, commandId);
      expect(JSON.parse((await readPendingIdentity(page, commandId))!)).toEqual({ commandId, datasetId, uid });
    } finally {
      await page.evaluate(() => {
        const win = window as unknown as Record<string, unknown>;
        const original = win.__p13b2NativeRemoveItem as ((key: string) => void) | undefined;
        if (original) Storage.prototype.removeItem = original;
        delete win.__p13b2NativeRemoveItem;
      }).catch(() => undefined);
      await page.unroute('**/documents:commit*').catch(() => undefined);
      await cleanupDayCloseRun(page, { commandIds: commandId ? [commandId] : [], days: [today], settlementDays: [today] });
      await setDayCloseDataHead(DATASET_ID, today, 0, null);
    }
  });

  test('does not start the next backfill step while the first step response is held, then completes each step once', async ({ googleSession }) => {
    test.setTimeout(180000);
    const { page, uid } = googleSession;
    const today = taipeiToday();
    const gap = shiftBusinessDate(today, -2);
    const datasetId = 'p13b2b2c-backfill';
    const sentinelReason = 'P13b2b2c 斷線回填原因';
    await upsertDocument('days', today, {
      status: 'open', revision: 1, menu: null,
      openingCash: null, openedBy: null, openedAt: null,
      totals: ZERO_TOTALS, lastSettlementRevision: 0, lastCommandId: 'd4000000-0000-4000-8000-000000000002', updatedAt: new Date(),
    });
    await setDayCloseDataHead(datasetId, shiftBusinessDate(today, -5), 0, null);
    const held = createHeldCommit(page, request => commitWritesDocument(request, 'days', gap));
    await held.install();
    const commandIds: string[] = [];
    try {
      await openDayClose(page);
      await page.locator('#cloud-day-close-date').fill(gap);
      await page.getByRole('button', { name: '載入日期' }).click();
      const form = page.getByRole('form', { name: `${gap} 回填` });
      await expect(form).toBeVisible();
      await expect(form.getByRole('button', { name: '確認回填這一天' })).toBeEnabled({ timeout: 15000 });
      await form.getByRole('textbox', { name: /開帳現金（元）/ }).fill('870');
      await form.getByRole('textbox', { name: /回填原因/ }).fill(sentinelReason);
      held.arm();
      await form.getByRole('button', { name: '確認回填這一天' }).click();

      // Step one (EnsureDay) takes effect on the server, but its response stays held.
      await waitForWriteGate(held.state.intercepted.promise, 'EnsureDay commit response gate');
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15000 });
      const ensureId = await lastCommandIdFromHead();
      if (!ensureId) throw new Error('The EnsureDay command ID was not visible in dataHead');
      commandIds.push(ensureId);
      expect((await readEmulatorDocument('commands', ensureId)).fields?.kind).toEqual({ stringValue: 'EnsureDay' });
      expect((await readEmulatorDocument('days', gap)).fields?.openingCash).toEqual({ nullValue: null });
      await expectMinimalJournal(page, [{ commandId: ensureId, datasetId, uid }]);
      expect(await rawStorageDump(page)).not.toContain(sentinelReason);

      // A receipt found while the original response is held never starts the next step by itself.
      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByRole('alert', { name: '命令結果確認' })).toContainText('已找到伺服器回執，資料尚待再次讀取。');
      expect(held.state.returned).toBe(false);
      await page.waitForTimeout(1500);
      expect(held.state.matched).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([ensureId]);

      held.state.release.resolve();
      await waitForWriteGate(held.state.completed.promise, 'EnsureDay response release');
      await expect(page.getByTestId('backfill-continue')).toBeVisible();
      await page.waitForTimeout(1500);
      expect(held.state.matched).toBe(1);
      expect(await listEmulatorDocumentIds('commands')).toEqual([ensureId]);
      expect(await rawStorageDump(page)).not.toContain(sentinelReason);

      // Only the explicit continue starts the opening step; its own returned receipt then advances to the marker once.
      await page.getByTestId('backfill-continue').click();
      await expect(page.getByText(/已標為回填，可以到訂餐頁補登交易/)).toBeVisible({ timeout: 30000 });
      // EnsureDay and BackfillOpeningCash write the day; StartBackfill only writes the marker, counted via the receipts below.
      expect(held.state.matched).toBe(2);

      const ids = await listEmulatorDocumentIds('commands');
      commandIds.push(...ids.filter(id => !commandIds.includes(id)));
      expect(ids).toHaveLength(3);
      const kinds: string[] = [];
      for (const id of ids) {
        kinds.push(((await readEmulatorDocument('commands', id)).fields?.kind as { stringValue: string }).stringValue);
      }
      expect(kinds.sort()).toEqual(['BackfillOpeningCash', 'EnsureDay', 'StartBackfill']);
      expect((await readEmulatorDocument('system', 'dataHead')).fields?.seq).toEqual({ integerValue: '3' });
      expect((await readEmulatorDocument('days', gap)).fields?.openingCash).toEqual({ integerValue: '870' });
      expect((await readEmulatorDocument('backfillDays', gap)).fields?.reason).toEqual({ stringValue: sentinelReason });
      await expectMinimalJournal(page, []);
      expect(await rawStorageDump(page)).not.toContain(sentinelReason);
    } finally {
      await held.settle();
      await cleanupDayCloseRun(page, { commandIds, days: [gap, today], backfillDays: [gap] });
      await setDayCloseDataHead(DATASET_ID, today, 0, null);
    }
  });
});
