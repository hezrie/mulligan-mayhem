import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { openHole, screenshot } from './juice-helpers.ts';

/** Sinks skeleton-01 in one and returns the page clock at the drop. */
const holeInOne = (page: Page): Promise<number> =>
  page.evaluate(() => {
    window.__MM__!.shoot(-2.481, 0.925);
    window.__MM__!.fastForward('untilRest');
    return performance.now();
  });

/** Resolves with the page clock at the first check that finds the dialog visible. */
async function dialogShownAt(page: Page): Promise<number> {
  const handle = await page.waitForFunction(
    () => {
      const el = document.querySelector<HTMLElement>('[role="dialog"]');
      const visible = el !== null && !el.hidden && el.getClientRects().length > 0;
      return visible ? performance.now() : false;
    },
    undefined,
    { polling: 'raf', timeout: 5000 },
  );
  return (await handle.jsonValue()) as number;
}

test.describe('hole-complete dialog waits for the plunk', () => {
  test('the dialog appears no sooner than 900 ms after the drop', async ({ page }, testInfo) => {
    await openHole(page, 'skeleton-01', 1);
    const t0 = await holeInOne(page);
    const shown = await dialogShownAt(page);
    expect(shown - t0).toBeGreaterThanOrEqual(850);
    await expect(page.getByTestId('complete-message')).toHaveText(
      'Hole complete — 1 stroke (Hole in one!)',
    );
    await screenshot(page, testInfo, 'juice-complete-delay');
  });

  test('loading a hole during the hold cancels it and resets the timer', async ({ page }) => {
    await openHole(page, 'skeleton-01', 1);
    await holeInOne(page);
    await page.waitForTimeout(300);
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeHidden();

    await page.evaluate(() => {
      window.__MM__!.loadHole('skeleton-01', 1);
    });
    await page.waitForTimeout(1500);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('strokes')).toHaveText('0');

    const t1 = await holeInOne(page);
    const shown = await dialogShownAt(page);
    expect(shown - t1).toBeGreaterThanOrEqual(850);
  });
});
