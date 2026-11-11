import { expect, type Page } from '@playwright/test';

/**
 * #691 P9: a signed-in, approved account enters the system by itself when nobody is using it, so there is no button to press.
 * Waits for the operator menu of the entered system. `reload` is for tests that seeded data or a pending command after the
 * sign-in: the pages read their data when they open, so the entered system is opened again to show it.
 */
export async function enterSystem(page: Page, options: { reload?: boolean } = {}): Promise<void> {
  if (options.reload) await page.reload();
  await expect(page.locator('.operator-strip')).toBeVisible({ timeout: 20_000 });
}
