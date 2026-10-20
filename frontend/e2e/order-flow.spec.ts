// Prototype POS regression — Select student → Confirm order → Success flash
// Ref: #269

import { test, expect } from './prototype-fixtures';

async function readPrototypePersistedState(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('easyorder-pos-prototype');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction('persist', 'readonly').objectStore('persist').get('pos-storage-prototype');
      get.onsuccess = () => { const value = get.result; database.close(); resolve(value); };
      get.onerror = () => { const error = get.error; database.close(); reject(error); };
    };
  }));
}

test.describe('Order Flow', () => {
  test('complete an order for a prototype student', async ({ prototypePage: page }) => {
    await expect.poll(() => page.evaluate(async () =>
      (await indexedDB.databases()).some(database => database.name === 'easyorder-pos-prototype'),
    )).toBe(true);
    // 1. Search by the synthetic prototype fixture ID.
    const searchInput = page.locator('.search-input');
    await searchInput.fill('S001');
    
    // 2. Should see student suggestion
    await expect(page.locator('.sug-id').filter({ hasText: 'S001' })).toBeVisible({ timeout: 5000 });
    
    // 3. Click on the student suggestion
    await page.locator('.sug-row').filter({ hasText: 'S001' }).click();
    
    // 4. Customer card should show the selected fixture ID.
    await expect(page.locator('.customer')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.cust-id')).toContainText('S001');
    
    // 5. The mode should default to '訂餐' (first-time order)
    await expect(page.locator('.mode.mode-on')).toContainText('訂餐');
    
    // 6. Press Enter to confirm (Ref: #399 — btn-confirm removed, keyboard Enter confirms)
    await page.keyboard.press('Enter');
    
    // 7. Should show success flash (ConfirmBanner)
    await expect(page.locator('.flash, .confirm-banner')).toBeVisible({ timeout: 5000 });

    await expect.poll(async () => {
      const saved = await readPrototypePersistedState(page) as {
        state?: { transactions?: Array<{ studentId: string; type: string }> };
      } | null;
      return saved?.state?.transactions?.some(transaction => transaction.studentId === 'S001' && transaction.type === 'order') ?? false;
    }).toBe(true);
    const afterOrder = await readPrototypePersistedState(page) as {
      state: { transactions: Array<{ studentId: string; type: string }> };
    };
    expect(afterOrder.state.transactions[0]).toMatchObject({ studentId: 'S001', type: 'order' });

    await page.reload();
    await page.waitForSelector('.app', { timeout: 15000 });
    const afterReload = await readPrototypePersistedState(page) as {
      state: { transactions: Array<{ studentId: string; type: string }> };
    };
    expect(afterReload.state.transactions).toEqual(afterOrder.state.transactions);
  });
});
