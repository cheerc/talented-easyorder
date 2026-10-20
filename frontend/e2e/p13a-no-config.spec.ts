import { test, expect } from '@playwright/test';

const LEGACY_POS_KEY = 'pos-storage';
const PROTOTYPE_POS_KEY = 'pos-storage-prototype';
const LEGACY_MARKER = 'P13A-MISSING-CONFIG-LEGACY-POS-MARKER';
const PROTOTYPE_MARKER = 'P13A-PROTOTYPE-PRESERVATION-MARKER';

type StorageProbeWindow = Window & {
  __p13aStorageProbe?: {
    active: boolean;
    operations: Array<{ kind: string; database?: string; stores?: string; key?: string }>;
  };
};

test('missing-config production entry never reads or rewrites legacy POS data and preserves prototype/UI storage', async ({ page }) => {
  await page.route('**/*.js', route => route.abort());
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.evaluate(async ({ legacyMarker, prototypeMarker, legacyKey, prototypeKey }) => {
    const seedDatabase = (name: string, key: string, marker: string) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('persist');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('persist', 'readwrite');
        transaction.objectStore('persist').put({
          state: { students: [{ studentId: `P13A-${marker}`, displayName: marker }], transactions: [], vendors: [], todayMenu: null },
          version: 2,
        }, key);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    });

    await seedDatabase('easyorder-pos', legacyKey, legacyMarker);
    await seedDatabase('easyorder-pos-prototype', prototypeKey, prototypeMarker);
    localStorage.setItem(legacyKey, JSON.stringify({ state: { students: [{ displayName: legacyMarker }] }, version: 2 }));
    localStorage.setItem('easyorder-ui-tweaks', 'synthetic-ui-preference');
  }, { legacyMarker: LEGACY_MARKER, prototypeMarker: PROTOTYPE_MARKER, legacyKey: LEGACY_POS_KEY, prototypeKey: PROTOTYPE_POS_KEY });

  await page.addInitScript(() => {
    const probeWindow = window as StorageProbeWindow;
    const probe = { active: true, operations: [] as Array<{ kind: string; database?: string; stores?: string; key?: string }> };
    probeWindow.__p13aStorageProbe = probe;
    const isSensitiveDatabase = (name: string) => name === 'easyorder-pos' || name.includes('easyorder-crash-draft');
    const isPosKey = (key: string) => key === 'pos-storage' || key.startsWith('pos-storage-') || key.includes('crash-draft');

    const originalOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<typeof originalOpen>) {
      if (probe.active && isSensitiveDatabase(args[0])) probe.operations.push({ kind: 'open', database: args[0] });
      return originalOpen.apply(this, args);
    };

    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof originalTransaction>) {
      if (probe.active && isSensitiveDatabase(this.name)) {
        const stores = typeof args[0] === 'string' ? [args[0]] : Array.from(args[0]);
        probe.operations.push({ kind: 'transaction', database: this.name, stores: stores.join(',') });
      }
      return originalTransaction.apply(this, args);
    };

    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (probe.active && isPosKey(key)) probe.operations.push({ kind: 'localStorage.getItem', key });
      return originalGet.call(this, key);
    };
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (probe.active && isPosKey(key)) probe.operations.push({ kind: 'localStorage.setItem', key });
      return originalSet.call(this, key, value);
    };
    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (probe.active && isPosKey(key)) probe.operations.push({ kind: 'localStorage.removeItem', key });
      return originalRemove.call(this, key);
    };
  });

  await page.unroute('**/*.js');
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('正式模式缺少必要 Firebase 設定');
  await expect(page.locator('body')).not.toContainText(LEGACY_MARKER);
  await expect(page.locator('body')).not.toContainText(PROTOTYPE_MARKER);

  const evidence = await page.evaluate(async ({ legacyKey, prototypeKey }) => {
    const probeWindow = window as StorageProbeWindow;
    const probe = probeWindow.__p13aStorageProbe!;
    probe.active = false;
    const readDatabaseValue = (databaseName: string, key: string) => new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const get = database.transaction('persist', 'readonly').objectStore('persist').get(key);
        get.onsuccess = () => { const value = get.result; database.close(); resolve(value); };
        get.onerror = () => { const error = get.error; database.close(); reject(error); };
      };
    });
    return {
      operations: [...probe.operations],
      legacyIdbValue: await readDatabaseValue('easyorder-pos', legacyKey),
      prototypeIdbValue: await readDatabaseValue('easyorder-pos-prototype', prototypeKey),
      legacyLocalValue: localStorage.getItem(legacyKey),
      uiPreference: localStorage.getItem('easyorder-ui-tweaks'),
    };
  }, { legacyKey: LEGACY_POS_KEY, prototypeKey: PROTOTYPE_POS_KEY });

  expect(evidence.operations).toEqual([]);
  expect(JSON.stringify(evidence.legacyIdbValue)).toContain(LEGACY_MARKER);
  expect(JSON.stringify(evidence.prototypeIdbValue)).toContain(PROTOTYPE_MARKER);
  expect(evidence.legacyLocalValue).toContain(LEGACY_MARKER);
  expect(evidence.uiPreference).toBe('synthetic-ui-preference');
});
