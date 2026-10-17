import { describe, expect, it } from 'vitest';
import { MIN_SHOT_POWER } from '../../../src/core/game/shot.ts';
import { vec2 } from '../../../src/core/math/vec2.ts';
import {
  aimFromDrag,
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
