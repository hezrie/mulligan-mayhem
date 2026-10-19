import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

/** Far enough from the ball to be outside GRAB_RADIUS at both projects' scales. */
const OFFSET_PX = 150;

async function storeAimMode(page: Page, aimMode: string): Promise<void> {
  await page.addInitScript((mode) => {
    window.localStorage.setItem('mm.settings.v1', JSON.stringify({ version: 1, aimMode: mode }));
  }, aimMode);
}

async function openHole(page: Page): Promise<{ x: number; y: number }> {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
  await page.evaluate(() => {
    window.__MM__!.loadHole('skeleton-01');
  });
  return page.evaluate(() => window.__MM__!.getBallClientPosition());
}

test.describe("aim mode 'Drag anywhere'", () => {
  test('a drag that starts away from the ball shoots the opposite way', async ({
    page,
  }, testInfo) => {
    await storeAimMode(page, 'anywhere');
    const ball = await openHole(page);

    await page.mouse.move(ball.x - OFFSET_PX, ball.y);
    await page.mouse.down();
    await page.mouse.move(ball.x - OFFSET_PX, ball.y + 90, { steps: 6 });
    await screenshot(page, testInfo, 'aim-anywhere');
    await page.mouse.up();

    const state = await page.evaluate(() => window.__MM__!.getState());
    expect(state.strokes).toBe(1);
    expect(state.phase).toBe('rolling');
    expect(state.ball.vel.y).toBeLessThan(0);
    expect(Math.abs(state.ball.vel.x)).toBeLessThan(Math.abs(state.ball.vel.y) / 10);
  });

  test('pressing and releasing at the same point is a cancel', async ({ page }) => {
    await storeAimMode(page, 'anywhere');
    const ball = await openHole(page);

    await page.mouse.move(ball.x - OFFSET_PX, ball.y);
    await page.mouse.down();
    await page.mouse.up();

    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(0);
  });

  test("with no stored settings ('Grab the ball') the same drag takes no stroke", async ({
    page,
  }) => {
    const ball = await openHole(page);

    await page.mouse.move(ball.x - OFFSET_PX, ball.y);
    await page.mouse.down();
    await page.mouse.move(ball.x - OFFSET_PX, ball.y + 90, { steps: 6 });
    await page.mouse.up();

    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(0);
  });
});
