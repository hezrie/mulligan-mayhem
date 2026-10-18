import { expect, test } from './fixtures.ts';
import { getFx, loadReplay, openHole, playShots, screenshot } from './juice-helpers.ts';

interface EventCounts {
  bounce: number;
  cup: number;
  rest: number;
  holed: number;
}

test.describe('renderer frame input: real-time clock and game events', () => {
  test('a shot that banks once and stops counts one bounce and one rest', async ({
    page,
  }, testInfo) => {
    await openHole(page, 'skeleton-01', 1);
    await page.evaluate(() => {
      window.__MM__!.shoot(-1.4, 0.7);
      window.__MM__!.fastForward('untilRest');
    });
    await expect
      .poll(() => getFx<EventCounts>(page, 'events'), { timeout: 1000 })
      .toEqual({ bounce: 1, cup: 0, rest: 1, holed: 0 });
    await screenshot(page, testInfo, 'juice-frame-rest');
  });

  test('the hole-in-one replay counts one bounce, one cup and one holed', async ({ page }) => {
    const replay = loadReplay('skeleton-01-hole-in-one.json');
    await openHole(page, replay.holeId, replay.seed);
    await playShots(page, replay.shots);
    await expect
      .poll(() => getFx<EventCounts>(page, 'events'), { timeout: 1000 })
      .toEqual({ bounce: 1, cup: 1, rest: 0, holed: 1 });
  });

  test('the effects clock keeps running while the simulation is on the manual clock', async ({
    page,
  }) => {
    await openHole(page);
    const read = () =>
      page.evaluate(() => ({
        nowMs: (window.__MM__!.getFx()['clock'] as { nowMs: number }).nowMs,
        step: window.__MM__!.getState().step,
      }));
    const first = await read();
    await page.waitForTimeout(250);
    const second = await read();
    expect(second.nowMs - first.nowMs).toBeGreaterThanOrEqual(200);
    expect(second.step).toBe(first.step);
  });
});
