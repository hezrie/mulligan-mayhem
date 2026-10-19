/**
 * Screen-shake trauma and ball stretch/squash. Pure maths of impulses, speeds and elapsed time, so
 * the renderer only has to apply it. Shake jitter comes from a render-owned Rng, never from
 * GameState, so presentation can never change the simulation or the state hash.
 */
import type { GamePhase } from '../core/game/state.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { MAX_SHOT_SPEED } from '../core/physics/constants.ts';
import type { Rng } from '../core/rng.ts';

/** A wall hit with this impulse (or more) gives full trauma. */
export const TRAUMA_FULL_IMPULSE = 1000;
/** Trauma lost per second, so a full shake settles in about 0.6 s. */
export const TRAUMA_DECAY_PER_S = 1.6;
/** Shake offset at full trauma, in CSS px. Squaring trauma keeps small bumps subtle. */
export const SHAKE_MAX_PX = 8;
/** How long the ball stays squashed after a wall hit. */
export const SQUASH_MS = 60;
/** Ball length along its motion while squashed against a wall. */
export const SQUASH_ALONG = 0.75;
/** Extra length along the motion at full shot speed. */
export const STRETCH_MAX = 0.2;
/** Speed at which the stretch peaks: a full-power shot. */
const STRETCH_REF_SPEED = MAX_SHOT_SPEED;

export interface BallScale {
  readonly along: number;
  readonly across: number;
}

export function traumaFromImpulse(impulse: number): number {
  return Math.min(1, impulse / TRAUMA_FULL_IMPULSE);
}

/** A weaker hit never cuts short the shake from a stronger one. */
export function addTrauma(current: number, impulse: number): number {
  return Math.max(current, traumaFromImpulse(impulse));
}

export function decayTrauma(trauma: number, dtSeconds: number): number {
  return Math.max(0, trauma - TRAUMA_DECAY_PER_S * dtSeconds);
}

export function shakeAmplitude(trauma: number): number {
  return SHAKE_MAX_PX * trauma * trauma;
}

/** No shake while aiming, and no rng draw either, so aiming never shifts the jitter sequence. */
export function shakeOffset(phase: GamePhase, trauma: number, rng: Rng): Vec2 {
  if (phase === 'aiming') return { x: 0, y: 0 };
  const amplitude = shakeAmplitude(trauma);
  const x = (2 * rng.float() - 1) * amplitude;
  const y = (2 * rng.float() - 1) * amplitude;
  return { x, y };
}

/** Pass Infinity for msSinceWallHit before the first wall hit. Area is kept: across = 1/along. */
export function ballScale(speed: number, msSinceWallHit: number): BallScale {
  const along =
    msSinceWallHit < SQUASH_MS
      ? SQUASH_ALONG
      : 1 + STRETCH_MAX * Math.min(speed / STRETCH_REF_SPEED, 1);
  return { along, across: 1 / along };
}
