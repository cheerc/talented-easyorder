import { test, expect } from './fixtures';
import { removeDocument, seedAccessLease, upsertDocument } from './helpers/seed';

const DATASET_ID = 'e2e-empty-p06-dataset';
const APP_NAMESPACE = 'easyorder-cloud-command-journal:v1:demo-easyorder:%5BDEFAULT%5D';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function readEmulatorDocument(collection: string, id: string) {
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/demo-easyorder/databases/(default)/documents/${collection}/${id}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) throw new Error(`Unable to read Emulator ${collection}/${id}: ${await response.text()}`);
  return response.json() as Promise<{ fields?: Record<string, unknown> }>;
}

async function listEmulatorDocumentIds(collection: string): Promise<string[]> {
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/demo-easyorder/databases/(default)/documents/${collection}?pageSize=100`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok) throw new Error(`Unable to list Emulator ${collection}: ${await response.text()}`);
  const body = await response.json() as { documents?: Array<{ name?: string }> };
  return (body.documents ?? []).map(document => document.name?.split('/').at(-1) ?? '').filter(Boolean);
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
});
