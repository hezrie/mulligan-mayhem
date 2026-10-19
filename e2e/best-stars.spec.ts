import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

interface Replay {
  holeId: string;
  seed: number;
  shots: { angle: number; power: number }[];
}

const loadReplay = (name: string): Replay =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/replays', name), 'utf8')) as Replay;

const PAR = 'skeleton-01-par.json';
const BOGEY = 'skeleton-01-wall-bank-bogey.json';

async function openPage(page: Page): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
}

/** Loads the replay's hole, plays it, and waits for the dialog so a frame has seen 'holed'. */
async function playReplay(page: Page, name: string): Promise<void> {
  const { holeId, seed, shots } = loadReplay(name);
  await page.evaluate(
    ([id, s]) => {
      window.__MM__!.loadHole(id, s);
    },
    [holeId, seed] as const,
  );
  await expect(page.getByRole('dialog')).toBeHidden();
  for (const { angle, power } of shots) {
    await page.evaluate(
      ([a, p]) => {
        window.__MM__!.shoot(a, p);
        window.__MM__!.fastForward('untilRest');
      },
      [angle, power] as const,
    );
  }
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function storedStarsAfterReload(page: Page): Promise<unknown> {
  await page.reload();
  await page.waitForFunction(() => window.__MM__?.ready === true);
  return page.evaluate(() => JSON.parse(localStorage.getItem('mm:stars') ?? 'null') as unknown);
}

test.describe('best stars are saved automatically', () => {
  test('a fresh context has no saved stars after the page loads', async ({ page }) => {
    await openPage(page);
    expect(await page.evaluate(() => localStorage.getItem('mm:stars'))).toBeNull();
  });

  test('sinking at par saves 3 stars that survive a reload', async ({ page }) => {
    await openPage(page);
    await playReplay(page, PAR);
    expect(await storedStarsAfterReload(page)).toEqual({ 'skeleton-01': 3 });
  });

  test('a worse finish never lowers the saved stars', async ({ page }) => {
    await openPage(page);
    await playReplay(page, PAR);
    await playReplay(page, BOGEY);
    expect(await storedStarsAfterReload(page)).toEqual({ 'skeleton-01': 3 });
  });

  test('a better finish raises the saved stars', async ({ page }) => {
    await openPage(page);
    await playReplay(page, BOGEY);
    expect(await storedStarsAfterReload(page)).toEqual({ 'skeleton-01': 2 });
    await playReplay(page, PAR);
    expect(await storedStarsAfterReload(page)).toEqual({ 'skeleton-01': 3 });
  });
});
