// Bullet time: the last moments of a putt play in slow motion so the couch can lean in. Only how
// fast real time feeds the fixed-step clock changes; the simulation, its steps and hash do not.
import type { GameState } from '../core/game/state.ts';
import { distance, length, type Vec2 } from '../core/math/vec2.ts';
import { advanceClock, type ClockAdvance } from '../core/physics/timestep.ts';

/** How close to the cup (world units) the ball must be for slow motion. */
export const BULLET_RADIUS = 30;
/** Faster than this (units/s) the ball is flying past, not dropping: no slow motion. */
export const BULLET_MAX_SPEED = 420;
/** Real time is scaled by this while slowed. */
export const BULLET_RATE = 0.3;
/** Real seconds of slow motion per stroke, so a ball circling the cup can't drag on. */
export const BULLET_MAX_SECONDS = 0.8;

export interface BulletTimeState {
  readonly strokes: number;
  readonly slowSeconds: number;
}

export type BulletTimeView = Readonly<Pick<GameState, 'phase' | 'ball' | 'strokes'>>;

export function bulletTime(
  prev: BulletTimeState,
  state: BulletTimeView,
  cup: Vec2,
  frameSeconds: number,
  enabled: boolean,
): { rate: number; next: BulletTimeState } {
  const slowSeconds = state.strokes === prev.strokes ? prev.slowSeconds : 0;
  const slowed =
    enabled &&
    state.phase === 'rolling' &&
    distance(state.ball.pos, cup) <= BULLET_RADIUS &&
    length(state.ball.vel) <= BULLET_MAX_SPEED &&
    slowSeconds < BULLET_MAX_SECONDS;
  return {
    rate: slowed ? BULLET_RATE : 1,
    next: {
      strokes: state.strokes,
      slowSeconds: slowed ? slowSeconds + frameSeconds : slowSeconds,
    },
  };
}

export function paceSteps(accumulator: number, frameSeconds: number, rate: number): ClockAdvance {
  return advanceClock(accumulator, frameSeconds * rate);
}

export interface PaceSnapshot {
  readonly rate: number;
  /** Frames with rate < 1 since the strokes last changed. */
  readonly slowFrames: number;
}

export interface Pacer {
  /** How many fixed steps to simulate this frame. */
  steps(state: BulletTimeView, cup: Vec2, frameSeconds: number): number;
  snapshot(): PaceSnapshot;
}

/** Owns the real-time loop's accumulator and bullet-time state. */
export function createPacer(isEnabled: () => boolean): Pacer {
  let accumulator = 0;
  let bullet: BulletTimeState = { strokes: 0, slowSeconds: 0 };
  let rate = 1;
  let slowFrames = 0;
  return {
    steps(state, cup, frameSeconds) {
      if (state.strokes !== bullet.strokes) slowFrames = 0;
      const pace = bulletTime(bullet, state, cup, frameSeconds, isEnabled());
      bullet = pace.next;
      rate = pace.rate;
      if (rate < 1) slowFrames++;
      const clock = paceSteps(accumulator, frameSeconds, rate);
      accumulator = clock.accumulator;
      return clock.steps;
    },
    snapshot: () => ({ rate, slowFrames }),
  };
}
