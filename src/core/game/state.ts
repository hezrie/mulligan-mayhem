import type { Vec2 } from '../math/vec2.ts';
import type { BallState } from '../physics/step.ts';

/** aiming → rolling → aiming (at rest) | holed. Future: hazard, next (see ARCHITECTURE.md). */
export type GamePhase = 'aiming' | 'rolling' | 'holed';

/** The complete, serializable state of one hole in progress. Hashed by hashState(). */
export interface GameState {
  readonly holeId: string;
  readonly phase: GamePhase;
  readonly ball: BallState;
  readonly strokes: number;
  /** Where the ball last came to rest (water hazards will reset here). */
  readonly lastRest: Vec2;
  /** Fixed steps simulated since the hole was loaded. */
  readonly step: number;
  /** Fixed steps in the current roll (for the safety cap). */
  readonly rollSteps: number;
  /** Seeded PRNG state: the only source of randomness. */
  readonly rngState: number;
}
