import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { loadReplay, openHole, playShots } from './juice-helpers.ts';

/** The sfx cues as `name@step`, so later stinger and crowd cues don't break these assertions. */
async function sfxCues(page: Page): Promise<string[]> {
  const log = await page.evaluate(() => window.__MM__!.getCueLog());
  return log.filter((e) => e.channel === 'sfx').map((e) => `${e.cue}@${String(e.step)}`);
}

/** Presses on the ball and drags it `dx`, `dy` CSS px in 6 steps, then releases. */
async function dragFromBall(page: Page, dx: number, dy: number): Promise<void> {
  const ball = await page.evaluate(() => window.__MM__!.getBallClientPosition());
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  await page.mouse.move(ball.x + dx, ball.y + dy, { steps: 6 });
  await page.mouse.up();
}

async function setHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const engineState = (page: Page): Promise<unknown> =>
  page.evaluate(() => window.__MM__!.getAudioState()['engine']);

test.describe('sound cues: putts, bounces and the cup drop are heard', () => {
  const replays: [string, string[]][] = [
    ['skeleton-01-hole-in-one.json', ['putt@0', 'bounce@55', 'cup@151']],
    ['skeleton-01-par.json', ['putt@0', 'putt@157', 'putt@268', 'cup@294']],
    [
      'skeleton-01-wall-bank-bogey.json',
      ['putt@0', 'bounce@46', 'putt@158', 'bounce@233', 'putt@310', 'putt@440', 'cup@475'],
    ],
  ];

  for (const [file, expected] of replays) {
    test(`${file} logs exactly ${expected.join(', ')}`, async ({ page }) => {
      const replay = loadReplay(file);
      await openHole(page, replay.holeId, replay.seed);
      await playShots(page, replay.shots);

      expect(await sfxCues(page)).toEqual(expected);
      expect(await page.evaluate(() => window.__MM__!.getStateHash())).toBe(
        replay.expected.finalStateHash,
      );
    });
  }

  test('a real pointer shot logs a putt at step 0', async ({ page }) => {
    await openHole(page, 'skeleton-01', 1);
    await dragFromBall(page, 0, 90);

    expect(await sfxCues(page)).toEqual(['putt@0']);
  });

  test('the real-time loop hears the bounce off the right boundary', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    await dragFromBall(page, -90, 0);

    await page.waitForFunction(
      () => {
        const s = window.__MM__!.getState();
        return s.strokes === 1 && s.phase !== 'rolling';
      },
      undefined,
      { timeout: 10_000 },
    );
    const sfx = (await page.evaluate(() => window.__MM__!.getCueLog())).filter(
      (e) => e.channel === 'sfx',
    );
    expect(sfx.map((e) => e.cue)).toEqual(['putt', 'bounce']);
    expect(sfx[1]!.step).toBeGreaterThan(sfx[0]!.step);
  });

  test('the engine wakes on the first touch and sleeps while the tab is hidden', async ({
    page,
  }) => {
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    expect(await engineState(page)).toBe('locked');

    await page.locator('canvas#game').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => engineState(page)).toBe('running');
    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(0);

    await setHidden(page, true);
    await expect.poll(() => engineState(page)).toBe('suspended');
    await setHidden(page, false);
    await expect.poll(() => engineState(page)).toBe('running');
  });
});
