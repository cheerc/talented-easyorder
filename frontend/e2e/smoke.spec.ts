import { test, expect } from '@playwright/test';

test.describe('EasyOrder Smoke', () => {
  test('app loads and shows auth gate', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();

    await expect(page.getByLabel('載入中')).toHaveCount(0);
  });
});
