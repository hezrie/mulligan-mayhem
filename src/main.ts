// Wiring only: find the DOM, start the layers, connect them. No game logic lives here.
const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) {
  throw new Error('Missing <canvas id="game">');
}

const ctx = canvas.getContext('2d');
if (ctx) {
  ctx.fillStyle = '#3a8f3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

if (__TEST_API__) {
  void import('./testing/api.ts').then(({ installTestApi }) => installTestApi(window));
}
