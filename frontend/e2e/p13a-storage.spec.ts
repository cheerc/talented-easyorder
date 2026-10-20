import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, E2E_BASE_URL, signInGoogle } from './fixtures';
import { E2E_IDENTITIES } from './helpers/auth';
import { removeDocument, seedAccessLease, upsertDocument } from './helpers/seed';

const FIRESTORE_DATABASE = 'firestore/[DEFAULT]/demo-easyorder/main';
const STUDENT_ID = '00000000-0000-4000-8000-000000000013';
const COMMAND_ID = '00000000-0000-4000-8000-000000000014';
const TRANSACTION_ID = 'p13a-synthetic-order';
const STUDENT_CODE = '998001';
const STUDENT_MARKER = 'P13A-SYNTHETIC-STUDENT-998001';
const MEAL_MARKER = 'P13A-SYNTHETIC-MEAL';
const VACANT_LEASE = { holderUid: null, epoch: 0, updatedAt: new Date() };

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function readStorageInventory(page: import('@playwright/test').Page) {
  return page.evaluate(async (markers: string[]) => {
    const databaseNames = (await indexedDB.databases()).map(database => database.name ?? '');
    const localStorageValues = Object.keys(localStorage).map(key => `${key}=${localStorage.getItem(key) ?? ''}`);
    const cacheNames = await caches.keys();
    const cacheUrls: string[] = [];
    const cacheBodies: string[] = [];
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        cacheUrls.push(request.url);
        const response = await cache.match(request);
        if (response && (response.headers.get('content-type') ?? '').includes('text/html')) {
          cacheBodies.push(await response.clone().text());
        }
      }
    }
    const persistedStrings = [...localStorageValues, ...cacheBodies];
    return {
      databaseNames,
      cacheNames,
      cacheUrls,
      firestoreDatabaseNames: databaseNames.filter(name => name.startsWith('firestore/')),
      crashDraftDatabaseNames: databaseNames.filter(name => name.includes('easyorder-crash-draft')),
      cloudPosLocalStorageKeys: Object.keys(localStorage).filter(key => key === 'pos-storage-cloud'),
      businessMarkerPersisted: markers.some(marker => persistedStrings.some(value => value.includes(marker))),
    };
  }, [STUDENT_MARKER, MEAL_MARKER]);
}

