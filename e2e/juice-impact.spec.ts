import { expect, test } from './fixtures.ts';
import { getFx, openHole, screenshot } from './juice-helpers.ts';

interface Impact {
  trauma: number;
  shakePx: number;
  ballAlong: number;
}

test.describe('impact kit: screen shake, stretch and squash, drop shadow', () => {
  test('a wall hit shakes the hole, and the shake and stretch settle at rest', async ({
    page,
  }, testInfo) => {
    await openHole(page, 'skeleton-01', 1);
    // 48 steps: the single bounce is at step 46 (impulse 748.5476) and the ball is still rolling.
    await page.evaluate(() => {
      window.__MM__!.shoot(-1.4, 0.7);
      window.__MM__!.fastForward(400);
    });

    const handle = await page.waitForFunction(() => {
      const impact = window.__MM__!.getFx()['impact'] as { trauma: number } | undefined;
      return impact && impact.trauma > 0 ? impact : null;
    });
    const hit = (await handle.jsonValue()) as Impact;
    expect(hit.trauma).toBeGreaterThanOrEqual(0.58);
    expect(hit.trauma).toBeLessThanOrEqual(0.7486);
    expect(hit.shakePx).toBeGreaterThan(0);
    await screenshot(page, testInfo, 'juice-impact');

    await page.evaluate(() => {
      window.__MM__!.fastForward('untilRest');
    });
    expect(await page.evaluate(() => window.__MM__!.getState().phase)).toBe('aiming');
    await expect
      .poll(() => getFx<Impact>(page, 'impact'), { timeout: 500 })
      .toMatchObject({ shakePx: 0, ballAlong: 1 });
  });
});
