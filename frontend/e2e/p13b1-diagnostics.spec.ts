import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { seedAccessLease } from './helpers/seed';

const MARKERS = [
  'P13B1-BARE-NAME-王小明',
  'P13B1-AMOUNT-987654321',
  'P13B1-EMAIL-private@example.test',
  'P13B1-URL-https://example.test/path?student=secret',
  'P13B1-STACK-/Users/private/project/App.tsx',
  'P13B1-NESTED-PAYLOAD-秘密',
];
const SENSITIVE_FRAGMENTS = ['王小明', '987654321', 'private@example.test', 'https://example.test/path?student=secret', '/Users/private/project/App.tsx', '秘密'];

test.describe('P13b1 Cloud F3 safe diagnostics', () => {
  test.setTimeout(90000);

  test.beforeEach(async () => {
    await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
  });

  test.afterEach(async () => {
    await seedAccessLease({ holderUid: null, epoch: 0, updatedAt: new Date() });
  });

  test('a denied localStorage property does not leave the production app blank', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('P13B1 denied storage marker', 'SecurityError'); },
      });
    });
    await page.goto('/');

    await expect(page.locator('#root .auth-gate')).toBeVisible();
    expect(await page.locator('#root').innerText()).not.toBe('');
  });

  test('F3 reports blocked storage reads and clear failures without exporting or showing success', async ({ googleSession }) => {
    const { page } = googleSession;
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    await expect(page.getByRole('button', { name: '本機診斷（F3）' })).toBeVisible();
    await page.evaluate(() => localStorage.setItem('easyorder-diagnostics-cloud', JSON.stringify({
      schemaVersion: 1,
      entries: [{
        type: 'system-error', source: 'auth', systemCode: 'AUTH_ERROR', occurredAt: new Date().toISOString(),
      }],
    })));
    await page.keyboard.press('F3');
    await expect(page.getByRole('heading', { name: '本機診斷' })).toBeVisible();
    await expect(page.getByText('系統診斷：AUTH_ERROR')).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new DOMException('P13B1 denied storage marker', 'SecurityError'); },
      });
    });

    await page.getByRole('button', { name: '重新載入紀錄' }).click();
    await expect(page.getByRole('alert')).toContainText('無法讀取本機診斷紀錄');
    const downloads: string[] = [];
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await page.getByRole('button', { name: '匯出本機診斷' }).click();
    await expect(page.getByRole('alert')).toContainText('無法建立診斷下載');
    await page.getByRole('button', { name: '清除本機診斷' }).click();
    await expect(page.getByRole('alert')).toContainText('無法清除本機診斷紀錄');
    expect(await page.getByRole('region', { name: '本機診斷' }).getByRole('status').count()).toBe(0);
    expect(downloads).toEqual([]);
  });

  test('requires the lease, exports the strict allowlist, clears it, and masks controls on lease loss', async ({ googleSession }) => {
    const { page, uid } = googleSession;
    const navButton = page.getByRole('button', { name: /本機診斷.*F3/ });
    await expect(navButton).toHaveCount(0);

    await page.evaluate(markers => {
      localStorage.setItem('easyorder-error-log', JSON.stringify([{ message: markers.join(' ') }]));
      localStorage.setItem('easyorder-error-log-prototype', 'prototype-sentinel');
      localStorage.setItem('unrelated-storage-sentinel', 'unrelated-sentinel');
      localStorage.setItem('easyorder-diagnostics-cloud', JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            type: 'command-failure', commandId: markers[0], kind: 'CreatePayment', errorCode: 'INVALID_INPUT',
            occurredAt: new Date().toISOString(), payload: markers[5],
          },
          {
            type: 'system-error', source: markers[1], systemCode: markers[2], occurredAt: new Date().toISOString(),
          },
        ],
      }));
      window.dispatchEvent(new ErrorEvent('error', {
        message: markers.join(' '),
        error: Object.assign(new Error(markers.join(' ')), { stack: markers.join('\n') }),
      }));
    }, MARKERS);

    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText(`租約 Epoch: 1`);
    await expect(navButton).toBeVisible();
    await page.keyboard.press('F3');
    await expect(page.getByRole('heading', { name: '本機診斷' })).toBeVisible();
    await expect(page.getByText(/只保存在這台電腦.*24 小時/)).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '匯出本機診斷' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^easyorder-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exportedText = await readFile(downloadPath!, 'utf8');
    const exported = JSON.parse(exportedText);
    for (const marker of [...MARKERS, ...SENSITIVE_FRAGMENTS]) expect(exportedText).not.toContain(marker);
    expect(exported).toMatchObject({ schemaVersion: 1, retentionHours: 24 });
    expect(exported.entries).toHaveLength(1);
    expect(exported.entries[0]).toMatchObject({
      type: 'system-error', source: 'window-error', systemCode: 'UNKNOWN_RUNTIME_ERROR',
    });
    expect(Object.keys(exported.entries[0]).sort()).toEqual(['occurredAt', 'source', 'systemCode', 'type']);

    const storage = await page.evaluate(() => ({
      serialized: Object.keys(localStorage).map(key => `${key}=${localStorage.getItem(key) ?? ''}`).join('\n'),
      legacy: localStorage.getItem('easyorder-error-log'),
      prototype: localStorage.getItem('easyorder-error-log-prototype'),
      sentinel: localStorage.getItem('unrelated-storage-sentinel'),
    }));
    for (const marker of [...MARKERS, ...SENSITIVE_FRAGMENTS]) expect(storage.serialized).not.toContain(marker);
    expect(storage.legacy).toBeNull();
    expect(storage.prototype).toBe('prototype-sentinel');
    expect(storage.sentinel).toBe('unrelated-sentinel');

    await page.getByRole('button', { name: '清除本機診斷' }).click();
    await expect(page.getByText('目前沒有可匯出的診斷紀錄。')).toBeVisible();

    await page.evaluate(() => localStorage.setItem('easyorder-diagnostics-cloud', JSON.stringify({
      schemaVersion: 1,
      entries: [{
        type: 'command-failure', commandId: null, kind: null, errorCode: 'UNKNOWN_RESULT',
        occurredAt: new Date().toISOString(),
      }],
    })));

    await seedAccessLease({ holderUid: 'p13b1-other-holder', epoch: 2, updatedAt: new Date() });
    await expect(page.getByLabel('EasyOrder 使用權租約')).toBeVisible();
    await expect(page.getByRole('button', { name: /本機診斷.*F3/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '匯出本機診斷' })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('easyorder-diagnostics-cloud'))).toContain('UNKNOWN_RESULT');
    expect(uid).toBeTruthy();
  });

  test('removes a crafted diagnostic envelope when F3 reads it without a new error event', async ({ googleSession }) => {
    const { page } = googleSession;
    await page.getByRole('button', { name: '取得系統使用權' }).click();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch: 1');
    await expect(page.getByRole('button', { name: '本機診斷（F3）' })).toBeVisible();
    await page.evaluate(marker => {
      const occurredAt = new Date().toISOString();
      const raw = `{"schemaVersion":"${marker}","schemaVersion":1,"entries":[{"type":"system-error","source":"${marker}","source":"auth","systemCode":"AUTH_ERROR","occurredAt":"${occurredAt}"}]}`;
      localStorage.setItem('easyorder-diagnostics-cloud', raw);
    }, MARKERS[0]);

    await page.keyboard.press('F3');
    await expect(page.getByRole('heading', { name: '本機診斷' })).toBeVisible();
    await expect(page.getByText('系統診斷：AUTH_ERROR')).toBeVisible();
    const canonicalStorage = await page.evaluate(() => localStorage.getItem('easyorder-diagnostics-cloud'));
    expect(canonicalStorage).not.toContain(MARKERS[0]);
    expect(JSON.parse(canonicalStorage!)).toMatchObject({
      schemaVersion: 1,
      entries: [{
        type: 'system-error', source: 'auth', systemCode: 'AUTH_ERROR', occurredAt: expect.any(String),
      }],
    });
    const storage = await page.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key) ?? '').join('\n'));
    expect(storage).not.toContain(MARKERS[0]);
  });
});
