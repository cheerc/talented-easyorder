// Prototype POS regression — Select student → Confirm order → Success flash
// Ref: #269

import { test, expect } from './prototype-fixtures';

test.describe('Order Flow', () => {
  test('complete an order for a prototype student', async ({ prototypePage: page }) => {
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
    
    // 5. The mode should default to '訂便當' (first-time order)
    await expect(page.locator('.mode.mode-on')).toContainText('訂便當');
    
    // 6. Press Enter to confirm (Ref: #399 — btn-confirm removed, keyboard Enter confirms)
    await page.keyboard.press('Enter');
    
    // 7. Should show success flash (ConfirmBanner)
    await expect(page.locator('.flash, .confirm-banner')).toBeVisible({ timeout: 5000 });
  });
});
