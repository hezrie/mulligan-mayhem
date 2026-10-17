import { describe, expect, it } from 'vitest';
import { vec2 } from '../../../src/core/math/vec2.ts';
import { fitView, screenToWorld, worldToScreen } from '../../../src/render/view.ts';

describe('fitView', () => {
  it('scales a tall hole to the viewport height when height is the limit, centred', () => {
    // 320×560 hole, 600×800 viewport, 20px padding: 760/560 < 560/320, so height limits.
    const view = fitView(600, 800, { width: 320, height: 560 }, 20);
    expect(view.scale).toBeCloseTo(760 / 560, 12);
    expect(view.offsetY).toBeCloseTo(20, 12);
    expect(view.offsetX).toBeCloseTo((600 - 320 * view.scale) / 2, 12);
  });

  it('scales to the viewport width when width is the limit (narrow phones)', () => {
    // 400×800 viewport: 360/320 < 760/560, so width limits.
    const view = fitView(400, 800, { width: 320, height: 560 }, 20);
    expect(view.scale).toBeCloseTo(360 / 320, 12);
    expect(view.offsetX).toBeCloseTo(20, 12);
    expect(view.offsetY).toBeCloseTo((800 - 560 * view.scale) / 2, 12);
  });

  it('never produces a negative or zero scale for tiny viewports', () => {
    expect(fitView(10, 10, { width: 320, height: 560 }, 20).scale).toBeGreaterThan(0);
  });
});

describe('world/screen transforms', () => {
  it('are inverses of each other', () => {
    const view = fitView(390, 844, { width: 320, height: 560 }, 16);
    const p = vec2(123.5, 456.25);
    const back = screenToWorld(view, worldToScreen(view, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});
