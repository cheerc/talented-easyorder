import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Cloud suite: authenticated access/lease and signed-out gate behavior only.
  testMatch: ['**/auth.spec.ts', '**/cloud-production.spec.ts', '**/smoke.spec.ts'],
  testIgnore: [
    '**/deposit-flow.spec.ts',
    '**/expense-flow.spec.ts',
    '**/order-flow.spec.ts',
    '**/settlement-flow.spec.ts',
  ],
  globalSetup: './e2e/global-setup.ts',
  timeout: 30000,
  retries: 0,
  // Every E2E identity contends on the one demo accessLease document.
  // Keep all cloud cases sequential so no test races the P04 lease scenarios.
  workers: 1,
  fullyParallel: false,
  projects: [{ name: 'chromium' }],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    bypassCSP: true,
  },
  webServer: {
    command:
      'VITE_FIREBASE_API_KEY=dummy-api-key ' +
      'VITE_FIREBASE_AUTH_DOMAIN=dummy-auth-domain ' +
      'VITE_FIREBASE_PROJECT_ID=demo-easyorder ' +
      'VITE_FIREBASE_APP_ID=dummy-app-id ' +
      'VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000 ' +
      'VITE_FIREBASE_STORAGE_BUCKET=dummy-bucket ' +
      'VITE_FIREBASE_USE_EMULATOR=true ' +
      'VITE_ALLOWED_EMAIL_DOMAIN=talented.com.tw ' +
      'VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1 ' +
      'VITE_FIRESTORE_EMULATOR_PORT=8080 ' +
      'VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 ' +
      'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    port: 4173,
    timeout: 120000,
    // Always build and start this source revision; fail if another process owns 4173.
    reuseExistingServer: false,
  },
});
