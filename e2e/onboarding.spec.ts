import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

const CAPTION = 'Drag back from the ball, then let go';

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
}

/** A real pointer shot: press on the ball, drag 90 px down in 6 steps, release. */
async function dragShot(page: Page): Promise<void> {
  const ball = await page.evaluate(() => window.__MM__!.getBallClientPosition());
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  await page.mouse.move(ball.x, ball.y + 90, { steps: 6 });
  await page.mouse.up();
}

const strokes = (page: Page): Promise<number> =>
  page.evaluate(() => window.__MM__!.getState().strokes);

test.describe('first-run onboarding', () => {
  test('fresh storage shows the caption, which never blocks pointers', async ({
    page,
  }, testInfo) => {
    await ready(page);
    const caption = page.getByTestId('onboarding-caption');
    await expect(caption).toBeVisible();
    await expect(caption).toHaveText(CAPTION);
    expect(await caption.evaluate((el) => el.textContent)).toBe(CAPTION);
    expect(await caption.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    // Let the ghost hand fade in and start its drag before the screenshot.
    await page.waitForTimeout(800);
    await screenshot(page, testInfo, 'first-run');
  });

  test('a real drag shot hides the caption and saves the flag across reloads', async ({ page }) => {
    await ready(page);
    await expect(page.getByTestId('onboarding-caption')).toBeVisible();
    await dragShot(page);
    await expect(page.getByTestId('onboarding-caption')).toBeHidden();
    const onboarded = await page.evaluate(
      () =>
        (
          JSON.parse(localStorage.getItem('mm.save.v1') ?? 'null') as {
            flags?: { onboarded?: boolean };
          } | null
        )?.flags?.onboarded,
    );
    expect(onboarded).toBe(true);

    await page.reload();
    await page.waitForFunction(() => window.__MM__?.ready === true);
    expect(await strokes(page)).toBe(0);
    await expect(page.getByTestId('onboarding-caption')).toBeHidden();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('onboarding-caption')).toBeHidden();
  });

  test('test-API shots are not real shots and do not set the flag', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const mm = window.__MM__!;
      mm.loadHole('skeleton-01');
      mm.shoot(-Math.PI / 2, 0.3);
      mm.fastForward('untilRest');
    });
    expect(await strokes(page)).toBeGreaterThan(0);
    const raw = await page.evaluate(() => localStorage.getItem('mm.save.v1'));
    if (raw !== null) {
      const save = JSON.parse(raw) as { flags?: { onboarded?: boolean } };
      expect(save.flags?.onboarded).toBeUndefined();
    }
    await expect(page.getByTestId('onboarding-caption')).toBeHidden();
  });

  test('with storage that throws, a real shot still hides the caption for the session', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('storage blocked');
      };
      Storage.prototype.setItem = () => {
        throw new Error('storage blocked');
      };
    });
    await ready(page);
    const caption = page.getByTestId('onboarding-caption');
    await expect(caption).toBeVisible();
    await dragShot(page);
    await expect(caption).toBeHidden();
    await page.evaluate(() => {
      window.__MM__!.fastForward('untilRest');
      window.__MM__!.loadHole('skeleton-01');
    });
    expect(await strokes(page)).toBe(0);
    await page.waitForTimeout(300);
    await expect(caption).toBeHidden();
  });
});
