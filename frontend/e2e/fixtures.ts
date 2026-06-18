// Custom Playwright test fixture with Firebase Auth Emulator authentication
// Uses dynamic import of firebase/auth in browser context — works because
// the app loads the full firebase/auth module via dynamic import().
// Ref: #269

import { test as base, type Page } from '@playwright/test';

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER UNCAUGHT ERROR] ${err.message}`));

    await page.goto('/');

    // Wait for Firebase SDK to initialize (app shows auth gate when ready)
    await page.waitForSelector('.auth-gate', { timeout: 15000 });

    // Sign in via browser context — uses window.emulatorSignIn helper if available
    // to bypass native module resolution issues of 'firebase/auth' in Vite production build.
    await page.evaluate(async () => {
      const win = window as unknown as { emulatorSignIn?: (email: string, pass: string) => Promise<unknown> };
      if (win.emulatorSignIn) {
        await win.emulatorSignIn('test@talented.com.tw', 'test1234');
      } else {
        const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
        const auth = getAuth();
        await signInWithEmailAndPassword(auth, 'test@talented.com.tw', 'test1234');
      }
    });

    // Wait for auth gate to disappear and operator strip to appear
    await page.waitForSelector('.operator-strip', { timeout: 15000 });

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
});

export { expect } from '@playwright/test';
