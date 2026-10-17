import { defineConfig, devices } from '@playwright/test';
import { BASE_PATH } from './vite.config.ts';

// Two preview servers:
//  - dist-e2e/ (built with --mode e2e): has window.__MM__, used by the gameplay specs
//  - dist/     (the real production build): only smoke-tested, must NOT expose window.__MM__
const E2E_PORT = 4319;
const PROD_PORT = 4320;
const e2eURL = `http://localhost:${String(E2E_PORT)}${BASE_PATH}`;
const prodURL = `http://localhost:${String(PROD_PORT)}${BASE_PATH}`;
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/artifacts',
  fullyParallel: true,
  forbidOnly: true,
  // No retries: a flaky test is a bug to fix or escalate, never something to paper over.
  retries: 0,
  ...(isCI ? { workers: 2 } : {}),
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /prod-smoke/,
      use: { ...devices['Desktop Chrome'], baseURL: e2eURL },
    },
    {
      name: 'mobile',
      testIgnore: /prod-smoke/,
      use: { ...devices['Pixel 7'], baseURL: e2eURL },
    },
    {
      name: 'prod-smoke',
      testMatch: /prod-smoke/,
      use: { ...devices['Desktop Chrome'], baseURL: prodURL },
    },
  ],
  webServer: [
    {
      command: `npx vite preview --outDir dist-e2e --port ${String(E2E_PORT)} --strictPort`,
      url: e2eURL,
      reuseExistingServer: false,
    },
    {
      command: `npx vite preview --outDir dist --port ${String(PROD_PORT)} --strictPort`,
      url: prodURL,
      reuseExistingServer: false,
    },
  ],
});
