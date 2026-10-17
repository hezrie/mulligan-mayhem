import { expect, test } from './fixtures.ts';

test('loads the game canvas and exposes the test API in e2e builds', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('canvas#game')).toBeVisible();
  await page.waitForFunction(() => window.__MM__?.ready === true);
});

test('the course fits the viewport with a crisp backing store', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      right: rect.right,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      backingWidth: canvas.width,
      expectedBackingWidth: Math.round(rect.width * window.devicePixelRatio),
      backingHeight: canvas.height,
      expectedBackingHeight: Math.round(rect.height * window.devicePixelRatio),
    };
  });
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 0.5);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 0.5);
  expect(layout.backingWidth).toBe(layout.expectedBackingWidth);
  expect(layout.backingHeight).toBe(layout.expectedBackingHeight);
});
