import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures.ts';

test('production build loads without console errors', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('canvas#game')).toBeVisible();
});

test('production build does not expose the test API at runtime', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('canvas#game')).toBeVisible();
  expect(await page.evaluate(() => typeof window.__MM__)).toBe('undefined');
});

test('production bundle contains no test API code', () => {
  const assetsDir = join(process.cwd(), 'dist', 'assets');
  const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  expect(jsFiles.length).toBeGreaterThan(0);
  for (const file of jsFiles) {
    const source = readFileSync(join(assetsDir, file), 'utf8');
    expect(source, `${file} must not contain the test API`).not.toContain('__MM__');
  }
});
