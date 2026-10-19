import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GamePhase } from '../../../src/core/game/state.ts';
import { Rng } from '../../../src/core/rng.ts';
import {
  addTrauma,
  ballScale,
  decayTrauma,
  shakeAmplitude,
  shakeOffset,
  traumaFromImpulse,
} from '../../../src/render/impact.ts';

describe('trauma', () => {
  it('traumaFromImpulse scales impulse by 1/1000 and caps at 1', () => {
    expect(traumaFromImpulse(748.5)).toBeCloseTo(0.7485, 12);
    expect(traumaFromImpulse(1440)).toBe(1);
    expect(traumaFromImpulse(0)).toBe(0);
  });

  it('addTrauma keeps the larger of current and the new impulse', () => {
    expect(addTrauma(0.9, 500)).toBe(0.9);
    expect(addTrauma(0.2, 500)).toBeCloseTo(0.5, 12);
  });

  it('decayTrauma drops 1.6 per second and floors at 0', () => {
    expect(Math.abs(decayTrauma(1, 0.5) - 0.2)).toBeLessThanOrEqual(1e-12);
    expect(decayTrauma(1, 1)).toBe(0);
  });

  it('shakeAmplitude is 8·t² CSS px', () => {
    expect(shakeAmplitude(0.5)).toBe(2);
    expect(shakeAmplitude(1)).toBe(8);
    expect(shakeAmplitude(0)).toBe(0);
  });
});

describe('shakeOffset', () => {
  it('is zero while aiming and does not draw from the rng', () => {
    const rng = new Rng(0x5eed);
    const before = rng.state;
    expect(shakeOffset('aiming', 1, rng)).toEqual({ x: 0, y: 0 });
    expect(rng.state).toBe(before);
  });

  it('stays within the amplitude over 1000 rolling calls at trauma 0.5', () => {
    const rng = new Rng(0x5eed);
    for (let i = 0; i < 1000; i++) {
      const o = shakeOffset('rolling', 0.5, rng);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(2);
    }
  });

  it('uses (2·rng.float() − 1)·amplitude for x then y', () => {
    const rng = new Rng(0x5eed);
    const ref = new Rng(0x5eed);
    const o = shakeOffset('rolling', 1, rng);
    expect(o.x).toBe((2 * ref.float() - 1) * 8);
    expect(o.y).toBe((2 * ref.float() - 1) * 8);
  });

  it('two Rng(0x5eed) instances give identical sequences over 10 calls', () => {
    const a = new Rng(0x5eed);
    const b = new Rng(0x5eed);
    const phases: GamePhase[] = ['rolling', 'hazard', 'holed'];
    for (let i = 0; i < 10; i++) {
      const phase = phases[i % phases.length] ?? 'rolling';
      expect(shakeOffset(phase, 0.7, a)).toEqual(shakeOffset(phase, 0.7, b));
    }
  });
});

describe('ballScale', () => {
  it.each([
    [0, Infinity, 1],
    [400, Infinity, 1.1],
    [800, Infinity, 1.2],
    [1600, Infinity, 1.2],
    [400, 0, 0.75],
    [400, 59.9, 0.75],
    [400, 60, 1.1],
    [1600, 0, 0.75],
  ] as const)('speed %s, %s ms since wall hit gives along %s', (speed, ms, along) => {
    const s = ballScale(speed, ms);
    expect(s.along).toBeCloseTo(along, 12);
    expect(s.across).toBe(1 / s.along);
  });
});

describe('purity', () => {
  it('impact.ts uses no DOM, canvas, timers or clock', () => {
    const src = readFileSync(new URL('../../../src/render/impact.ts', import.meta.url), 'utf8');
    for (const banned of [
      /\bdocument\b/,
      /\bwindow\b/,
      /\bcanvas\b/i,
      /\bDate\b/,
      /\bperformance\b/,
      /\bset(Timeout|Interval)\b/,
      /\brequestAnimationFrame\b/,
      /rngState/,
    ]) {
      expect(src).not.toMatch(banned);
    }
    expect(src).toMatch(/from '\.\.\/core\/rng\.ts'/);
  });
});
