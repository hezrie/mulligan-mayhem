import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

const anyScreen = '[data-testid^="screen-"]';

test.describe('front door: title screen at #/menu', () => {
  test('#/menu shows the title and a big Play button in the thumb zone', async ({
    page,
  }, testInfo) => {
    await page.goto('./#/menu');
    const menu = page.getByTestId('screen-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('heading', { name: 'Mulligan Mayhem' })).toBeVisible();
    const play = menu.getByTestId('menu-play');
    await expect(play).toBeVisible();
    await expect(play).toHaveText('Play');
    await expect(play).toHaveJSProperty('tagName', 'BUTTON');

    const box = await play.boundingBox();
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.y + box.height / 2).toBeGreaterThanOrEqual(0.6 * innerHeight);
    await screenshot(page, testInfo, 'menu');
  });

  test('Play goes to #/play, unmounts the menu and leaves the hole ready to aim', async ({
    page,
  }) => {
    await page.goto('./#/menu');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    await page.getByTestId('menu-play').click();

    await expect(page.getByTestId('screen-menu')).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('#/play');
    await expect(page.getByTestId('hole-name')).toBeVisible();
    expect(await page.evaluate(() => window.__MM__!.getState().phase)).toBe('aiming');
  });

  test('the root URL boots straight into play without a screen or a hash', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    await expect(page.locator(anyScreen)).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  for (const hash of ['#/nope', '#g=abc']) {
    test(`unknown or reserved hash ${hash} mounts no screen`, async ({ page }) => {
      await page.goto(`./${hash}`);
      await page.waitForFunction(() => window.__MM__?.ready === true);
      await expect(page.locator(anyScreen)).toHaveCount(0);
    });
  }

  test('changing the hash opens the menu without a reload, and Back closes it', async ({
    page,
  }) => {
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    await page.evaluate(() => {
      document.body.dataset['probe'] = '1';
      location.hash = '#/menu';
    });
    await expect(page.getByTestId('screen-menu')).toBeVisible({ timeout: 1000 });
    expect(await page.evaluate(() => document.body.dataset['probe'])).toBe('1');

    await page.goBack();
    await expect(page.getByTestId('screen-menu')).toHaveCount(0);
  });
});
