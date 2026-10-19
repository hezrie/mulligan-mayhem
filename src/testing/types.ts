import type { GameState } from '../core/game/state.ts';
import type { Vec2 } from '../core/math/vec2.ts';

/**
 * The test API exposed as `window.__MM__` in dev/test/e2e builds only (never in production).
 * Playwright drives the game through it deterministically; see docs/ARCHITECTURE.md.
 */
export interface MulliganTestApi {
  readonly ready: true;
  /** Loads a hole and switches to a manual clock, so only fastForward advances time. */
  loadHole(id: string, seed?: number): void;
  /** Takes a shot exactly like a player would. Throws unless the phase is 'aiming'. */
  shoot(angle: number, power: number): void;
  /** Runs fixed steps synchronously: a duration in ms, or until the ball stops. Returns steps run. */
  fastForward(duration: number | 'untilRest'): number;
  getState(): GameState;
  getStateHash(): string;
  /** `hashHole(generateHole(seed, index))`, to compare the Daily generator with Node. */
  getGeneratedHoleHash(seed: number, index: number): string;
  /** Where the ball is on screen, in client pixels (for real pointer-input tests). */
  getBallClientPosition(): Vec2;
  /** A detached JSON copy of what the renderer's effects are showing; `{}` until wired. */
  getFx(): FxSnapshot;
  /** A detached copy of every audio cue fired since the last clear or loadHole; `[]` until wired. */
  getCueLog(): CueEntry[];
  clearCueLog(): void;
  /** The audio engine's debug state; `{ engine: 'absent' }` until wired. */
  getAudioState(): AudioDebugState;
}

/** One fired sound cue, tagged with the simulation step it fired on. */
export interface CueEntry {
  readonly channel: string;
  readonly cue: string;
  readonly step: number;
}

export type AudioDebugState = Readonly<Record<string, string | number | boolean>>;

/**
 * Renderer effects state, one top-level field per effect. Kept generic because src/testing may
 * import only core; specs cast the values to local interfaces.
 */
export type FxSnapshot = Readonly<Record<string, unknown>>;

declare global {
  interface Window {
    __MM__?: MulliganTestApi;
  }
}
