import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { loadReplay, openHole, playShots } from './juice-helpers.ts';

declare global {
  interface Window {
    __vibrations?: unknown[];
  }
}

// Replaces the real vibrator with a recorder, so desktop and mobile runs see the same calls.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__vibrations = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value(this: Navigator, pattern: VibratePattern): boolean {
        if (this !== navigator) throw new TypeError('Illegal invocation');
        window.__vibrations?.push(pattern);
        return true;
      },
    });
  });
});

const vibrations = (page: Page): Promise<unknown[]> =>
  page.evaluate(() => window.__vibrations ?? []);

test.describe('haptics: putts, hard bounces and the cup drop are felt', () => {
  const replays: [string, unknown[]][] = [
    ['skeleton-01-hole-in-one.json', [24, 25, [30, 60, 30, 60, 120]]],
    ['skeleton-01-par.json', [18, 15, 13, [15, 40, 30]]],
    ['skeleton-01-wall-bank-bogey.json', [20, 25, 18, 12, 16, 13, [15, 40, 30]]],
  ];

  test('after the first press, each replay pulses its exact patterns', async ({ page }) => {
    await openHole(page, 'skeleton-01');
    await page.locator('canvas#game').click({ position: { x: 5, y: 5 } });
    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(0);

    for (const [file, expected] of replays) {
      const replay = loadReplay(file);
      await page.evaluate(
        ([id, seed]) => {
          window.__vibrations = [];
          window.__MM__!.loadHole(id, seed);
        },
        [replay.holeId, replay.seed] as const,
      );
      await playShots(page, replay.shots);

      expect(await vibrations(page), file).toEqual(expected);
      expect(await page.evaluate(() => window.__MM__!.getStateHash()), file).toBe(
        replay.expected.finalStateHash,
      );
    }
  });

  test('without any pointer input a full par replay pulses nothing', async ({ page }) => {
    const replay = loadReplay('skeleton-01-par.json');
    await openHole(page, replay.holeId, replay.seed);
    await playShots(page, replay.shots);

    expect((await page.evaluate(() => window.__MM__!.getState())).phase).toBe('holed');
    expect(await vibrations(page)).toEqual([]);
  });
});
