import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
}

const step = (page: Page): Promise<number> => page.evaluate(() => window.__MM__!.getState().step);

test.describe('pause overlay', () => {
  test('the ☰ button opens Paused with its four buttons in order', async ({ page }, testInfo) => {
    await ready(page);
    const menu = page.getByTestId('hud-menu');
    await expect(menu).toHaveAttribute('aria-label', 'Menu');
    await expect(menu).toHaveText('☰');
    const box = await menu.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await menu.click();
    const pause = page.getByTestId('screen-pause');
    await expect(pause).toBeVisible();
    await expect(pause.getByRole('heading', { name: 'Paused' })).toBeVisible();
    const buttons = await pause
      .locator('button')
      .evaluateAll((els) => els.map((el) => [el.getAttribute('data-testid'), el.textContent]));
    expect(buttons).toEqual([
      ['pause-resume', 'Resume'],
      ['pause-restart', 'Restart hole'],
      ['pause-settings', 'Settings'],
      ['pause-quit', 'Quit to title'],
    ]);
    for (const [id] of buttons) {
      const b = await page.getByTestId(id ?? '').boundingBox();
      expect(b?.height).toBeGreaterThanOrEqual(48);
    }
    await screenshot(page, testInfo, 'pause');
  });

  test('pausing freezes the real-time simulation and Resume restarts it', async ({ page }) => {
    await ready(page);
    const s0 = await step(page);
    await expect.poll(() => step(page)).toBeGreaterThan(s0);
    await page.getByTestId('hud-menu').click();
    await expect(page.getByTestId('screen-pause')).toBeVisible();
    const s1 = await step(page);
    await page.waitForTimeout(500);
    expect(await step(page)).toBe(s1);

    await page.getByTestId('pause-resume').click();
    await expect(page.getByTestId('screen-pause')).toHaveCount(0);
    await expect.poll(() => step(page), { timeout: 2000 }).toBeGreaterThan(s1);
  });

  test('Restart hole resets the hole and closes the overlay', async ({ page }) => {
    await ready(page);
    const strokes = await page.evaluate(() => {
      const mm = window.__MM__!;
      mm.loadHole('skeleton-01');
      mm.shoot(-Math.PI / 2, 0.3);
      mm.fastForward('untilRest');
      return mm.getState().strokes;
    });
    expect(strokes).toBe(1);

    await page.getByTestId('hud-menu').click();
    await page.getByTestId('pause-restart').click();
    await expect(page.getByTestId('screen-pause')).toHaveCount(0);
    await expect(page.getByTestId('strokes')).toHaveText('0');
    const state = await page.evaluate(() => window.__MM__!.getState());
    expect(state.ball.pos).toEqual({ x: 240, y: 490 });
    expect(state.phase).toBe('aiming');
  });

  test('Settings returns to Paused, and Quit goes to the title', async ({ page }) => {
    await ready(page);
    await page.getByTestId('hud-menu').click();
    await page.getByTestId('pause-settings').click();
    await expect(page.getByTestId('screen-settings')).toBeVisible();
    await page.getByTestId('settings-back').click();
    await expect(page.getByTestId('screen-pause')).toBeVisible();

    await page.getByTestId('pause-quit').click();
    await expect(page.getByTestId('screen-menu')).toBeVisible();
    await expect(page.getByTestId('screen-pause')).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('#/menu');
  });

  test('Back closes the overlay and stays in the game', async ({ page, baseURL }) => {
    await ready(page);
    await page.getByTestId('hud-menu').click();
    await expect(page.getByTestId('screen-pause')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('screen-pause')).toHaveCount(0);
    await expect(page.locator('#game')).toBeVisible();
    expect(baseURL).toBeTruthy();
    expect(page.url().startsWith(baseURL ?? '')).toBe(true);
    await expect(page.getByTestId('screen-menu')).toHaveCount(0);
  });

  test('at 140% text the ☰ and Restart hole buttons stay on screen', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('mm.settings.v1', JSON.stringify({ version: 1, textSize: 140 }));
    });
    await ready(page);
    await expect(page.getByTestId('hud-menu')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Restart hole' })).toBeInViewport({ ratio: 1 });
  });
});
