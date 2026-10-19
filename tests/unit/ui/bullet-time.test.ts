import { describe, expect, it } from 'vitest';
import type { GamePhase } from '../../../src/core/game/state.ts';
import { advanceClock } from '../../../src/core/physics/timestep.ts';
import {
  BULLET_MAX_SECONDS,
  BULLET_MAX_SPEED,
  BULLET_RADIUS,
  BULLET_RATE,
  bulletTime,
  createPacer,
  paceSteps,
  type BulletTimeState,
} from '../../../src/ui/bullet-time.ts';

const CUP = { x: 100, y: 100 };

/** A ball `dist` units right of the cup, moving straight down at `speed`. */
function near(dist: number, speed: number, phase: GamePhase = 'rolling', strokes = 1) {
  return { phase, strokes, ball: { pos: { x: CUP.x + dist, y: CUP.y }, vel: { x: 0, y: speed } } };
}

const fresh: BulletTimeState = { strokes: 1, slowSeconds: 0 };

describe('bullet-time constants', () => {
  it('slows to 0.3x within 30 units at up to 420 units/s for at most 0.8 s', () => {
    expect(BULLET_RADIUS).toBe(30);
    expect(BULLET_MAX_SPEED).toBe(420);
    expect(BULLET_RATE).toBe(0.3);
    expect(BULLET_MAX_SECONDS).toBe(0.8);
  });
});

describe('bulletTime', () => {
  it('slows a slow rolling ball near the cup and counts the slowed time', () => {
    const { rate, next } = bulletTime(fresh, near(10, 100), CUP, 0.02, true);
    expect(rate).toBe(0.3);
    expect(next).toEqual({ strokes: 1, slowSeconds: 0.02 });
  });

  it('includes the boundary: distance 30 at speed 420 is slowed', () => {
    expect(bulletTime(fresh, near(30, 420), CUP, 0.02, true).rate).toBe(0.3);
  });

  it('runs at full speed just outside the radius', () => {
    const r = bulletTime(fresh, near(30.01, 100), CUP, 0.02, true);
    expect(r.rate).toBe(1);
    expect(r.next.slowSeconds).toBe(0);
  });

  it('runs at full speed just above the speed limit', () => {
    expect(bulletTime(fresh, near(10, 420.01), CUP, 0.02, true).rate).toBe(1);
  });

  it('runs at full speed unless rolling', () => {
    expect(bulletTime(fresh, near(10, 100, 'aiming'), CUP, 0.02, true).rate).toBe(1);
    expect(bulletTime(fresh, near(0, 0, 'holed'), CUP, 0.02, true).rate).toBe(1);
  });

  it('runs at full speed when disabled', () => {
    const r = bulletTime(fresh, near(10, 100), CUP, 0.02, false);
    expect(r.rate).toBe(1);
    expect(r.next.slowSeconds).toBe(0);
  });

  it('stops slowing after 0.8 s until the strokes change, then slows again', () => {
    let prev = fresh;
    for (let i = 0; i < 8; i++) {
      const r = bulletTime(prev, near(10, 100), CUP, 0.1, true);
      expect(r.rate).toBe(0.3);
      prev = r.next;
    }
    expect(prev.slowSeconds).toBeGreaterThanOrEqual(BULLET_MAX_SECONDS - 1e-9);
    prev = { ...prev, slowSeconds: BULLET_MAX_SECONDS };
    const capped = bulletTime(prev, near(10, 100), CUP, 0.1, true);
    expect(capped.rate).toBe(1);
    expect(capped.next.slowSeconds).toBe(BULLET_MAX_SECONDS);

    const again = bulletTime(capped.next, near(10, 100, 'rolling', 2), CUP, 0.1, true);
    expect(again.rate).toBe(0.3);
    expect(again.next).toEqual({ strokes: 2, slowSeconds: 0.1 });
  });

  it('resets the slowed time when the strokes change, even at full speed', () => {
    const r = bulletTime(
      { strokes: 1, slowSeconds: 0.5 },
      near(100, 100, 'rolling', 2),
      CUP,
      0.02,
      true,
    );
    expect(r.next).toEqual({ strokes: 2, slowSeconds: 0 });
  });
});

describe('paceSteps', () => {
  it('feeds the fixed-step clock scaled real time', () => {
    const slow = paceSteps(0, 0.1, 0.3);
    expect(slow.steps).toBe(3);
    expect(slow.accumulator).toBeCloseTo(0.005, 12);
  });

  it('matches advanceClock at full speed', () => {
    expect(paceSteps(0, 0.25, 1)).toEqual(advanceClock(0, 0.25));
    expect(paceSteps(0, 0.25, 1).steps).toBe(30);
  });
});

describe('createPacer', () => {
  const run = (enabled: boolean) => {
    const pacer = createPacer(() => enabled);
    let steps = 0;
    for (let i = 0; i < 13; i++) steps += pacer.steps(near(20, 300), CUP, 0.02);
    return { steps, snapshot: pacer.snapshot() };
  };

  it('slows the clock near the cup and counts the slowed frames', () => {
    const { steps, snapshot } = run(true);
    expect(steps).toBe(9);
    expect(snapshot).toEqual({ rate: 0.3, slowFrames: 13 });
  });

  it('runs at full speed when disabled', () => {
    const { steps, snapshot } = run(false);
    expect(steps).toBe(31);
    expect(snapshot).toEqual({ rate: 1, slowFrames: 0 });
  });

  it('starts at full speed and resets slowFrames when the strokes change', () => {
    const pacer = createPacer(() => true);
    expect(pacer.snapshot()).toEqual({ rate: 1, slowFrames: 0 });
    pacer.steps(near(20, 300), CUP, 0.02);
    expect(pacer.snapshot().slowFrames).toBe(1);
    pacer.steps(near(100, 300, 'rolling', 2), CUP, 0.02);
    expect(pacer.snapshot()).toEqual({ rate: 1, slowFrames: 0 });
  });
});
