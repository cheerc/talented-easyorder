// Custom Playwright test fixture with Firebase Auth Emulator authentication
// Uses dynamic import of firebase/auth in browser context — works because
// the app loads the full firebase/auth module via dynamic import().
// Ref: #269

import { test as base, type Page } from '@playwright/test';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    await page.goto('/');

    // Wait for Firebase SDK to initialize (app shows auth gate when ready)
    await page.waitForSelector('.auth-gate', { timeout: 15000 });

    // Sign in via browser context — firebase/auth is loaded as a full dynamic module,
    // so signInWithEmailAndPassword is available despite not being explicitly imported by the app.
    await page.evaluate(async () => {
      const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
      const auth = getAuth();
      await signInWithEmailAndPassword(auth, 'test@talented.com.tw', 'test1234');
    });

    // Wait for auth gate to disappear and operator strip to appear
    await page.waitForSelector('.operator-strip', { timeout: 15000 });

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect } from '@playwright/test';
