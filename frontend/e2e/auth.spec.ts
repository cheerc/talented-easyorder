// Auth flow e2e test — verifies login and operator strip display
// Ref: #269

import { test, expect } from './fixtures';

test.describe('Authentication', () => {
  test('login shows the P06 student surface without mounting POS tabs', async ({ authedPage: page }) => {
    // Operator strip should be visible after auth
    await expect(page.locator('.operator-strip')).toBeVisible();

    await expect(page.getByRole('heading', { name: '學生名單與期初結餘' })).toBeVisible();
    await expect(page.locator('.app')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /訂餐|繳費|送出訂單/ })).toHaveCount(0);
  });

  test('auth gate shown when not logged in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
  });
});
