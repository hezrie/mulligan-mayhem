import type { Vec2 } from '../math/vec2.ts';
import type { BallState } from '../physics/step.ts';

/** aiming → rolling → aiming (at rest) | hazard → aiming | holed (see ARCHITECTURE.md). */
export type GamePhase = 'aiming' | 'rolling' | 'hazard' | 'holed';

/** The complete, serializable state of one hole in progress. Hashed by hashState(). */
export interface GameState {
  readonly holeId: string;
  readonly phase: GamePhase;
  readonly ball: BallState;
  readonly strokes: number;
  /** Where the ball last came to rest (a water hazard puts the ball back here). */
  readonly lastRest: Vec2;
  /** Fixed steps simulated since the hole was loaded. */
  readonly step: number;
  /**
   * Fixed steps in the current roll (for the safety cap) or, in `hazard`, in the pause. Reused
   * rather than adding a field, so the hash layout and every golden replay stay unchanged.
   */
  readonly rollSteps: number;
  /** Seeded PRNG state: the only source of randomness. */
  readonly rngState: number;
}
