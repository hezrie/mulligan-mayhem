// Composition root: creates the layers, connects them and runs the frame loop. Wiring only, no
// game logic. main.ts boots it; new features wire themselves in here, or in sibling files here.
import { DEFAULT_HOLE_ID, getHole } from '../core/course/holes/index.ts';
import { GameSession } from '../core/game/session.ts';
import type { Shot } from '../core/game/shot.ts';
import { attachAimInput } from '../input/pointer.ts';
import { createRenderer, type Renderer } from '../render/renderer.ts';
import { createBrowserSoundscape, type BrowserSoundscape } from '../ui/audio/browser.ts';
import type { SoundTrigger } from '../ui/audio/cues.ts';
import { createPacer, type Pacer } from '../ui/bullet-time.ts';
import { createCompleteScreen } from '../ui/complete-screen.ts';
import { createHud } from '../ui/hud.ts';
import { createSettingsStore } from '../ui/settings-store.ts';
import { createShell } from '../ui/shell.ts';
import { getBrowserStorage } from '../ui/storage.ts';

/** What main.ts hands to the dev/test-only test API. */
export interface AppHandles {
  readonly session: GameSession;
  readonly renderer: Renderer;
  /** Paces the real-time loop (bullet time near the cup); the test API reports its snapshot. */
  readonly pacer: Pick<Pacer, 'snapshot'>;
  /** Stops the frame loop from advancing the simulation (tests drive it instead). */
  readonly useManualClock: () => void;
  /** The one shot path: pointer input and `__MM__.shoot` both call it. Throws ShotRejectedError. */
  readonly shoot: (shot: Shot) => void;
  /** Hears every accepted shot with the step it was taken at; returns an unsubscribe. */
  readonly onShot: (listener: ShotListener) => () => void;
  /** Sounds a trigger at the session's current step; the test API forwards its shots and events. */
  readonly hear: (trigger: SoundTrigger) => void;
  readonly audio: Pick<BrowserSoundscape, 'cueLog' | 'debugState'>;
}

export type ShotListener = (shot: Shot, step: number) => void;

export function startApp(app: HTMLElement, canvas: HTMLCanvasElement): AppHandles {
  const session = new GameSession(getHole(DEFAULT_HOLE_ID), 1);
  const renderer = createRenderer(canvas);
  let aim: Shot | null = null;
  let manualClock = false;
  const shotListeners = new Set<ShotListener>();
  // The page's one settings store; the settings screen must reuse it, never create another.
  const settings = createSettingsStore(getBrowserStorage(window));
  const { soundscape, cueLog, debugState } = createBrowserSoundscape(window);
  const hear = (trigger: SoundTrigger): void => {
    soundscape.handle(trigger, { step: session.state.step, par: session.course.hole.par });
  };
  const shoot = (shot: Shot): void => {
    session.shoot(shot);
    for (const listener of shotListeners) listener(shot, session.state.step);
  };

  attachAimInput(canvas, {
    toWorld: (x, y) => renderer.clientToWorld(x, y),
    ballIfAiming: () => (session.state.phase === 'aiming' ? session.state.ball.pos : null),
    aimMode: () => settings.get().aimMode,
    onAimChange: (shot) => {
      aim = shot;
    },
    // The putt is sounded here, not in shoot(): the test API sounds its own shots via onShot.
    onShoot: (shot) => {
      shoot(shot);
      hear({ type: 'shot', power: shot.power });
    },
  });

  const restart = (): void => {
    aim = null;
    session.reset();
  };
  const hud = createHud(app, restart);
  const complete = createCompleteScreen(app, restart);
  createShell(app, { window });

  // Real-time loop only: __MM__.fastForward calls session.advance directly, unpaced.
  const pacer = createPacer(() => true);
  let last = performance.now();
  function frame(now: number): void {
    const steps = pacer.steps(session.state, session.course.hole.cup, (now - last) / 1000);
    last = now;
    // One step at a time, so each sound is stamped with the step that produced it.
    if (!manualClock) for (let i = 0; i < steps; i++) session.advance(1).forEach(hear);
    renderer.draw(session.course, session.state, aim, {
      nowMs: now,
      events: session.drainEvents(),
    });
    hud.update(session.state, session.course.hole);
    complete.update(session.state, session.course.hole, now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    session,
    renderer,
    pacer,
    useManualClock: () => {
      manualClock = true;
    },
    shoot,
    onShot: (listener) => {
      shotListeners.add(listener);
      return () => shotListeners.delete(listener);
    },
    hear,
    audio: { cueLog, debugState },
  };
}
