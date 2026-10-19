import { expect, test } from './fixtures.ts';
import { getFx, screenshot } from './juice-helpers.ts';

interface Pace {
  rate: number;
  slowFrames: number;
}

test.describe('bullet time near the cup', () => {
  test('the real-time loop slows the hole in one near the cup and the result is unchanged', async ({
    page,
  }, testInfo) => {
    // No loadHole: it switches to the manual clock, and bullet time paces the real-time loop.
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    await page.evaluate(() => {
      window.__MM__!.shoot(-2.481, 0.925);
    });

    await page.waitForFunction(() => window.__MM__!.getState().phase === 'holed', undefined, {
      timeout: 10_000,
    });

    // The frame that holes the ball was paced before it stepped, so the rate the loop reports
    // drops back to 1 on the next frame, when it sees phase 'holed'.
    await expect
      .poll(async () => (await getFx<Pace>(page, 'pace')).rate, { timeout: 1000 })
      .toBe(1);
    expect((await getFx<Pace>(page, 'pace')).slowFrames).toBeGreaterThanOrEqual(1);
    const state = await page.evaluate(() => window.__MM__!.getState());
    expect(state.strokes).toBe(1);
    expect(state.ball.pos).toEqual({ x: 220, y: 110 });
    await screenshot(page, testInfo, 'juice-bullet-time');
  });
});
