import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHole } from '../../../src/core/course/holes/index.ts';
import type { GamePhase } from '../../../src/core/game/state.ts';
import { GameSession } from '../../../src/core/game/session.ts';
import { distance, dot, normalize, sub, type Vec2 } from '../../../src/core/math/vec2.ts';
import {
  drawGhostHand,
  ghostHandPose,
  GHOST_HAND_DRAG,
  GHOST_HAND_LOOP_MS,
  shouldDrawGhostHand,
  type GhostHandContext,
  type GhostHandPose,
} from '../../../src/render/ghost-hand.ts';
import { createRenderer } from '../../../src/render/renderer.ts';

const ball: Vec2 = { x: 240, y: 490 };
const cup: Vec2 = { x: 220, y: 110 };
const u = normalize(sub(ball, cup));

function expectAlongDrag(pos: Vec2, dist: number): void {
  const d = sub(pos, ball);
  expect(Math.abs(distance(pos, ball) - dist)).toBeLessThan(1e-9);
  expect(dot(d, u)).toBeGreaterThan(0);
  expect(Math.abs(d.x * u.y - d.y * u.x)).toBeLessThan(1e-9);
}

describe('ghostHandPose', () => {
  it('exports the loop length and drag distance', () => {
    expect(GHOST_HAND_LOOP_MS).toBe(2400);
    expect(GHOST_HAND_DRAG).toBe(110);
  });

  it('starts invisible and unpressed at the ball', () => {
    expect(ghostHandPose(ball, cup, 0)).toEqual({ pos: ball, alpha: 0, pressed: false });
  });

  it('is fully faded in and pressed at the ball at t=300', () => {
    expect(ghostHandPose(ball, cup, 300)).toEqual({ pos: ball, alpha: 1, pressed: true });
  });

  it('is halfway along the drag at t=900', () => {
    const p = ghostHandPose(ball, cup, 900);
    expectAlongDrag(p.pos, 55);
    expect(p.alpha).toBe(1);
    expect(p.pressed).toBe(true);
  });

  it.each([1500, 1800])('holds at the full drag at t=%i', (t) => {
    const p = ghostHandPose(ball, cup, t);
    expectAlongDrag(p.pos, 110);
    expect(p.alpha).toBe(1);
    expect(p.pressed).toBe(true);
  });

  it('is released and half faded at t=2150', () => {
    const p = ghostHandPose(ball, cup, 2150);
    expectAlongDrag(p.pos, 110);
    expect(p.alpha).toBe(0.5);
    expect(p.pressed).toBe(false);
  });

  it('loops every 2400 ms, including negative times', () => {
    expect(ghostHandPose(ball, cup, 2400)).toEqual(ghostHandPose(ball, cup, 0));
    expect(ghostHandPose(ball, cup, 2400 * 3 + 900)).toEqual(ghostHandPose(ball, cup, 900));
    expect(ghostHandPose(ball, cup, -100)).toEqual(ghostHandPose(ball, cup, 2300));
  });

  it('drags straight down when the ball sits on the cup', () => {
    expect(ghostHandPose(ball, ball, 1500).pos).toEqual({ x: 240, y: 600 });
  });
});

interface Call {
  name: string;
  args: unknown[];
}

