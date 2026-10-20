import { test, expect } from '@playwright/test';

const FIRESTORE_DATABASE = 'firestore/[DEFAULT]/demo-easyorder/main';

type P13aProbeWindow = Window & {
  __p13aLegacyFirestoreDb?: IDBDatabase;
  __p13aLateSubscriberNotifications?: number;
};

test('the live StrictMode subscriber sees blocked cleanup and late subscribers see the pending attempt state', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4174' });
  const legacyPage = await context.newPage();
  const appPage = await context.newPage();

  try {
    await legacyPage.goto('/');
    await legacyPage.evaluate(databaseName => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('legacySyntheticRecords');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('legacySyntheticRecords', 'readwrite');
        transaction.objectStore('legacySyntheticRecords').put('synthetic P13a blocker', 'marker');
        transaction.oncomplete = () => {
          (window as P13aProbeWindow).__p13aLegacyFirestoreDb = database;
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    }), FIRESTORE_DATABASE);

    await appPage.goto('/');
    await expect(appPage.getByRole('alert')).toContainText('請關閉其他 EasyOrder 分頁');
    await expect(appPage.getByRole('button', { name: '重新載入' })).toBeVisible();
    await expect(appPage.getByRole('button', { name: '使用 Google 登入' })).toHaveCount(0);

    await appPage.evaluate(async () => {
      const { ensureFirebaseInitialized } = await import('/src/firebase/firebaseApp.ts');
      const probeWindow = window as P13aProbeWindow;
      probeWindow.__p13aLateSubscriberNotifications = 0;
      void ensureFirebaseInitialized(undefined, {
        onFirestoreCleanupBlocked: () => {
          probeWindow.__p13aLateSubscriberNotifications = (probeWindow.__p13aLateSubscriberNotifications ?? 0) + 1;
        },
      });
    });
    await expect.poll(() => appPage.evaluate(() => (window as P13aProbeWindow).__p13aLateSubscriberNotifications)).toBe(1);

    await legacyPage.evaluate(() => {
      const probeWindow = window as P13aProbeWindow;
      probeWindow.__p13aLegacyFirestoreDb?.close();
      delete probeWindow.__p13aLegacyFirestoreDb;
    });
    await expect(appPage.getByRole('button', { name: '使用 Google 登入' })).toBeVisible({ timeout: 30000 });

    const staleNotificationCount = await appPage.evaluate(async () => {
      const { ensureFirebaseInitialized } = await import('/src/firebase/firebaseApp.ts');
      const probeWindow = window as P13aProbeWindow;
      const before = probeWindow.__p13aLateSubscriberNotifications;
      await ensureFirebaseInitialized(undefined, {
        onFirestoreCleanupBlocked: () => {
          probeWindow.__p13aLateSubscriberNotifications = (probeWindow.__p13aLateSubscriberNotifications ?? 0) + 1;
        },
      });
      return (probeWindow.__p13aLateSubscriberNotifications ?? 0) - (before ?? 0);
    });
    expect(staleNotificationCount).toBe(0);
  } finally {
    await context.close();
  }
});
