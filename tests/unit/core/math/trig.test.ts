import { describe, expect, it } from 'vitest';
import { cos, direction, sin } from '../../../../src/core/math/trig.ts';

// Tests may use native Math as the reference; core may not (ADR 0001).
const SAMPLES = Array.from({ length: 2001 }, (_, i) => -50 + i * 0.05);

describe('deterministic trig', () => {
  it('matches native sin/cos to ~1e-15 across a wide range', () => {
    for (const x of SAMPLES) {
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(2e-15);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(2e-15);
    }
  });

  it('is exact at zero and keeps the right signs in every quadrant', () => {
    expect(sin(0)).toBe(0);
    expect(cos(0)).toBe(1);
    expect(sin(Math.PI / 2)).toBe(1);
    expect(cos(Math.PI)).toBe(-1);
    for (const x of [0.3, 2, 3.5, 5]) {
      expect(Math.sign(sin(x))).toBe(Math.sign(Math.sin(x)));
      expect(Math.sign(cos(x))).toBe(Math.sign(Math.cos(x)));
    }
  });

  it('is odd/even symmetric', () => {
    for (const x of [0.1, 1.3, 2.9, 7.7]) {
      expect(sin(-x)).toBe(-sin(x));
      expect(cos(-x)).toBe(cos(x));
    }
  });

  it('builds unit direction vectors (angle 0 = +x, π/2 = +y, down the screen)', () => {
    expect(direction(0)).toEqual({ x: 1, y: 0 });
    const down = direction(Math.PI / 2);
    expect(down.x).toBeCloseTo(0, 15);
    expect(down.y).toBe(1);
    const d = direction(2.2);
    expect(d.x * d.x + d.y * d.y).toBeCloseTo(1, 15);
  });
});
