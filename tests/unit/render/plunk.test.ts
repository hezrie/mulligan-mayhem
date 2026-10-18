import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScoreName } from '../../../src/core/scoring/score.ts';
import {
  flagGeometry,
  plunkFrame,
  plunkSlideStart,
  stampAnchor,
  stampText,
} from '../../../src/render/plunk.ts';

const CUP = { x: 220, y: 110 };

describe('plunkFrame ball drop', () => {
  it.each([
    [0, 1, true],
    [110, 0.925, true],
    [220, 0.4, false],
  ] as const)('e = %s gives ballScale %s, visible %s', (e, scale, visible) => {
    const f = plunkFrame(e);
    expect(f.ballScale).toBeCloseTo(scale, 9);
    expect(f.ballVisible).toBe(visible);
  });

  it('ballT follows easeInCubic', () => {
    expect(plunkFrame(110).ballT).toBeCloseTo(0.125, 9);
  });
});

describe('plunkFrame ripple', () => {
  it.each([
    [0, 10, 1, false],
    [225, 27.5, 0.5, false],
    [450, 30, 0, true],
    [1000, 30, 0, true],
  ] as const)('e = %s gives ripple (%s, %s), done %s', (e, radius, alpha, done) => {
    const f = plunkFrame(e);
    expect(f.rippleRadius).toBeCloseTo(radius, 9);
    expect(f.rippleAlpha).toBeCloseTo(alpha, 9);
    expect(f.done).toBe(done);
  });

  it('is not done at e = 449', () => {
    expect(plunkFrame(449).done).toBe(false);
  });
});

describe('plunkFrame flag and stamp', () => {
  it.each([
    [0, 0, 1.8],
    [150, 6, 0.929842],
    [300, 0, 1.0],
    [1000, 0, 1.0],
  ] as const)('e = %s gives flagLift %s, stampScale %s', (e, lift, scale) => {
    const f = plunkFrame(e);
    expect(f.flagLift).toBeCloseTo(lift, 9);
    expect(Math.abs(f.stampScale - scale)).toBeLessThanOrEqual(1e-6);
  });
});

describe('stampText', () => {
  it.each([
    ['hole-in-one', 'HOLE IN ONE!'],
    ['eagle', 'EAGLE!'],
    ['birdie', 'BIRDIE!'],
    ['par', 'PAR'],
    ['bogey', 'BOGEY'],
    ['double-bogey', 'DOUBLE BOGEY+'],
  ] as const satisfies readonly (readonly [ScoreName, string])[])('%s → %s', (name, text) => {
    expect(stampText(name)).toBe(text);
  });
});

describe('stampAnchor', () => {
  const size = { width: 320, height: 560 };
  it.each([
    [CUP, { x: 220, y: 60 }],
    [
      { x: 20, y: 30 },
      { x: 80, y: 24 },
    ],
    [
      { x: 300, y: 300 },
      { x: 240, y: 250 },
    ],
  ])('cup %o anchors the stamp at %o', (cup, expected) => {
    expect(stampAnchor(cup, size)).toEqual(expected);
  });
});

describe('flagGeometry', () => {
  it('draws the pole and pennant above the cup', () => {
    expect(flagGeometry(CUP, 0)).toEqual({
      poleBottom: { x: 220, y: 110 },
      poleTop: { x: 220, y: 80 },
      pennant: [
        { x: 220, y: 80 },
        { x: 234, y: 85 },
        { x: 220, y: 90 },
      ],
    });
  });

  it('lift subtracts from every y', () => {
    expect(flagGeometry(CUP, 6)).toEqual({
      poleBottom: { x: 220, y: 104 },
      poleTop: { x: 220, y: 74 },
      pennant: [
        { x: 220, y: 74 },
        { x: 234, y: 79 },
        { x: 220, y: 84 },
      ],
    });
  });
});

describe('plunkSlideStart', () => {
  it.each([
    [
      { x: 215, y: 120 },
      { x: 215, y: 120 },
    ],
    [{ x: 240, y: 490 }, CUP],
  ])('prev %o slides from %o', (prev, expected) => {
    expect(plunkSlideStart(prev, CUP)).toEqual(expected);
  });
});

describe('purity', () => {
  it('uses no canvas, DOM, timers or Date', () => {
    const src = readFileSync(new URL('../../../src/render/plunk.ts', import.meta.url), 'utf8');
    for (const banned of [
      /\bdocument\b/,
      /\bwindow\b/,
      /\bcanvas\b/i,
      /\bDate\b/,
      /\bperformance\b/,
      /\bset(Timeout|Interval)\b/,
      /\brequestAnimationFrame\b/,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });
});
