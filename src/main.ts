// Wiring only: find the DOM, create the layers, connect them, run the loop. No game logic here.
import { DEFAULT_HOLE_ID, getHole } from './core/course/holes/index.ts';
import { GameSession } from './core/game/session.ts';
import type { Shot } from './core/game/shot.ts';
import { advanceClock } from './core/physics/timestep.ts';
import { attachAimInput } from './input/pointer.ts';
import { createRenderer } from './render/renderer.ts';
import { createCompleteScreen } from './ui/complete-screen.ts';
import { createHud } from './ui/hud.ts';

const app = document.querySelector<HTMLElement>('#app');
const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!app || !canvas) throw new Error('Missing #app or <canvas id="game">');

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

if (__TEST_API__) {
  void import('./testing/api.ts').then(({ installTestApi }) =>
    installTestApi(window, {
      session,
      getHole,
      useManualClock: () => {
        manualClock = true;
      },
      worldToClient: (p) => renderer.worldToClient(p),
    }),
  );
}
