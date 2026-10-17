import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures.ts';

interface Replay {
  holeId: string;
  seed: number;
  shots: { angle: number; power: number }[];
  expected: { strokes: number; holed: boolean; finalStateHash: string };
}

const loadReplay = (name: string): Replay =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/replays', name), 'utf8')) as Replay;

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = join('test-results', 'screenshots', `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

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

test.describe('walking skeleton: The Dog-Leg (par 3)', () => {
  test('a par round reaches the completion screen with the same hash as the Node replay', async ({
    page,
  }, testInfo) => {
    const replay = loadReplay('skeleton-01-par.json');
    await openHole(page, replay.holeId, replay.seed);
    await screenshot(page, testInfo, 'tee');

    await playShots(page, replay.shots);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('complete-message')).toHaveText(
      'Hole complete — 3 strokes (Par)',
    );
    await expect(page.getByTestId('strokes')).toHaveText('3');
    expect(await page.evaluate(() => window.__MM__!.getStateHash())).toBe(
      replay.expected.finalStateHash,
    );
    await screenshot(page, testInfo, 'hole-complete');
  });

  test('a hole in one is celebrated and matches its golden replay', async ({ page }) => {
    const replay = loadReplay('skeleton-01-hole-in-one.json');
    await openHole(page, replay.holeId, replay.seed);
    await playShots(page, replay.shots);
    await expect(page.getByTestId('complete-message')).toHaveText(
      'Hole complete — 1 stroke (Hole in one!)',
    );
    expect(await page.evaluate(() => window.__MM__!.getStateHash())).toBe(
      replay.expected.finalStateHash,
    );
  });

  test('Play again restarts from the tee with zero strokes', async ({ page }) => {
    const replay = loadReplay('skeleton-01-par.json');
    await openHole(page, replay.holeId, replay.seed);
    await playShots(page, replay.shots);
    await page.getByRole('button', { name: 'Play again' }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('strokes')).toHaveText('0');
    const state = await page.evaluate(() => window.__MM__!.getState());
    expect(state.phase).toBe('aiming');
    expect(state.ball.pos).toEqual({ x: 240, y: 490 });
  });

  test('dragging back from the ball and releasing takes a shot the opposite way', async ({
    page,
  }, testInfo) => {
    await openHole(page);
    const ball = await page.evaluate(() => window.__MM__!.getBallClientPosition());

    await page.mouse.move(ball.x, ball.y);
    await page.mouse.down();
    await page.mouse.move(ball.x, ball.y + 90, { steps: 6 });
    await screenshot(page, testInfo, 'aiming');
    await page.mouse.up();

    const state = await page.evaluate(() => window.__MM__!.getState());
    expect(state.strokes).toBe(1);
    expect(state.phase).toBe('rolling');
    expect(state.ball.vel.y).toBeLessThan(0); // dragged down ⇒ shot goes up the screen
    expect(Math.abs(state.ball.vel.x)).toBeLessThan(Math.abs(state.ball.vel.y) / 10);
    await expect(page.getByTestId('strokes')).toHaveText('1');
  });

  test('the real-time game loop plays a shot out to rest (no manual clock)', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => window.__MM__?.ready === true);
    const ball = await page.evaluate(() => window.__MM__!.getBallClientPosition());
    await page.mouse.move(ball.x, ball.y);
    await page.mouse.down();
    await page.mouse.move(ball.x - 30, ball.y + 60, { steps: 4 });
    await page.mouse.up();

    // The requestAnimationFrame loop, not the test API, must advance the simulation.
    await page.waitForFunction(
      () => {
        const s = window.__MM__!.getState();
        return s.strokes === 1 && s.phase !== 'rolling';
      },
      undefined,
      { timeout: 10_000 },
    );
    const state = await page.evaluate(() => window.__MM__!.getState());
    expect(state.step).toBeGreaterThan(0);
    expect(state.ball.pos).not.toEqual({ x: 240, y: 490 });
  });

  test('releasing on the ball cancels the aim without a stroke', async ({ page }) => {
    await openHole(page);
    const ball = await page.evaluate(() => window.__MM__!.getBallClientPosition());
    await page.mouse.move(ball.x, ball.y);
    await page.mouse.down();
    await page.mouse.up();
    expect((await page.evaluate(() => window.__MM__!.getState())).strokes).toBe(0);
  });
});
