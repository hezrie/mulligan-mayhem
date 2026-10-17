import { test as base, expect } from '@playwright/test';

/**
 * Every e2e test gets `consoleErrors` and automatically fails if the page logged any
 * console error or threw an uncaught exception. Import `test` from here, not from Playwright.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        errors.push(`pageerror: ${err.message}`);
      });
      await use(errors);
      expect(errors, 'the page must not log console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
// Re-exported so specs see the `window.__MM__` global declaration.
export type { MulliganTestApi } from '../src/testing/types.ts';
