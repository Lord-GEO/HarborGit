import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: ['electron.spec.ts', 'history-ui.spec.ts'], fullyParallel: false, workers: 1,
  timeout: 120000, expect: { timeout: 15000 }, retries: 0,
  reporter: [['list']], outputDir: 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