/** Records method calls and every globalAlpha assignment. */
function recorder(): { ctx: GhostHandContext; calls: Call[]; alphas: number[] } {
  const calls: Call[] = [];
  const alphas: number[] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args });
    };
  let alpha = 1;
  const ctx: GhostHandContext = {
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    arc: rec('arc'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(v: number) {
      alpha = v;
      alphas.push(v);
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
  return { ctx, calls, alphas };
}

const named = (calls: Call[], name: string): Call[] => calls.filter((c) => c.name === name);

function draw(pose: GhostHandPose): ReturnType<typeof recorder> {
  const r = recorder();
  drawGhostHand(r.ctx, pose);
  expect(named(r.calls, 'save').length).toBe(named(r.calls, 'restore').length);
  return r;
}

describe('drawGhostHand', () => {
  const pos = { x: 10, y: 20 };

  it('draws one fingertip disc of radius 14 at alpha 0.9 when not pressed', () => {
    const { calls, alphas } = draw({ pos, alpha: 1, pressed: false });
    expect(named(calls, 'arc').map((c) => c.args)).toEqual([[10, 20, 14, 0, Math.PI * 2]]);
    expect(alphas[0]).toBe(0.9);
  });

  it('adds one ring of radius 20 while pressed', () => {
    const arcs = named(draw({ pos, alpha: 1, pressed: true }).calls, 'arc').map((c) => c.args);
    expect(arcs.filter((a) => a[2] === 14)).toEqual([[10, 20, 14, 0, Math.PI * 2]]);
    expect(arcs.filter((a) => a[2] === 20)).toEqual([[10, 20, 20, 0, Math.PI * 2]]);
    expect(arcs).toHaveLength(2);
  });

  it('scales its alpha by the pose alpha', () => {
    expect(draw({ pos, alpha: 0.5, pressed: false }).alphas[0]).toBeCloseTo(0.45, 12);
  });

  it('draws nothing at alpha 0', () => {
    const { calls } = draw({ pos, alpha: 0, pressed: true });
    expect(calls.filter((c) => ['arc', 'fill', 'stroke'].includes(c.name))).toEqual([]);
  });
});

describe('shouldDrawGhostHand', () => {
  const phases: GamePhase[] = ['aiming', 'rolling', 'hazard', 'holed'];
  const aims = [null, { angle: 0, power: 0.5 }];
  const hints = [null, { tMs: 0 }];
  for (const phase of phases)
    for (const aim of aims)
      for (const hint of hints) {
        const want = phase === 'aiming' && aim === null && hint !== null;
        it(`${phase}, aim ${aim ? 'set' : 'null'}, hint ${hint ? 'set' : 'null'} → ${String(want)}`, () => {
          expect(shouldDrawGhostHand(phase, aim, hint)).toBe(want);
        });
      }
});

describe('renderer: ghost hand hint', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
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

  function setup() {
    const ops: { name: string; args: unknown[] }[] = [];
    const style: Record<string, unknown> = { globalAlpha: 1 };
    const ctx = new Proxy(style, {
      get: (target, key) =>
        typeof key === 'string' && key in target
          ? target[key]
          : (...args: unknown[]) => {
              ops.push({ name: String(key), args });
            },
      set: (target, key, value) => {
        target[String(key)] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }),
    } as unknown as HTMLCanvasElement;
    const renderer = createRenderer(canvas);
    const session = new GameSession(getHole('skeleton-01'), 1);
    return { ops, renderer, session };
  }

  const handArcs = (ops: { name: string; args: unknown[] }[], at: Vec2): unknown[][] =>
    ops
      .filter((o) => o.name === 'arc' && o.args[0] === at.x && o.args[1] === at.y)
      .map((o) => o.args);

  it('draws the pose after the ball while aiming with no aim and a hint', () => {
    const { ops, renderer, session } = setup();
    const state = session.state;
    renderer.draw(session.course, state, null, { nowMs: 0, events: [] }, { tMs: 900 });
    const pose = ghostHandPose(state.ball.pos, session.course.cup, 900);
    expect(handArcs(ops, pose.pos)).toEqual([
      [pose.pos.x, pose.pos.y, 14, 0, Math.PI * 2],
      [pose.pos.x, pose.pos.y, 20, 0, Math.PI * 2],
    ]);
    const ballDraw = ops.findIndex((o) => o.name === 'ellipse');
    const handDraw = ops.findIndex((o) => o.name === 'arc' && o.args[0] === pose.pos.x);
    expect(ballDraw).toBeGreaterThanOrEqual(0);
    expect(handDraw).toBeGreaterThan(ballDraw);
    expect(session.state).toBe(state);
  });

  it('draws no hand without a hint or while the player is dragging', () => {
    const { ops, renderer, session } = setup();
    const pose = ghostHandPose(session.state.ball.pos, session.course.cup, 900);
    renderer.draw(session.course, session.state, null, { nowMs: 0, events: [] });
    renderer.draw(session.course, session.state, null, { nowMs: 0, events: [] }, null);
    renderer.draw(
      session.course,
      session.state,
      { angle: 1, power: 0.5 },
      { nowMs: 0, events: [] },
      { tMs: 900 },
    );
    expect(handArcs(ops, pose.pos)).toEqual([]);
  });
});
