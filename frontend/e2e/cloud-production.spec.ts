// Cloud production E2E tests: A01–A04
// Ref: spec §4.1, §4.2, plan §P04

import { test, expect } from './fixtures';

test.describe('Cloud Production Authentication & Access Lease', () => {
  test('A01: auth gate shown with Google login option when signed out', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
  });

  test('A02: approved operator acquires lease and sees operator strip', async ({ authedPage: page }) => {
    // authedPage logs in via emulator and acquires lease
    await expect(page.locator('.operator-strip')).toBeVisible({ timeout: 15000 });
  });

  test('A03: operator strip displays lease epoch indicator', async ({ authedPage: page }) => {
    await expect(page.locator('.operator-strip')).toBeVisible();
    await expect(page.locator('.operator-strip')).toContainText('租約 Epoch');
  });

  test('A04: operator strip provides release lease and sign out button', async ({ authedPage: page }) => {
    const signOutBtn = page.getByRole('button', { name: '釋放使用權並登出' });
    await expect(signOutBtn).toBeVisible();
  });
});
