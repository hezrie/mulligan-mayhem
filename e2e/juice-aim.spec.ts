import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { getFx, openHole, screenshot, waitFrames } from './juice-helpers.ts';

interface AimFx {
  cancel: boolean;
  bandWidth: number;
  litTicks: number;
  color: string;
}

/** Presses on the ball and drags `dy` CSS px straight down, without releasing. */
async function dragFromBall(page: Page, dy: number): Promise<void> {
  const ball = await page.evaluate(() => window.__MM__!.getBallClientPosition());
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  await page.mouse.move(ball.x, ball.y + dy, { steps: 6 });
  // Two frames, so the game has drawn the last move before we read what it drew.
  await waitFrames(page, 2);
}

test.describe('slingshot band, power ring and cancel state', () => {
  test('a 90 px drag shows a live aim whose lit ticks match the launch speed', async ({
    page,
  }, testInfo) => {
    await openHole(page, 'skeleton-01', 1);
    await dragFromBall(page, 90);

    const aim = await getFx<AimFx>(page, 'aim');
    expect(aim.cancel).toBe(false);
    await screenshot(page, testInfo, 'juice-aim');

    await page.mouse.up();
    const { vel } = (await page.evaluate(() => window.__MM__!.getState())).ball;
    expect(aim.litTicks).toBe(Math.floor((Math.hypot(vel.x, vel.y) / 800) * 10 + 1e-9));
  });

  test('a 2 px drag greys out to Release to cancel and releasing takes no stroke', async ({
    page,
  }, testInfo) => {
    await openHole(page, 'skeleton-01', 1);
    await dragFromBall(page, 2);

    const aim = await getFx<AimFx>(page, 'aim');
    expect(aim.cancel).toBe(true);
    expect(aim.color).toBe('#9e9e9e');
    await screenshot(page, testInfo, 'juice-aim-cancel');

    await page.mouse.up();
    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(0);
    await expect.poll(() => getFx<AimFx | null>(page, 'aim'), { timeout: 1000 }).toBeNull();
  });
});
