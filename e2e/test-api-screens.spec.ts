import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__MM__?.ready === true);
}

test.describe('__MM__ screen and storage helpers', () => {
  test('the root URL reports the play screen', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    expect(await page.evaluate(() => window.__MM__!.getScreen())).toBe('play');
  });

  test('seeded storage survives a reload and clears by prefix', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await page.evaluate(() => {
      window.__MM__!.seedStorage({ 'mm-e2e:k': 'v' });
    });
    await page.reload();
    await ready(page);
    expect(await page.evaluate(() => window.__MM__!.readStorage('mm-e2e:'))).toEqual({
      'mm-e2e:k': 'v',
    });
    await page.evaluate(() => {
      window.__MM__!.clearStorage('mm-e2e:');
    });
    expect(await page.evaluate(() => window.__MM__!.readStorage('mm-e2e:'))).toEqual({});
  });

  test('goTo an unknown screen rejects', async ({ page }) => {
    await page.goto('./');
    await ready(page);
    await expect(
      page.evaluate(() => {
        window.__MM__!.goTo('nowhere');
      }),
    ).rejects.toThrow('Unknown screen');
  });
});
