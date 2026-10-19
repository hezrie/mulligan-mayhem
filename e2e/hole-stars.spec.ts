import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

interface Replay {
  holeId: string;
  seed: number;
  shots: { angle: number; power: number }[];
}

const loadReplay = (name: string): Replay =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/replays', name), 'utf8')) as Replay;

async function openHole(page: Page, holeId = 'skeleton-01', seed = 1): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
  await page.evaluate(
    ([id, s]) => {
      window.__MM__!.loadHole(id, s);
    },
    [holeId, seed] as const,
  );
}

async function playShots(page: Page, shots: Replay['shots']): Promise<void> {
  for (const { angle, power } of shots) {
    await page.evaluate(
      ([a, p]) => {
        window.__MM__!.shoot(a, p);
        window.__MM__!.fastForward('untilRest');
      },
      [angle, power] as const,
    );
  }
}

async function playReplay(page: Page, name: string): Promise<void> {
  const replay = loadReplay(name);
  await openHole(page, replay.holeId, replay.seed);
  await playShots(page, replay.shots);
}

/** Checks the stars element once the dialog is up: label, text and the on/off span structure. */
async function expectStars(page: Page, on: number): Promise<void> {
  await expect(page.getByRole('dialog')).toBeVisible();
  const stars = page.getByRole('dialog').getByTestId('hole-stars');
  await expect(stars).toHaveAttribute('role', 'img');
  await expect(stars).toHaveAttribute('aria-label', `${String(on)} of 3 stars`);
  await expect(stars).toHaveText('★'.repeat(on) + '☆'.repeat(3 - on));
  const spans = await stars.evaluate((el) =>
    Array.from(el.children, (c) => ({ tag: c.tagName, cls: c.className, text: c.textContent })),
  );
  expect(spans).toEqual([
    ...Array.from({ length: on }, () => ({ tag: 'SPAN', cls: 'star-on', text: '★' })),
    ...Array.from({ length: 3 - on }, () => ({ tag: 'SPAN', cls: 'star-off', text: '☆' })),
  ]);
}

test.describe('hole-complete stars', () => {
  test('a par round shows three stars under the unchanged message', async ({ page }, testInfo) => {
    await playReplay(page, 'skeleton-01-par.json');
    await expectStars(page, 3);
    await expect(page.getByTestId('complete-message')).toHaveText(
      'Hole complete — 3 strokes (Par)',
    );
    await screenshot(page, testInfo, 'hole-complete-stars');
  });

  test('a bogey shows two stars', async ({ page }) => {
    await playReplay(page, 'skeleton-01-wall-bank-bogey.json');
    await expectStars(page, 2);
  });

  test('a hole in one shows three stars', async ({ page }) => {
    await playReplay(page, 'skeleton-01-hole-in-one.json');
    await expectStars(page, 3);
  });

  test('stars never go stale after loading the hole again', async ({ page }) => {
    await playReplay(page, 'skeleton-01-wall-bank-bogey.json');
    await expectStars(page, 2);

    const par = loadReplay('skeleton-01-par.json');
    await page.evaluate(() => {
      window.__MM__!.loadHole('skeleton-01', 1);
    });
    await expect(page.getByRole('dialog')).toBeHidden();
    await playShots(page, par.shots);
    await expectStars(page, 3);
  });

  test('lit stars use the accent colour and unlit stars a faint white', async ({ page }) => {
    await playReplay(page, 'skeleton-01-wall-bank-bogey.json');
    await expect(page.getByRole('dialog')).toBeVisible();
    const colour = (selector: string): Promise<string> =>
      page
        .locator(`[data-testid="hole-stars"] ${selector}`)
        .first()
        .evaluate((el) => getComputedStyle(el).color);
    expect(await colour('.star-on')).toBe('rgb(255, 224, 102)');
    expect(await colour('.star-off')).toBe('rgba(255, 255, 255, 0.35)');
  });
});
