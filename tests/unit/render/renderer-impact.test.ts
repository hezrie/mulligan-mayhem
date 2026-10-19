import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHole } from '../../../src/core/course/holes/index.ts';
import { hashState } from '../../../src/core/hash.ts';
import type { GameEvent } from '../../../src/core/game/machine.ts';
import { GameSession } from '../../../src/core/game/session.ts';
import { length } from '../../../src/core/math/vec2.ts';
import { BALL_RADIUS } from '../../../src/core/physics/constants.ts';
import { Rng } from '../../../src/core/rng.ts';
import {
  ballScale,
  decayTrauma,
  shakeAmplitude,
  shakeOffset,
  traumaFromImpulse,
} from '../../../src/render/impact.ts';
import { COLORS } from '../../../src/render/palette.ts';
import { fitView } from '../../../src/render/view.ts';
import { createRenderer } from '../../../src/render/renderer.ts';

type Op =
  | { kind: 'setTransform'; m: number[] }
  | { kind: 'arc'; x: number; y: number; r: number; fill: unknown }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number; rot: number };

/** Records transforms, arcs (with the fill colour in force when filled) and ellipses. */
function fakeContext(ops: Op[]): CanvasRenderingContext2D {
  const style: Record<string, unknown> = { fillStyle: '' };
  let pendingArc: Extract<Op, { kind: 'arc' }> | null = null;
  const methods: Record<string, unknown> = {
    beginPath: () => {
      pendingArc = null;
    },
    setTransform: (...m: number[]) => ops.push({ kind: 'setTransform', m }),
    arc: (x: number, y: number, r: number) => {
      pendingArc = { kind: 'arc', x, y, r, fill: null };
    },
    ellipse: (x: number, y: number, rx: number, ry: number, rot: number) =>
      ops.push({ kind: 'ellipse', x, y, rx, ry, rot }),
    fill: () => {
      if (pendingArc) ops.push({ ...pendingArc, fill: style['fillStyle'] });
    },
  };
  const noop = (): void => undefined;
  return new Proxy(style, {
    get: (target, key) =>
      typeof key === 'string' && key in methods
        ? methods[key]
        : key in target
          ? target[key as string]
          : noop,
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const DPR = 2;
const SIZE = { width: 400, height: 600 };

function setup() {
  const ops: Op[] = [];
  const ctx = fakeContext(ops);
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, ...SIZE }),
  } as unknown as HTMLCanvasElement;
  const renderer = createRenderer(canvas);
  const session = new GameSession(getHole('skeleton-01'), 1);
  const draw = (nowMs: number, events: readonly GameEvent[] = []): void => {
    ops.length = 0;
    renderer.draw(session.course, session.state, null, { nowMs, events });
  };
  return { ops, renderer, session, draw };
}

const bounce = (impulse: number): GameEvent => ({ type: 'bounce', impulse });

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: DPR });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = (): void => undefined;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderer: impact kit (shake, stretch and squash, drop shadow)', () => {
  it('decays trauma by the capped frame time before adding each positive bounce', () => {
    const { session, draw, renderer } = setup();
    session.shoot({ angle: -1.4, power: 0.7 });
    session.advance(1);
    draw(1000);
    draw(1016, [bounce(748.5476)]);
    expect(renderer.fxSnapshot().impact.trauma).toBe(traumaFromImpulse(748.5476));
    draw(1032, [bounce(0)]);
    const afterOne = decayTrauma(traumaFromImpulse(748.5476), 0.016);
    expect(renderer.fxSnapshot().impact.trauma).toBe(afterOne);
    // A 5 s gap decays as if only 100 ms passed.
    draw(6032);
    expect(renderer.fxSnapshot().impact.trauma).toBe(decayTrauma(afterOne, 0.1));
  });

  it('shifts the hole drawing by shakeOffset × dpr from a 0x5eed rng, but not the background', () => {
    const { session, draw, ops, renderer } = setup();
    session.shoot({ angle: -1.4, power: 0.7 });
    session.advance(1);
    draw(1000, [bounce(900)]);
    const trauma = renderer.fxSnapshot().impact.trauma;
    const shake = shakeOffset('rolling', trauma, new Rng(0x5eed));
    const view = fitView(SIZE.width, SIZE.height, session.course.hole.size, 16);
    const transforms = ops.filter((o) => o.kind === 'setTransform').map((o) => o.m);
    expect(transforms[0]).toEqual([DPR, 0, 0, DPR, 0, 0]);
    expect(transforms[1]).toEqual([
      DPR * view.scale,
      0,
      0,
      DPR * view.scale,
      DPR * (view.offsetX + shake.x),
      DPR * (view.offsetY + shake.y),
    ]);
    expect(shake.x !== 0 || shake.y !== 0).toBe(true);
    expect(renderer.fxSnapshot().impact.shakePx).toBe(shakeAmplitude(trauma));
    // Pointer mapping keeps using the unshaken view.
    const p = { x: 50, y: 80 };
    expect(renderer.worldToClient(p)).toEqual({
      x: view.offsetX + p.x * view.scale,
      y: view.offsetY + p.y * view.scale,
    });
  });

  it('draws a shadow circle at (+2, +3), then the ball as an ellipse from ballScale', () => {
    const { session, draw, ops, renderer } = setup();
    session.shoot({ angle: -1.4, power: 0.7 });
    session.advance(5);
    draw(1000);
    const { pos, vel } = session.state.ball;
    const shape = ballScale(length(vel), Infinity);
    const shadow = ops.findIndex(
      (o) => o.kind === 'arc' && o.x === pos.x + 2 && o.y === pos.y + 3 && o.r === BALL_RADIUS,
    );
    expect(shadow).toBeGreaterThanOrEqual(0);
    expect(ops[shadow]).toMatchObject({ fill: COLORS.wallShadow });
    const ball = ops.findIndex((o) => o.kind === 'ellipse');
    expect(ball).toBeGreaterThan(shadow);
    expect(ops[ball]).toEqual({
      kind: 'ellipse',
      x: pos.x,
      y: pos.y,
      rx: BALL_RADIUS * shape.along,
      ry: BALL_RADIUS * shape.across,
      rot: Math.atan2(vel.y, vel.x),
    });
    expect(renderer.fxSnapshot().impact.ballAlong).toBe(shape.along);

    // A wall hit this frame squashes the ball.
    draw(1016, [bounce(500)]);
    expect(renderer.fxSnapshot().impact.ballAlong).toBe(ballScale(length(vel), 0).along);
  });

  it('while aiming: no shake, shakePx 0 and a round ball', () => {
    const { draw, renderer, ops, session } = setup();
    draw(1000, [bounce(900)]);
    const view = fitView(SIZE.width, SIZE.height, session.course.hole.size, 16);
    const transforms = ops.filter((o) => o.kind === 'setTransform').map((o) => o.m);
    expect(transforms[1]?.slice(4)).toEqual([DPR * view.offsetX, DPR * view.offsetY]);
    expect(renderer.fxSnapshot().impact).toMatchObject({ shakePx: 0 });
    draw(1200);
    expect(renderer.fxSnapshot().impact).toMatchObject({ shakePx: 0, ballAlong: 1 });
  });

  it('never changes the game state or its hash', () => {
    const { session, draw } = setup();
    session.shoot({ angle: -1.4, power: 0.7 });
    session.advance(10);
    const before = hashState(session.state);
    draw(1000, [bounce(900)]);
    draw(1016);
    expect(hashState(session.state)).toBe(before);
  });
});
