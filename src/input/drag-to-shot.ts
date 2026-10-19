import { MIN_SHOT_POWER, type Shot } from '../core/game/shot.ts';
import { distance, length, sub, type Vec2 } from '../core/math/vec2.ts';

/** Drag length (world units) that gives full power. */
export const MAX_DRAG = 160;

/** A press must start this close to the ball (world units) to begin aiming. Finger-friendly. */
export const GRAB_RADIUS = 48;

export function canGrab(ball: Vec2, pointer: Vec2): boolean {
  return distance(ball, pointer) <= GRAB_RADIUS;
}

/**
 * Slingshot aiming: the shot goes opposite to the drag (ball → pointer), and drag length sets
 * power. Math.atan2 is fine here: input is not core, and the resulting angle is recorded as data.
 */
export function aimFromDrag(ball: Vec2, pointer: Vec2): Shot {
  const drag = sub(pointer, ball);
  return {
    angle: Math.atan2(-drag.y, -drag.x),
    power: Math.min(length(drag) / MAX_DRAG, 1),
  };
}

/**
 * 'Drag anywhere' aiming: the same slingshot maths, measured from where the press started
 * instead of from the ball, so a finger never has to cover the ball.
 */
export function aimFromRelativeDrag(start: Vec2, pointer: Vec2): Shot {
  return aimFromDrag(start, pointer);
}

export function isCancel(shot: Shot): boolean {
  return shot.power < MIN_SHOT_POWER;
}
