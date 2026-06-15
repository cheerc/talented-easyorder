// Order flow e2e test — Login → Select student → Confirm order → Success flash
// Ref: #269

import { test, expect } from './fixtures';

test.describe('Order Flow', () => {
  test('complete an order for a student', async ({ authedPage: page }) => {
    // 1. Type student name in search box to get suggestions
    const searchInput = page.locator('.search-input');
    await searchInput.fill('王');
    
    // 2. Should see student suggestion
    await expect(page.locator('.sug-name').filter({ hasText: '王小明' })).toBeVisible({ timeout: 5000 });
    
    // 3. Click on the student suggestion
    await page.locator('.sug-row').filter({ hasText: '王小明' }).click();
    
    // 4. Customer card should appear with student name
    await expect(page.locator('.customer')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.cust-name')).toContainText('王小明');
    
    // 5. The mode should default to '訂便當' (first-time order)
    await expect(page.locator('.mode.mode-on')).toContainText('訂便當');
    
    // 6. Click confirm button
    await page.locator('.btn-confirm').click();
    
    // 7. Should show success flash (ConfirmBanner)
    await expect(page.locator('.flash, .confirm-banner')).toBeVisible({ timeout: 5000 });
  });
});
