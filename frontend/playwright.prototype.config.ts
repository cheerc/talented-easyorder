import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // These are local POS regressions that use the app's real prototype-mode fixture data.
  testMatch: [
    '**/deposit-flow.spec.ts',
    '**/expense-flow.spec.ts',
    '**/order-flow.spec.ts',
    '**/settlement-flow.spec.ts',
  ],
  testIgnore: ['**/auth.spec.ts', '**/cloud-production.spec.ts', '**/smoke.spec.ts'],
  timeout: 30000,
  retries: 0,
  // Keep the small local POS suite serial so the user flows run in a predictable order.
  workers: 1,
  fullyParallel: false,
  projects: [{ name: 'prototype-chromium' }],
  use: {
    baseURL: 'http://127.0.0.1:5175',
    bypassCSP: true,
  },
  // Prototype mode runs without Firebase config, Auth/Firestore emulators or global setup.
  webServer: {
    command: 'npm run dev:prototype -- --host 127.0.0.1 --port 5175',
    port: 5175,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
