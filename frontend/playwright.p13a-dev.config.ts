import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/p13a-dev-init.spec.ts'],
  timeout: 45000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    serviceWorkers: 'allow',
  },
  webServer: {
    command:
      'VITE_FIREBASE_API_KEY=dummy-api-key ' +
      'VITE_FIREBASE_AUTH_DOMAIN=demo-easyorder.firebaseapp.com ' +
      'VITE_FIREBASE_PROJECT_ID=demo-easyorder ' +
      'VITE_FIREBASE_APP_ID=dummy-app-id ' +
      'VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000 ' +
      'VITE_FIREBASE_STORAGE_BUCKET=demo-easyorder.appspot.com ' +
      'VITE_FIREBASE_USE_EMULATOR=true ' +
      'VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1 ' +
      'VITE_FIRESTORE_EMULATOR_PORT=8080 ' +
      'VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 ' +
      'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    port: 4174,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
