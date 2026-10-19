import { describe, expect, it } from 'vitest';
import { MIN_SHOT_POWER } from '../../../src/core/game/shot.ts';
import { add, vec2 } from '../../../src/core/math/vec2.ts';
import { Rng } from '../../../src/core/rng.ts';
import {
  aimFromDrag,
  aimFromRelativeDrag,
  canGrab,
  GRAB_RADIUS,
  isCancel,
  MAX_DRAG,
} from '../../../src/input/drag-to-shot.ts';

const ball = vec2(100, 100);

describe('canGrab', () => {
  it('starts aiming only when the press is on or near the ball', () => {
    expect(canGrab(ball, vec2(100, 100))).toBe(true);
    expect(canGrab(ball, vec2(100 + GRAB_RADIUS - 1, 100))).toBe(true);
    expect(canGrab(ball, vec2(100 + GRAB_RADIUS + 1, 100))).toBe(false);
  });
});

describe('aimFromDrag (slingshot)', () => {
  it('shoots opposite to the drag: dragging down aims up the screen', () => {
    const shot = aimFromDrag(ball, vec2(100, 180));
    expect(shot.angle).toBeCloseTo(-Math.PI / 2, 12);
    expect(shot.power).toBeCloseTo(80 / MAX_DRAG, 12);
  });

  it('dragging left aims right (angle 0)', () => {
    expect(aimFromDrag(ball, vec2(40, 100)).angle).toBeCloseTo(0, 12);
  });

  it('caps power at 1 for long drags', () => {
    expect(aimFromDrag(ball, vec2(100, 100 + MAX_DRAG * 3)).power).toBe(1);
  });

  it('treats a release on the ball as a cancel, not a stroke', () => {
    const shot = aimFromDrag(ball, vec2(101, 100));
    expect(shot.power).toBeLessThan(MIN_SHOT_POWER);
    expect(isCancel(shot)).toBe(true);
    expect(isCancel(aimFromDrag(ball, vec2(100, 160)))).toBe(false);
  });
});

describe('aimFromRelativeDrag (drag anywhere)', () => {
  const start = vec2(100, 100);

  it('measures the drag from where the press started: 90 down aims up at 90/MAX_DRAG power', () => {
    const shot = aimFromRelativeDrag(start, vec2(100, 190));
    expect(shot.angle).toBeCloseTo(-Math.PI / 2, 12);
    expect(shot.power).toBe(90 / MAX_DRAG);
    expect(shot.power).toBe(0.5625);
  });

  it('caps power at 1 for a pointer 400 units away', () => {
    expect(aimFromRelativeDrag(start, vec2(100, 500)).power).toBe(1);
  });

  it('treats a release where the press started as a cancel', () => {
    const shot = aimFromRelativeDrag(start, vec2(100, 100));
    expect(shot.power).toBe(0);
    expect(isCancel(shot)).toBe(true);
  });

  it('matches aimFromDrag exactly for the same drag offset (50 seeded cases)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 50; i++) {
      const from = vec2(rng.int(0, 400), rng.int(0, 400));
      const ballPos = vec2(rng.int(0, 400), rng.int(0, 400));
      const d = vec2(rng.int(-200, 200), rng.int(-200, 200));
      const relative = aimFromRelativeDrag(from, add(from, d));
      const grabbed = aimFromDrag(ballPos, add(ballPos, d));
      expect(relative.angle).toBe(grabbed.angle);
      expect(relative.power).toBe(grabbed.power);
    }
  });
});
