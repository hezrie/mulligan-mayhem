import type { Hole } from '../core/course/schema.ts';
import type { GameSession, SessionEventListener } from '../core/game/session.ts';
import type { Shot } from '../core/game/shot.ts';
import { hashState } from '../core/hash.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { DT } from '../core/physics/constants.ts';
import type { AudioDebugState, CueEntry, FxSnapshot, MulliganTestApi } from './types.ts';

export interface TestApiDeps {
  readonly session: GameSession;
  getHole(id: string): Hole;
  /** Stops the real-time loop from stepping the simulation. */
  useManualClock(): void;
  worldToClient(p: Vec2): Vec2;
  /** The renderer's current effects state; read fresh on every getFx() call. */
  fxSnapshot?: () => FxSnapshot;
  /** The app's shot path (AppHandles.shoot), shared with pointer input; defaults to the session. */
  shoot?: (shot: Shot) => void;
  /** Called after every accepted shot, with the step it was taken at. */
  onShot?: (shot: Shot, step: number) => void;
  /** Called for every event fastForward produces, with the step of the tick that produced it. */
  onEvent?: SessionEventListener;
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
  const shoot =
    deps.shoot ??
    ((shot: Shot) => {
      session.shoot(shot);
    });
  const api: MulliganTestApi = {
    ready: true,
    loadHole(id, seed = 1) {
      deps.useManualClock();
      session.load(deps.getHole(id), seed);
      deps.audio?.cueLog.clear();
    },
    shoot(angle, power) {
      const shot = { angle, power };
      shoot(shot);
      deps.onShot?.(shot, session.state.step);
    },
    fastForward(duration) {
      if (duration === 'untilRest') return session.runUntilRest(deps.onEvent);
      const steps = Math.round(duration / 1000 / DT);
      session.advance(steps, deps.onEvent);
      return steps;
    },
    getState: () => structuredClone(session.state),
    getStateHash: () => hashState(session.state),
    getBallClientPosition: () => deps.worldToClient(session.state.ball.pos),
    getFx: () => structuredClone(deps.fxSnapshot?.() ?? {}),
    getCueLog: () => structuredClone([...(deps.audio?.cueLog.entries() ?? [])]),
    clearCueLog: () => deps.audio?.cueLog.clear(),
    getAudioState: () => deps.audio?.debugState() ?? { engine: 'absent' },
  };
  host.__MM__ = api;
  return api;
}