test.describe('P13a generated service worker and memory-only cloud storage', () => {
  test.setTimeout(90000);

  let cacheProbeServer: Server;
  let cacheProbeUrl = '';

  test.beforeAll(async () => {
    cacheProbeServer = createServer((_request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'application/javascript');
      response.writeHead(200);
      response.end('globalThis.__p13aNetworkProbe = true;');
    });
    await new Promise<void>((resolve, reject) => {
      cacheProbeServer.once('error', reject);
      cacheProbeServer.listen(0, '127.0.0.1', resolve);
    });
    const address = cacheProbeServer.address() as AddressInfo;
    cacheProbeUrl = `http://127.0.0.1:${address.port}`;
  });

  test.afterAll(async () => {
    if (cacheProbeServer?.listening) {
      await new Promise<void>(resolve => cacheProbeServer.close(() => resolve()));
    }
  });

  test('precaches the app shell while leaving same-origin and cross-origin API-shaped responses uncached', async ({ page }, testInfo) => {
    await page.goto(E2E_BASE_URL);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const urls = [
      '/api/business.js?query=firestore',
      `${cacheProbeUrl}/api/auth.js?provider=google`,
      `${cacheProbeUrl}/api/firestore.js?documents=synthetic`,
      '/api/firestore?format=.js',
    ];
    const inventory = await page.evaluate(async requestUrls => {
      const responses = [];
      for (const requestUrl of requestUrls) {
        const response = await fetch(requestUrl);
        responses.push({ url: requestUrl, status: response.status });
      }
      const cacheNames = await caches.keys();
      const cacheUrls: string[] = [];
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) cacheUrls.push(request.url);
      }
      return { responses, cacheNames, cacheUrls };
    }, urls);

    expect(inventory.responses.map(response => response.status)).toEqual([200, 200, 200, 200]);
    expect(inventory.cacheUrls.some(url => new URL(url).pathname === '/index.html')).toBe(true);
    expect(inventory.cacheUrls.some(url => /\/assets\/.*\.(?:js|css)$/.test(new URL(url).pathname))).toBe(true);
    for (const requestUrl of urls) {
      const expected = new URL(requestUrl, E2E_BASE_URL).href;
      expect(inventory.cacheUrls).not.toContain(expected);
    }

    await testInfo.attach('P13a service worker cache inventory', {
      body: JSON.stringify({ origin: E2E_BASE_URL, ...inventory }, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('P13a generated service worker', {
      path: new URL('../dist/sw.js', import.meta.url).pathname,
      contentType: 'text/javascript',
    });
  });

  test('blocks app initialization while a legacy Firestore database is open, then clears it after the old page closes', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: E2E_BASE_URL });
    const legacyPage = await context.newPage();
    const appPage = await context.newPage();

    try {
      await legacyPage.goto('/');
      await legacyPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await legacyPage.evaluate(databaseName => new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('legacySyntheticRecords');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('legacySyntheticRecords', 'readwrite');
          transaction.objectStore('legacySyntheticRecords').put({ value: 'synthetic pending-write marker' }, 'p13a');
          transaction.oncomplete = () => {
            (window as Window & { __p13aLegacyDb?: IDBDatabase }).__p13aLegacyDb = database;
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }), FIRESTORE_DATABASE);

      await appPage.goto('/');
      await expect(appPage.getByRole('alert')).toContainText('請關閉其他 EasyOrder 分頁');
      await expect(appPage.getByRole('button', { name: '重新載入' })).toBeVisible();
      await expect(appPage.getByRole('button', { name: '使用 Google 登入' })).toHaveCount(0);
      await expect(appPage.getByRole('button', { name: '取得系統使用權' })).toHaveCount(0);

      await legacyPage.close();
      await expect(appPage.getByRole('button', { name: '使用 Google 登入' })).toBeVisible({ timeout: 15000 });
      const databaseNames = await appPage.evaluate(async () => (await indexedDB.databases()).map(database => database.name ?? ''));
      expect(databaseNames).not.toContain(FIRESTORE_DATABASE);
    } finally {
      await context.close();
    }
  });

  test('reload, offline, logout and next holder never recover a local student or ledger copy', async ({ browser }) => {
    const today = taipeiToday();
    const now = new Date();
    const contextA = await browser.newContext({ baseURL: E2E_BASE_URL });
    const pageA = await contextA.newPage();
    let contextB: import('@playwright/test').BrowserContext | null = null;

    try {
      const sessionA = await signInGoogle(pageA, E2E_IDENTITIES.operatorA.email);
      const emailA = E2E_IDENTITIES.operatorA.email;
      await seedAccessLease({ ...VACANT_LEASE, updatedAt: now });
      await upsertDocument('system', 'dataHead', {
        schemaVersion: 1,
        datasetId: 'e2e-p13a-memory-storage',
        seq: 1,
        lastCommandId: COMMAND_ID,
        maintenance: false,
        goLiveDate: today,
        updatedAt: now,
      });
      await upsertDocument('students', STUDENT_ID, {
        studentId: STUDENT_ID,
        studentCode: STUDENT_CODE,
        displayName: STUDENT_MARKER,
        aliases: [],
        status: 'active',
        openingBalance: { amount: 200, asOfDate: today, note: 'synthetic fixture', createdAt: now },
        currentBalance: 150,
        createdAt: now,
        revision: 1,
        lastCommandId: COMMAND_ID,
        updatedAt: now,
      });
      await upsertDocument('studentCodes', STUDENT_CODE, {
        studentId: STUDENT_ID,
        lastCommandId: COMMAND_ID,
        updatedAt: now,
      });
      await upsertDocument('days', today, {
        status: 'open',
        revision: 1,
        menu: {
          businessDate: today,
          itemName: MEAL_MARKER,
          price: 50,
          vendorId: 'p13a-synthetic-vendor',
          vendorNameSnapshot: 'P13A-SYNTHETIC-VENDOR',
          updatedAt: now,
          revision: 1,
          inheritedFromDate: null,
        },
        openingCash: 100,
        openedBy: sessionA.uid,
        openedAt: now,
        totals: {
          activeTransactionCount: 1,
          bentoCount: 1,
          otherMealCount: 0,
          mealTotal: 50,
          retainedReceipts: 0,
          cashierIncome: 0,
          cashierExpense: 0,
          accountRefunds: 0,
        },
        lastSettlementRevision: 0,
        lastCommandId: COMMAND_ID,
        updatedAt: now,
      });
      await upsertDocument('transactions', TRANSACTION_ID, {
        transactionId: TRANSACTION_ID,
        studentId: STUDENT_ID,
        businessDate: today,
        type: 'order',
        mealKind: 'bento',
        mealPrice: 50,
        paidAmount: 0,
        amount: -50,
        studentNameSnapshot: STUDENT_MARKER,
        menuNameSnapshot: MEAL_MARKER,
        menuPriceSnapshot: 50,
        vendorIdSnapshot: 'p13a-synthetic-vendor',
        vendorNameSnapshot: 'P13A-SYNTHETIC-VENDOR',
        otherItemName: null,
        status: 'active',
        revision: 1,
        createdAt: now,
        createdSeq: 1,
        operatorUid: sessionA.uid,
        operatorEmail: emailA,
        sourceDevice: 'pc',
        note: 'synthetic P13a storage probe',
        lastCommandId: COMMAND_ID,
        updatedAt: now,
      });

      await pageA.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(pageA.locator('.operator-strip')).toContainText('租約 Epoch: 1');
      await expect(pageA.getByTestId(`cloud-student-row-${STUDENT_CODE}`)).toContainText(STUDENT_MARKER);
      await pageA.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(pageA.getByTestId('cloud-orders-page')).toBeVisible();
      await expect(pageA.getByTestId(`recent-item-${STUDENT_CODE}`)).toContainText(STUDENT_MARKER);
      await expect(pageA.getByTestId(`recent-item-${STUDENT_CODE}`)).toContainText('今日餐點 1');
      const initialInventory = await readStorageInventory(pageA);
      expect(initialInventory.firestoreDatabaseNames).toEqual([]);
      expect(initialInventory.crashDraftDatabaseNames).toEqual([]);
      expect(initialInventory.cloudPosLocalStorageKeys).toEqual([]);
      expect(initialInventory.businessMarkerPersisted).toBe(false);

      await pageA.reload();
      await expect(pageA.locator('.operator-strip')).toBeVisible();
      await expect(pageA.getByTestId(`cloud-student-row-${STUDENT_CODE}`)).toContainText(STUDENT_MARKER);
      await pageA.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(pageA.getByTestId(`recent-item-${STUDENT_CODE}`)).toContainText('今日餐點 1');

      await contextA.setOffline(true);
      await pageA.reload();
      await expect(pageA.locator('body')).not.toContainText(STUDENT_MARKER, { timeout: 15000 });
      await expect(pageA.getByTestId('submit-order-button')).toHaveCount(0);
      const offlineInventory = await readStorageInventory(pageA);
      expect(offlineInventory.firestoreDatabaseNames).toEqual([]);
      expect(offlineInventory.businessMarkerPersisted).toBe(false);

      await contextA.setOffline(false);
      await pageA.reload();
      await expect(pageA.locator('.operator-strip')).toBeVisible();
      await expect(pageA.getByTestId(`cloud-student-row-${STUDENT_CODE}`)).toContainText(STUDENT_MARKER);
      await pageA.locator('.operator-strip').getByRole('button', { name: '釋放使用權並登出' }).click();
      await expect(pageA.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
      await expect(pageA.locator('body')).not.toContainText(STUDENT_MARKER);

      contextB = await browser.newContext({ baseURL: E2E_BASE_URL });
      const pageB = await contextB.newPage();
      await signInGoogle(pageB, E2E_IDENTITIES.operatorB.email);
      await pageB.getByRole('button', { name: '取得系統使用權' }).click();
      await expect(pageB.locator('.operator-strip')).toContainText('租約 Epoch: 3');
      await expect(pageB.getByTestId(`cloud-student-row-${STUDENT_CODE}`)).toContainText(STUDENT_MARKER);
      await pageB.getByRole('button', { name: '櫃台點餐' }).click();
      await expect(pageB.getByTestId(`recent-item-${STUDENT_CODE}`)).toContainText('今日餐點 1');
      const nextHolderInventory = await readStorageInventory(pageB);
      expect(nextHolderInventory.firestoreDatabaseNames).toEqual([]);
      expect(nextHolderInventory.crashDraftDatabaseNames).toEqual([]);
      expect(nextHolderInventory.cloudPosLocalStorageKeys).toEqual([]);
      expect(nextHolderInventory.businessMarkerPersisted).toBe(false);
    } finally {
      await contextB?.close();
      await contextA.close();
      await seedAccessLease({ ...VACANT_LEASE, updatedAt: new Date() });
      await removeDocument('transactions', TRANSACTION_ID);
      await removeDocument('days', today);
      await removeDocument('students', STUDENT_ID);
      await removeDocument('studentCodes', STUDENT_CODE);
      await upsertDocument('system', 'dataHead', {
        schemaVersion: 1,
        datasetId: 'e2e-empty-p06-dataset',
        seq: 0,
        lastCommandId: null,
        maintenance: false,
        goLiveDate: taipeiToday(),
        updatedAt: new Date(),
      });
    }
  });
});
