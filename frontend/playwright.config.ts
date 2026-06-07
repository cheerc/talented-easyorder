import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  projects: [{ name: 'chromium' }],
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command:
      'VITE_FIREBASE_API_KEY=dummy-api-key ' +
      'VITE_FIREBASE_AUTH_DOMAIN=dummy-auth-domain ' +
      'VITE_FIREBASE_PROJECT_ID=dummy-project-id ' +
      'VITE_FIREBASE_APP_ID=dummy-app-id ' +
      'VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000 ' +
      'VITE_FIREBASE_STORAGE_BUCKET=dummy-bucket ' +
      'VITE_FIREBASE_USE_EMULATOR=true ' +
      'VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1 ' +
      'VITE_FIRESTORE_EMULATOR_PORT=8080 ' +
      'VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 ' +
      'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
