import type { Hole } from '../core/course/schema.ts';
import type { GameSession } from '../core/game/session.ts';
import { hashState } from '../core/hash.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { DT } from '../core/physics/constants.ts';
import type { FxSnapshot, MulliganTestApi } from './types.ts';

export interface TestApiDeps {
  readonly session: GameSession;
  getHole(id: string): Hole;
  /** Stops the real-time loop from stepping the simulation. */
  useManualClock(): void;
  worldToClient(p: Vec2): Vec2;
  /** The renderer's current effects state; read fresh on every getFx() call. */
  fxSnapshot?: () => FxSnapshot;
}

/** Anything that can hold the API: `window` in the browser, a plain object in unit tests. */
export interface TestApiHost {
  __MM__?: MulliganTestApi;
}

/** Installs `__MM__` on the host. Only ever called from main.ts behind `__TEST_API__`. */
export function installTestApi(host: TestApiHost, deps: TestApiDeps): MulliganTestApi {
  const { session } = deps;
  const api: MulliganTestApi = {
    ready: true,
    loadHole(id, seed = 1) {
      deps.useManualClock();
      session.load(deps.getHole(id), seed);
    },
    shoot(angle, power) {
      session.shoot({ angle, power });
    },
    fastForward(duration) {
      if (duration === 'untilRest') return session.runUntilRest();
      const steps = Math.round(duration / 1000 / DT);
      session.advance(steps);
      return steps;
    },
    getState: () => structuredClone(session.state),
    getStateHash: () => hashState(session.state),
    getBallClientPosition: () => deps.worldToClient(session.state.ball.pos),
    getFx: () => structuredClone(deps.fxSnapshot?.() ?? {}),
  };
  host.__MM__ = api;
  return api;
}
