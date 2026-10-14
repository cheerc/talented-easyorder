// Auth flow e2e test — verifies login and operator strip display
// Ref: #269

import { test, expect } from './fixtures';

test.describe('Authentication', () => {
  test('login shows operator strip and keeps cloud business closed', async ({ authedPage: page }) => {
    // Operator strip should be visible after auth
    await expect(page.locator('.operator-strip')).toBeVisible();

    await expect(page.getByTestId('cloud-business-closed')).toContainText('業務功能暫未開放');
    await expect(page.locator('.app')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
  });

  test('auth gate shown when not logged in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
  });
});
