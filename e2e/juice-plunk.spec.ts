import { expect, test } from './fixtures.ts';
import { getFx, loadReplay, openHole, playShots, screenshot } from './juice-helpers.ts';

interface Plunk {
  elapsedMs: number;
  stamp: string;
  done: boolean;
}

test.describe('cup plunk: flag, ball drop, ripple and score stamp', () => {
  test('a hole in one stamps HOLE IN ONE! and the plunk finishes on the real-time clock', async ({
    page,
  }, testInfo) => {
    await openHole(page, 'skeleton-01', 1);
    await playShots(page, loadReplay('skeleton-01-hole-in-one.json').shots);

    await expect
      .poll(() => getFx<Plunk | null>(page, 'plunk'), { timeout: 3000 })
      .toMatchObject({ stamp: 'HOLE IN ONE!', done: true });

    const first = await getFx<Plunk>(page, 'plunk');
    await page.waitForTimeout(300);
    const second = await getFx<Plunk>(page, 'plunk');
    expect(second.elapsedMs - first.elapsedMs).toBeGreaterThanOrEqual(250);
    await screenshot(page, testInfo, 'juice-plunk');
  });

  test('a par round stamps PAR and Play again clears the plunk', async ({ page }) => {
    await openHole(page, 'skeleton-01', 1);
    await playShots(page, loadReplay('skeleton-01-par.json').shots);

    await expect
      .poll(async () => (await getFx<Plunk | null>(page, 'plunk'))?.stamp, { timeout: 3000 })
      .toBe('PAR');

    await page.getByRole('button', { name: 'Play again' }).click();
    await expect.poll(() => getFx<Plunk | null>(page, 'plunk'), { timeout: 1000 }).toBeNull();
  });
});
