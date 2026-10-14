// Prototype POS regression — Select student → Switch to payment → Enter amount → Confirm
// Ref: #269

import { test, expect } from './prototype-fixtures';

test.describe('Deposit Flow', () => {
  test('deposit payment for a prototype student', async ({ prototypePage: page }) => {
    // 1. Search by the synthetic prototype fixture ID.
    const searchInput = page.locator('.search-input');
    await searchInput.fill('S002');
    
    // 2. Select student from suggestions
    await expect(page.locator('.sug-id').filter({ hasText: 'S002' })).toBeVisible({ timeout: 5000 });
    await page.locator('.sug-row').filter({ hasText: 'S002' }).click();
    
    // 3. Customer card should appear
    await expect(page.locator('.customer')).toBeVisible();
    await expect(page.locator('.cust-id')).toContainText('S002');
    
    // 4. Switch to payment (繳費) mode
    await page.locator('.mode').filter({ hasText: '繳費' }).click();
    
    // 5. Enter payment amount in the NumericInput
    const payInput = page.locator('.customer input[data-numeric-input]');
    await payInput.fill('500');
    
    // 6. Press Enter to confirm (Ref: #399 — btn-confirm removed, keyboard Enter confirms)
    await page.keyboard.press('Enter');
    
    // 7. Should show success flash
    await expect(page.locator('.flash, .confirm-banner')).toBeVisible({ timeout: 5000 });
  });
});
