import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clamp01,
  easeInCubic,
  easeOutBack,
  easeOutCubic,
  lerp,
} from '../../../src/render/easing.ts';

describe('clamp01', () => {
  it.each([
    [-0.5, 0],
    [0.25, 0.25],
    [1.5, 1],
  ])('clamp01(%s) = %s', (t, expected) => {
    expect(clamp01(t)).toBe(expected);
  });
});

describe('lerp', () => {
  it('interpolates between a and b', () => {
    expect(lerp(10, 30, 0.5)).toBe(20);
    expect(lerp(10, 30, 0)).toBe(10);
  });
});

const EASINGS = [
  ['easeInCubic', easeInCubic],
  ['easeOutCubic', easeOutCubic],
  ['easeOutBack', easeOutBack],
] as const;

describe('easing endpoints', () => {
  const cases = EASINGS.flatMap(
    ([name, fn]) =>
      [
        [name, fn, -0.5, 0],
        [name, fn, 0, 0],
        [name, fn, 1, 1],
        [name, fn, 1.5, 1],
      ] as const,
  );

  it.each(cases)('%s clamps t and returns exactly the endpoint', (_name, fn, t, expected) => {
    expect(fn(t)).toBe(expected);
  });
});

describe('easing midpoints', () => {
  it.each([
    ['easeInCubic', easeInCubic, 0.125],
    ['easeOutCubic', easeOutCubic, 0.875],
    ['easeOutBack', easeOutBack, 1.0876975],
  ] as const)('%s(0.5) = %s', (_name, fn, expected) => {
    expect(Math.abs(fn(0.5) - expected)).toBeLessThanOrEqual(1e-9);
  });
});

describe('purity', () => {
  it('uses no canvas, DOM, timers or Date', () => {
    const src = readFileSync(new URL('../../../src/render/easing.ts', import.meta.url), 'utf8');
    for (const banned of [
      /\bimport\b/,
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
