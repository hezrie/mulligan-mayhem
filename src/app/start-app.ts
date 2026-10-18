// Composition root: creates the layers, connects them and runs the frame loop. Wiring only, no
// game logic. main.ts boots it; new features wire themselves in here, or in sibling files here.
import { DEFAULT_HOLE_ID, getHole } from '../core/course/holes/index.ts';
import { GameSession } from '../core/game/session.ts';
import type { Shot } from '../core/game/shot.ts';
import { advanceClock } from '../core/physics/timestep.ts';
import { attachAimInput } from '../input/pointer.ts';
import { createRenderer, type Renderer } from '../render/renderer.ts';
import { createCompleteScreen } from '../ui/complete-screen.ts';
import { createHud } from '../ui/hud.ts';

/** What main.ts hands to the dev/test-only test API. */
export interface AppHandles {
  readonly session: GameSession;
  readonly renderer: Renderer;
  /** Stops the frame loop from advancing the simulation (tests drive it instead). */
  readonly useManualClock: () => void;
}

export function startApp(app: HTMLElement, canvas: HTMLCanvasElement): AppHandles {
  const session = new GameSession(getHole(DEFAULT_HOLE_ID), 1);
  const renderer = createRenderer(canvas);
  let aim: Shot | null = null;
  let manualClock = false;

  attachAimInput(canvas, {
    toWorld: (x, y) => renderer.clientToWorld(x, y),
    ballIfAiming: () => (session.state.phase === 'aiming' ? session.state.ball.pos : null),
    onAimChange: (shot) => {
      aim = shot;
    },
    onShoot: (shot) => {
      session.shoot(shot);
    },
  });

  const restart = (): void => {
    aim = null;
    session.reset();
  };
  const hud = createHud(app, restart);
  const complete = createCompleteScreen(app, restart);

  let accumulator = 0;
  let last = performance.now();
  function frame(now: number): void {
    const clock = advanceClock(accumulator, (now - last) / 1000);
    last = now;
    accumulator = clock.accumulator;
    if (!manualClock) session.advance(clock.steps);
    renderer.draw(session.course, session.state, aim);
    hud.update(session.state, session.course.hole);
    complete.update(session.state, session.course.hole);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    session,
    renderer,
    useManualClock: () => {
      manualClock = true;
    },
  };
}
