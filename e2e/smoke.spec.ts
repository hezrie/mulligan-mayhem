import { expect, test } from './fixtures.ts';

test('loads the game canvas and exposes the test API in e2e builds', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('canvas#game')).toBeVisible();
  await page.waitForFunction(() => window.__MM__?.ready === true);
});
