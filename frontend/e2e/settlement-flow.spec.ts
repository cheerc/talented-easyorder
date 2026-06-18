// Settlement flow e2e test — Login → Navigate to Admin → Set opening cash → Navigate to Report
// Ref: #269

import { test, expect } from './fixtures';

test.describe('Settlement Flow', () => {
  test('navigate to admin and view today settings', async ({ authedPage: page }) => {
    // 1. Navigate to Admin tab (今日設定)
    await page.locator('button.tab').filter({ hasText: '今日設定' }).click();
    
    // 2. Should see admin screen with menu settings
    await expect(page.locator('.card-h').filter({ hasText: '今日便當設定' })).toBeVisible({ timeout: 5000 });
    
    // 3. Opening cash section should be visible
    await expect(page.locator('.card-h').filter({ hasText: '每日開帳金額' })).toBeVisible();
  });

  test('navigate to report tab and view report', async ({ authedPage: page }) => {
    // 1. Navigate to Report tab (今日帳)
    await page.locator('button.tab').filter({ hasText: '今日帳' }).click();
    
    // 2. Should see report screen
    await expect(page.locator('.screen.report, .report-screen')).toBeVisible({ timeout: 5000 });
  });

  test('full flow: admin settings then report', async ({ authedPage: page }) => {
    // 1. Go to Admin tab
    await page.locator('button.tab').filter({ hasText: '今日設定' }).click();
    
    // 2. Verify admin screen loaded
    await expect(page.locator('.screen.admin')).toBeVisible({ timeout: 5000 });
    
    // 3. Navigate to Report tab
    await page.locator('button.tab').filter({ hasText: '今日帳' }).click();
    
    // 4. Verify report screen loaded
    await expect(page.locator('.screen.report, .report-screen')).toBeVisible({ timeout: 5000 });
    
    // 5. Go back to POS tab
    await page.locator('button.tab').filter({ hasText: '櫃台' }).click();
    
    // 6. Verify POS screen is back
    await expect(page.locator('.search-input')).toBeVisible({ timeout: 5000 });
  });
});
