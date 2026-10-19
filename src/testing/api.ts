import { parseHole, type Hole } from '../core/course/schema.ts';
import type { GameEvent } from '../core/game/machine.ts';
import { isResolvingShot, type GameSession } from '../core/game/session.ts';
import type { Shot } from '../core/game/shot.ts';
import { hashState } from '../core/hash.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { DT, HAZARD_PAUSE_STEPS, MAX_ROLL_STEPS } from '../core/physics/constants.ts';
import type { AudioDebugState, CueEntry, FxSnapshot, MulliganTestApi } from './types.ts';

export interface TestApiDeps {
  readonly session: GameSession;
  getHole(id: string): Hole;
  /** Stops the real-time loop from stepping the simulation. */
  useManualClock(): void;
  worldToClient(p: Vec2): Vec2;
  /** The renderer's current effects state; read fresh on every getFx() call. */
  fxSnapshot?: () => FxSnapshot;
  /** Called after every accepted shot, because shoot() bypasses the app's own input path. */
  onShot?: (shot: Shot, step: number) => void;
  /** Called for every event fastForward produces, with the step of the tick that produced it. */
  onEvent?: (event: GameEvent, step: number) => void;
  readonly audio?: {
    readonly cueLog: { entries(): readonly CueEntry[]; clear(): void };
    debugState(): AudioDebugState;
  };
}

/** Anything that can hold the API: `window` in the browser, a plain object in unit tests. */
export interface TestApiHost {
  __MM__?: MulliganTestApi;
}

/** Installs `__MM__` on the host. Only ever called from main.ts behind `__TEST_API__`. */
export function installTestApi(host: TestApiHost, deps: TestApiDeps): MulliganTestApi {
  const { session } = deps;
  // One tick at a time, so every event reaches onEvent with the step that produced it.
  const tick = (): void => {
    for (const e of session.advance(1)) deps.onEvent?.(e, session.state.step);
  };
  const api: MulliganTestApi = {
    ready: true,
    loadHole(id, seed = 1) {
      deps.useManualClock();
      session.load(deps.getHole(id), seed);
      deps.audio?.cueLog.clear();
    },
    loadHoleData(data, seed = 1) {
      // Validate first so a rejected hole leaves the clock and the session untouched.
      const hole = parseHole(data);
      deps.useManualClock();
      session.load(hole, seed);
      deps.audio?.cueLog.clear();
    },
    shoot(angle, power) {
      const shot = { angle, power };
      session.shoot(shot);
      deps.onShot?.(shot, session.state.step);
    },
    fastForward(duration) {
      if (duration === 'untilRest') {
        // Mirrors GameSession.runUntilRest tick for tick; calling it would lose the events.
        let steps = 0;
        while (isResolvingShot(session.state) && steps <= MAX_ROLL_STEPS + HAZARD_PAUSE_STEPS) {
          tick();
          steps++;
        }
        return steps;
      }
      const steps = Math.round(duration / 1000 / DT);
      for (let i = 0; i < steps; i++) tick();
      return steps;
    },
    getState: () => structuredClone(session.state),
    getStateHash: () => hashState(session.state),
    getBallClientPosition: () => deps.worldToClient(session.state.ball.pos),
    worldToClient: (p) => deps.worldToClient(p),
    getFx: () => structuredClone(deps.fxSnapshot?.() ?? {}),
    getCueLog: () => structuredClone([...(deps.audio?.cueLog.entries() ?? [])]),
    clearCueLog: () => deps.audio?.cueLog.clear(),
    getAudioState: () => deps.audio?.debugState() ?? { engine: 'absent' },
  };
  host.__MM__ = api;
  return api;
}
