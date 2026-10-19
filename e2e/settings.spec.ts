import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

const anyScreen = '[data-testid^="screen-"]';

async function openSettings(page: Page): Promise<void> {
  await page.goto('./#/settings');
  await expect(page.getByTestId('screen-settings')).toBeVisible();
}

const rootFontSize = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.documentElement).fontSize);

const holeNameFontSize = (page: Page): Promise<string> =>
  page.getByTestId('hole-name').evaluate((el) => getComputedStyle(el).fontSize);

async function expectSelect(
  page: Page,
  label: string,
  testId: string,
  value: string,
  options: readonly (readonly [string, string])[],
): Promise<void> {
  // Scoped to the screen: the canvas's aria-label also mentions "aim".
  const select = page.getByTestId('screen-settings').getByLabel(label);
  await expect(select).toHaveAttribute('data-testid', testId);
  await expect(select).toHaveJSProperty('tagName', 'SELECT');
  await expect(select).toHaveValue(value);
  const actual = await select
    .locator('option')
    .evaluateAll((els) =>
      els.map((el) => [(el as HTMLOptionElement).value, el.textContent] as const),
    );
  expect(actual).toEqual(options);
}

test.describe('settings screen at #/settings', () => {
  test('empty storage shows every control at its default', async ({ page }, testInfo) => {
    await openSettings(page);
    const screen = page.getByTestId('screen-settings');
    await expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();

    const volume = screen.getByLabel('Volume');
    await expect(volume).toHaveAttribute('data-testid', 'settings-volume');
    await expect(volume).toHaveAttribute('type', 'range');
    await expect(volume).toHaveAttribute('min', '0');
    await expect(volume).toHaveAttribute('max', '100');
    await expect(volume).toHaveAttribute('step', '1');
    await expect(volume).toHaveValue('70');

    const music = screen.getByLabel('Music');
    await expect(music).toHaveAttribute('data-testid', 'settings-music');
    await expect(music).toHaveAttribute('type', 'checkbox');
    await expect(music).not.toBeChecked();

    const haptics = screen.getByLabel('Haptics');
    await expect(haptics).toHaveAttribute('data-testid', 'settings-haptics');
    await expect(haptics).toHaveAttribute('type', 'checkbox');
    await expect(haptics).toBeChecked();

    await expectSelect(page, 'Motion', 'settings-motion', 'system', [
      ['system', 'System'],
      ['full', 'Full'],
      ['reduced', 'Reduced'],
    ]);
    await expectSelect(page, 'Aim', 'settings-aim-mode', 'grab', [
      ['grab', 'Grab the ball'],
      ['anywhere', 'Drag anywhere'],
    ]);
    await expectSelect(page, 'Text size', 'settings-text-size', '100', [
      ['100', '100%'],
      ['120', '120%'],
      ['140', '140%'],
    ]);
    await screenshot(page, testInfo, 'settings');
  });

  test('a volume change survives a reload', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('settings-volume').fill('30');
    await page.reload();
    await expect(page.getByTestId('settings-volume')).toHaveValue('30');
    const stored = await page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('mm.settings.v1') ?? 'null') as { volume: number }).volume,
    );
    expect(stored).toBe(30);
  });

  test('text size 140% scales the root and the HUD, and is applied at boot', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('settings-text-size').selectOption('140');
    expect(await rootFontSize(page)).toBe('22.4px');
    expect(await holeNameFontSize(page)).toBe('22.4px');

    await page.goto('./');
    await page.reload();
    await page.waitForFunction(() => window.__MM__?.ready === true);
    expect(await rootFontSize(page)).toBe('22.4px');
    expect(await holeNameFontSize(page)).toBe('22.4px');
  });

  test('at 140% the HUD stays fully on screen and the canvas fits', async ({ page }) => {
    await openSettings(page);
    await page.getByTestId('settings-text-size').selectOption('140');
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);

    for (const id of ['hole-name', 'par', 'strokes']) {
      await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByRole('button', { name: 'Restart hole' })).toBeInViewport({ ratio: 1 });
    const fits = await page.evaluate(() => {
      const canvas = document.querySelector('#game');
      return canvas ? canvas.getBoundingClientRect().bottom <= window.innerHeight + 0.5 : false;
    });
    expect(fits).toBe(true);
  });

  test("aim mode 'anywhere' applies live, without a reload", async ({ page }) => {
    await openSettings(page);
    await page.waitForFunction(() => window.__MM__?.ready === true);
    await page.getByTestId('settings-aim-mode').selectOption('anywhere');
    await page.getByTestId('settings-back').click();
    await expect(page.locator(anyScreen)).toHaveCount(0);

    const aimMode = await page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('mm.settings.v1') ?? 'null') as { aimMode: string })
          .aimMode,
    );
    expect(aimMode).toBe('anywhere');

    const ball = await page.evaluate(() => {
      window.__MM__!.loadHole('skeleton-01');
      return window.__MM__!.getBallClientPosition();
    });
    await page.mouse.move(ball.x - 150, ball.y);
    await page.mouse.down();
    await page.mouse.move(ball.x - 150, ball.y + 90, { steps: 6 });
    await page.mouse.up();
    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(1);
  });

  test('the menu opens settings, and Back returns to the menu', async ({ page }) => {
    await page.goto('./#/menu');
    const entry = page.getByTestId('menu-settings');
    await expect(entry).toHaveText('Settings');
    await entry.click();
    await expect(page.getByTestId('screen-settings')).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toBe('#/settings');

    const back = page.getByTestId('settings-back');
    await expect(back).toHaveText('Back');
    await back.click();
    await expect(page.getByTestId('screen-menu')).toBeVisible();
    await expect(page.getByTestId('screen-settings')).toHaveCount(0);
  });

  test('Back from a deep link to #/settings lands in play inside the game', async ({
    page,
    baseURL,
  }) => {
    await openSettings(page);
    await page.getByTestId('settings-back').click();
    await expect(page.locator(anyScreen)).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('#/play');
    expect(page.url().startsWith(baseURL ?? '')).toBe(true);
    expect(baseURL).toBeTruthy();
  });

  test('blocked storage still shows defaults and keeps changes for the session only', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error('blocked');
      };
      Storage.prototype.setItem = () => {
        throw new Error('blocked');
      };
    });
    await openSettings(page);
    const volume = page.getByTestId('settings-volume');
    await expect(volume).toHaveValue('70');
    await expect(page.getByTestId('settings-haptics')).toBeChecked();
    await volume.fill('30');
    await expect(volume).toHaveValue('30');

    await page.reload();
    await expect(page.getByTestId('settings-volume')).toHaveValue('70');
  });
});
