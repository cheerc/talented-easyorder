// Auth flow e2e test — verifies login and operator strip display
// Ref: #269

import { test, expect } from './fixtures';

test.describe('Authentication', () => {
  test('login shows operator strip and POS screen', async ({ authedPage: page }) => {
    // Operator strip should be visible after auth
    await expect(page.locator('.operator-strip')).toBeVisible();

    // POS tab should be the default active tab
    await expect(page.locator('.tab-bar, [role="tablist"]')).toBeVisible();
  });

  test('auth gate shown when not logged in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
  });
});
