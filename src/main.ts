// Boot only: find the DOM, start the app (src/app wires the layers together) and, in dev/test
// builds, install the test API. Feature wiring belongs in src/app, never here.
import { startApp } from './app/start-app.ts';
import { getHole } from './core/course/holes/index.ts';

const root = document.querySelector<HTMLElement>('#app');
const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!root || !canvas) throw new Error('Missing #app or <canvas id="game">');

const app = startApp(root, canvas);

if (__TEST_API__) {
  void import('./testing/api.ts').then(({ installTestApi }) =>
    installTestApi(window, {
      session: app.session,
      getHole,
      useManualClock: app.useManualClock,
      shoot: app.shoot,
      worldToClient: (p) => app.renderer.worldToClient(p),
      fxSnapshot: () => ({ ...app.renderer.fxSnapshot(), pace: app.pacer.snapshot() }),
      onShot: (shot) => {
        app.hear({ type: 'shot', power: shot.power });
      },
      onEvent: app.hear,
      audio: app.audio,
      storage: window.localStorage,
    }),
  );
}
