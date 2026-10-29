import { releaseOwner } from './helpers/navigation';
// Shared Playwright fixtures. Every signed-in session is a synthetic Google Auth Emulator user.

import { test as base, type Browser, type Page } from '@playwright/test';
import { E2E_IDENTITIES } from './helpers/auth';
import { readAccessLease } from './helpers/seed';

export const E2E_BASE_URL = 'http://127.0.0.1:4173';

export interface GoogleSession {
  page: Page;
  email: string;
  uid: string;
  providerIds: string[];
}

type BrowserEmulatorHelpers = Window & {
  emulatorSignIn?: (email: string, legacyUnusedPassword?: string) => Promise<{
    uid: string;
    email: string | null;
    providerIds: string[];
  }>;
  emulatorSignInGoogle?: (email: string) => Promise<{
    uid: string;
    email: string | null;
    providerIds: string[];
  }>;
};

export async function signInGoogle(page: Page, email: string): Promise<GoogleSession> {
  await page.goto('/');
  await page.waitForSelector('.auth-gate', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const win = window as BrowserEmulatorHelpers;
      return Boolean(win.emulatorSignInGoogle || win.emulatorSignIn);
    },
    undefined,
    { timeout: 15000 },
  );

  const identity = await page.evaluate(async inputEmail => {
    const win = window as BrowserEmulatorHelpers;
    const signIn = win.emulatorSignInGoogle ?? win.emulatorSignIn;
    if (!signIn) throw new Error('Google Auth Emulator helper is unavailable');
    return signIn(inputEmail);
  }, email);

  if (!identity.providerIds.includes('google.com')) {
    throw new Error(`Auth Emulator did not return a google.com provider for ${email}`);
  }
  return { page, email, uid: identity.uid, providerIds: identity.providerIds };
}

export async function openGoogleSession(browser: Browser, email: string): Promise<GoogleSession & { close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[BROWSER UNCAUGHT ERROR] ${err.message}`));
  const session = await signInGoogle(page, email);
  return { ...session, close: () => context.close() };
}

async function waitForVacantLease(): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const lease = await readAccessLease();
    if (lease.holderUid === null) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('The Firestore Emulator lease was not released after the test');
}

export const test = base.extend<{ googleSession: GoogleSession; authedPage: Page }>({
  googleSession: async ({ page }, use) => {
    page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[BROWSER UNCAUGHT ERROR] ${err.message}`));
    const session = await signInGoogle(page, E2E_IDENTITIES.operatorA.email);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(session);
  },

  authedPage: async ({ googleSession }, use) => {
    const page = googleSession.page;
    const acquireButton = page.getByRole('button', { name: '取得系統使用權' });
    await acquireButton.waitFor({ state: 'visible', timeout: 15000 });
    await acquireButton.click();
    await page.waitForSelector('.operator-strip', { timeout: 15000 });

    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
    if (!page.isClosed()) {
      const releaseButton = page.locator('.operator-strip button').filter({ hasText: '釋放使用權並登出' });
      if (await releaseButton.count() && await releaseButton.isEnabled().catch(() => false)) {
        await releaseOwner(releaseButton);
        await waitForVacantLease();
      }
    }
  },
});

export { expect } from '@playwright/test';
