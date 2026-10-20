import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/p13a-no-config.spec.ts'],
  timeout: 45000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    serviceWorkers: 'allow',
  },
  webServer: {
    command:
      'env -i PATH="$PATH" HOME="$HOME" npm run build -- --mode p13a-no-config --config vite.p13a-no-config.config.ts && ' +
      'env -i PATH="$PATH" HOME="$HOME" npx vite preview --host 127.0.0.1 --port 4175 --strictPort',
    port: 4175,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
