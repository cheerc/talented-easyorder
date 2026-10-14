// Pure POS regression fixture for the app's isolated local practice mode.
// This deliberately performs no Firebase sign-in, emulator setup or browser data injection.

import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ prototypePage: Page }>({
  prototypePage: async ({ page }, use) => {
    await page.goto('/');
    await page.waitForSelector('.app', { timeout: 15000 });
    await expect(page.locator('.sync-label')).toHaveText('本機練習 · 僅此瀏覽器');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect };
