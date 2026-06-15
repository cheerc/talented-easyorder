// Deposit (payment) flow e2e test — Login → Select student → Switch to payment → Enter amount → Confirm
// Ref: #269

import { test, expect } from './fixtures';

test.describe('Deposit Flow', () => {
  test('deposit payment for a student', async ({ authedPage: page }) => {
    // 1. Type student name in search box
    const searchInput = page.locator('.search-input');
    await searchInput.fill('李');
    
    // 2. Select student from suggestions
    await expect(page.locator('.sug-name').filter({ hasText: '李小華' })).toBeVisible({ timeout: 5000 });
    await page.locator('.sug-row').filter({ hasText: '李小華' }).click();
    
    // 3. Customer card should appear
    await expect(page.locator('.cust-name')).toContainText('李小華');
    
    // 4. Switch to payment (繳費) mode
    await page.locator('.mode').filter({ hasText: '繳費' }).click();
    
    // 5. Enter payment amount in the NumericInput
    const payInput = page.locator('.customer input[type="text"], .customer input[inputmode="numeric"]');
    await payInput.fill('500');
    
    // 6. Click confirm
    await page.locator('.btn-confirm').click();
    
    // 7. Should show success flash
    await expect(page.locator('.flash, .confirm-banner')).toBeVisible({ timeout: 5000 });
  });
});
