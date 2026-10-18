// Shared helpers for the juice (effects) specs. Patterns copied from e2e/skeleton-hole.spec.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

export interface ReplayShot {
  readonly angle: number;
  readonly power: number;
}

export interface Replay {
  readonly holeId: string;
  readonly seed: number;
  readonly shots: readonly ReplayShot[];
  readonly expected: { strokes: number; holed: boolean; finalStateHash: string };
}

export const loadReplay = (name: string): Replay =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/replays', name), 'utf8')) as Replay;

export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = join('test-results', 'screenshots', `${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** Opens the game, waits for the test API and loads a hole (which switches to the manual clock). */
export async function openHole(page: Page, holeId = 'skeleton-01', seed = 1): Promise<void> {
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
  await page.evaluate(
    ([id, s]) => {
      window.__MM__!.loadHole(id, s);
    },
    [holeId, seed] as const,
  );
}

/** Plays each shot out to rest, one evaluate per shot. */
export async function playShots(page: Page, shots: readonly ReplayShot[]): Promise<void> {
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

/** Resolves after n animation frames have run in the page. */
export async function waitFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let k = count;
        const f = (): void => {
          if (--k <= 0) resolve();
          else requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }),
    n,
  );
}

/** Reads one field of the renderer's effects snapshot, cast to the caller's type. */
export async function getFx<T>(page: Page, key: string): Promise<T> {
  return (await page.evaluate((k) => window.__MM__!.getFx()[k], key)) as T;
}
