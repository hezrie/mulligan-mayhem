import { terrainAt, type Course } from '../course/course.ts';
import { add, distance, length, scale, ZERO, type Vec2 } from '../math/vec2.ts';
import { contactCircleSegment, resolveContact } from './collision.ts';
import {
  BALL_RADIUS,
  CUP_CAPTURE_SPEED,
  DT,
  REST_SPEED,
  WALL_FRICTION,
  WALL_RESTITUTION,
} from './constants.ts';
import { TERRAIN } from './terrain.ts';

export interface BallState {
  readonly pos: Vec2;
  readonly vel: Vec2;
}

export type PhysicsEvent =
  { readonly type: 'bounce'; readonly impulse: number } | { readonly type: 'cup' };

export interface StepResult {
  readonly ball: BallState;
  readonly events: readonly PhysicsEvent[];
  readonly holed: boolean;
  readonly atRest: boolean;
  /** The ball centre ended this step over water: a hazard, which the game state machine handles. */
  readonly inWater: boolean;
}

/** Applies constant rolling deceleration; speed shrinks toward zero and never reverses. */
function applyRollingFriction(ball: BallState, course: Course): Vec2 {
  const speed = length(ball.vel);
  if (speed === 0) return ZERO;
  const decel = TERRAIN[terrainAt(course, ball.pos)].rollingDecel;
  const slower = Math.max(0, speed - decel * DT);
  return scale(ball.vel, slower / speed);
}

/**
 * Advances one ball by one fixed step (DT): friction, then movement in substeps of at most half
 * the ball radius (so it can't tunnel through a wall), wall collisions, cup capture, water and rest.
 */
export function stepBall(ball: BallState, course: Course): StepResult {
  let vel = applyRollingFriction(ball, course);
  let pos = ball.pos;
  const events: PhysicsEvent[] = [];

  const substeps = Math.max(1, Math.ceil((length(vel) * DT) / (BALL_RADIUS / 2)));
  const h = DT / substeps;
  for (let i = 0; i < substeps; i++) {
    pos = add(pos, scale(vel, h));
    for (const seg of course.segments) {
      const contact = contactCircleSegment(pos, BALL_RADIUS, seg);
      if (!contact) continue;
      const r = resolveContact(pos, vel, contact, WALL_RESTITUTION, WALL_FRICTION);
      pos = r.pos;
      vel = r.vel;
      if (r.impulse > 0) events.push({ type: 'bounce', impulse: r.impulse });
    }
    if (distance(pos, course.cup) <= course.cupRadius && length(vel) <= CUP_CAPTURE_SPEED) {
      events.push({ type: 'cup' });
      const ball = { pos: course.cup, vel: ZERO };
      return { ball, events, holed: true, atRest: true, inWater: false };
    }
  }

  // Reported even when the ball also stops, so a ball can never come to rest in water.
  const inWater = terrainAt(course, pos) === 'water';
  if (length(vel) < REST_SPEED) {
    return { ball: { pos, vel: ZERO }, events, holed: false, atRest: true, inWater };
  }
  return { ball: { pos, vel }, events, holed: false, atRest: false, inWater };
}
