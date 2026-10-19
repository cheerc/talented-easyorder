import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  // Run the P12c report/history browser contract in its own clean emulator invocation.
  testMatch: ['**/cloud-report-history.spec.ts'],
  reporter: [['html', { outputFolder: 'playwright-report/p12c', open: 'never' }]],
  use: { ...baseConfig.use, trace: 'on' },
});
