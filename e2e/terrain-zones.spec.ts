import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TERRAIN_COLORS } from '../src/render/palette.ts';
import { expect, test } from './fixtures.ts';
import { screenshot } from './helpers.ts';

type Rgb = readonly [number, number, number];

// 5×5 backing-store pixels, averaged so thin texture strokes can't flip the nearest colour.
const BLOCK = 5;
// Euclidean RGB distance allowed from the palette colour, leaving room for terrain textures.
const TOLERANCE = 48;

// World points at least 40 units from walls, the tee and the cup of the bunkers fixture.
const SAMPLES = [
  { at: { x: 50, y: 200 }, kind: 'rough' },
  { at: { x: 305, y: 100 }, kind: 'sand' },
  { at: { x: 120, y: 290 }, kind: 'sand' },
  { at: { x: 330, y: 300 }, kind: 'fairway' },
] as const;

const hexToRgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const distance = (a: Rgb, b: Rgb): number =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

const nearestKind = (rgb: Rgb): string => {
  const ranked = Object.entries(TERRAIN_COLORS)
    .map(([kind, hex]) => ({ kind, d: distance(rgb, hexToRgb(hex)) }))
    .sort((a, b) => a.d - b.d);
  return ranked[0]?.kind ?? '';
};

test('the bunkers fixture loads from data and draws each terrain zone in its colour', async ({
  page,
}, testInfo) => {
  const data: unknown = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/holes/bunkers.json'), 'utf8'),
  );
  await page.goto('./');
  await page.waitForFunction(() => window.__MM__?.ready === true);
  await page.evaluate((d) => {
    window.__MM__!.loadHoleData(d);
  }, data);

  await expect(page.getByTestId('hole-name')).toHaveText('Fixture: Bunkers');
  await expect(page.getByTestId('par')).toHaveText('3');

  // Two frames: one to draw the new hole (and refit the view), one to be sure it's on screen.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

  const means = await page.evaluate(
    ([points, block]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
      const ctx = canvas.getContext('2d')!;
      const rect = canvas.getBoundingClientRect();
      return points.map((p) => {
        const c = window.__MM__!.worldToClient(p);
        const x = Math.round(((c.x - rect.left) * canvas.width) / rect.width);
        const y = Math.round(((c.y - rect.top) * canvas.height) / rect.height);
        const half = Math.floor(block / 2);
        const px = ctx.getImageData(x - half, y - half, block, block).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < px.length; i += 4) {
          sum[0]! += px[i]!;
          sum[1]! += px[i + 1]!;
          sum[2]! += px[i + 2]!;
        }
        const n = block * block;
        return [sum[0]! / n, sum[1]! / n, sum[2]! / n] as const;
      });
    },
    [SAMPLES.map((s) => s.at), BLOCK] as const,
  );

  await screenshot(page, testInfo, 'terrain-zones');

  SAMPLES.forEach((sample, i) => {
    const rgb = means[i]!;
    const where = `${sample.kind} at (${String(sample.at.x)}, ${String(sample.at.y)})`;
    expect(nearestKind(rgb), where).toBe(sample.kind);
    expect(distance(rgb, hexToRgb(TERRAIN_COLORS[sample.kind])), where).toBeLessThanOrEqual(
      TOLERANCE,
    );
  });
});
