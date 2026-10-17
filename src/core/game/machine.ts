import type { Course } from '../course/course.ts';
import { scale, ZERO } from '../math/vec2.ts';
import { direction } from '../math/trig.ts';
import { MAX_ROLL_STEPS, MAX_SHOT_SPEED } from '../physics/constants.ts';
import { stepBall, type PhysicsEvent } from '../physics/step.ts';
import { seedState } from '../rng.ts';
import { isValidShot, type Shot } from './shot.ts';
import type { GameState } from './state.ts';

export type GameEvent =
  | PhysicsEvent
  | { readonly type: 'rest'; readonly forced: boolean }
  | { readonly type: 'holed'; readonly strokes: number };

export interface TickResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export class ShotRejectedError extends Error {
  override readonly name = 'ShotRejectedError';
}

export function createGame(course: Course, seed: number): GameState {
  const tee = course.hole.tee;
  return {
    holeId: course.hole.id,
    phase: 'aiming',
    ball: { pos: tee, vel: ZERO },
    strokes: 0,
    lastRest: tee,
    step: 0,
    rollSteps: 0,
    rngState: seedState(seed),
  };
}

/** Launches the ball. Only legal while aiming, with a valid shot; each shot is one stroke. */
export function shoot(state: GameState, shot: Shot): GameState {
  if (state.phase !== 'aiming') {
    throw new ShotRejectedError(`cannot shoot while ${state.phase}`);
  }
  if (!isValidShot(shot)) {
    throw new ShotRejectedError(
      `invalid shot: angle=${String(shot.angle)} power=${String(shot.power)}`,
    );
  }
  return {
    ...state,
    phase: 'rolling',
    strokes: state.strokes + 1,
    ball: { pos: state.ball.pos, vel: scale(direction(shot.angle), shot.power * MAX_SHOT_SPEED) },
    rollSteps: 0,
  };
}

/** Advances the game by one fixed step. The clock always advances; the ball moves only while rolling. */
export function tick(state: GameState, course: Course): TickResult {
  const clocked = { ...state, step: state.step + 1 };
  if (state.phase !== 'rolling') return { state: clocked, events: [] };

  const result = stepBall(state.ball, course);
  const events: GameEvent[] = [...result.events];
  const rollSteps = state.rollSteps + 1;

  if (result.holed) {
    events.push({ type: 'holed', strokes: state.strokes });
    return { state: { ...clocked, phase: 'holed', ball: result.ball, rollSteps: 0 }, events };
  }
  if (result.atRest || rollSteps >= MAX_ROLL_STEPS) {
    const pos = result.ball.pos;
    events.push({ type: 'rest', forced: !result.atRest });
    return {
      state: { ...clocked, phase: 'aiming', ball: { pos, vel: ZERO }, lastRest: pos, rollSteps: 0 },
      events,
    };
  }
  return { state: { ...clocked, ball: result.ball, rollSteps }, events };
}
