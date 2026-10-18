import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHole } from '../../../src/core/course/holes/index.ts';
import { GameSession } from '../../../src/core/game/session.ts';
import type { Shot } from '../../../src/core/game/shot.ts';
import type { Vec2 } from '../../../src/core/math/vec2.ts';
import { aimVisual, bandEnd, ringTicks } from '../../../src/render/aim.ts';
import { COLORS } from '../../../src/render/palette.ts';
import { createRenderer } from '../../../src/render/renderer.ts';

interface StrokeOp {
  kind: 'stroke';
  path: Vec2[];
  color: unknown;
  width: number;
  cap: string;
  dash: number[];
}

interface TextOp {
  kind: 'strokeText' | 'fillText';
  text: string;
  x: number;
  y: number;
  font: string;
  align: string;
  color: unknown;
  width: number;
}

type Op = StrokeOp | TextOp;

/** A 2D context stand-in that records every stroke and text draw with the style in force. */
function fakeContext(ops: Op[]): CanvasRenderingContext2D {
  let path: Vec2[] = [];
  let dash: number[] = [];
  const style = {
    strokeStyle: '' as unknown,
    fillStyle: '' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
  const text = (kind: TextOp['kind'], color: unknown, s: string, x: number, y: number): void => {
    ops.push({
      kind,
      text: s,
      x,
      y,
      font: style.font,
      align: style.textAlign,
      color,
      width: style.lineWidth,
    });
  };
  const methods: Record<string, unknown> = {
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push({ x, y }),
    lineTo: (x: number, y: number) => path.push({ x, y }),
    setLineDash: (d: number[]) => {
      dash = [...d];
    },
    stroke: () => {
      ops.push({
        kind: 'stroke',
        path: [...path],
        color: style.strokeStyle,
        width: style.lineWidth,
        cap: style.lineCap,
        dash: [...dash],
      });
    },
    strokeText: (s: string, x: number, y: number) => {
      text('strokeText', style.strokeStyle, s, x, y);
    },
    fillText: (s: string, x: number, y: number) => {
      text('fillText', style.fillStyle, s, x, y);
    },
  };
  const noop = (): void => undefined;
  return new Proxy(style, {
    get: (target, key) =>
      typeof key === 'string' && key in methods
        ? methods[key]
        : key in target
          ? target[key as keyof typeof target]
          : noop,
  }) as unknown as CanvasRenderingContext2D;
}

function setup() {
  const ops: Op[] = [];
  const ctx = fakeContext(ops);
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }),
  } as unknown as HTMLCanvasElement;
  const renderer = createRenderer(canvas);
  const session = new GameSession(getHole('skeleton-01'), 1);
  const draw = (aim: Shot | null): void => {
    ops.length = 0;
    renderer.draw(session.course, session.state, aim, { nowMs: 0, events: [] });
  };
  return { ops, renderer, session, draw, ball: session.state.ball.pos };
}

const strokes = (ops: Op[]): StrokeOp[] => ops.filter((o): o is StrokeOp => o.kind === 'stroke');

/** Index of the first stroke that traces exactly `path`. */
function findStroke(ops: StrokeOp[], path: readonly Vec2[]): number {
  const key = JSON.stringify(path);
  return ops.findIndex((o) => JSON.stringify(o.path) === key);
}

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

describe('renderer: slingshot band, power ring and cancel state', () => {
  const aim: Shot = { angle: Math.PI / 2 + 0.3, power: 0.47 };

  it('draws the band from the ball to bandEnd: outline at bandWidth + 2, then the power colour', () => {
    const { ops, draw, ball } = setup();
    draw(aim);
    const visual = aimVisual(aim);
    const all = strokes(ops);
    const band = [ball, bandEnd(ball, aim)];
    const outline = findStroke(all, band);
    expect(outline).toBeGreaterThanOrEqual(0);
    expect(all[outline]).toMatchObject({
      color: COLORS.aimOutline,
      width: visual.bandWidth + 2,
      cap: 'round',
      dash: [],
    });
    expect(all[outline + 1]).toMatchObject({
      path: band,
      color: visual.color,
      width: visual.bandWidth,
      cap: 'round',
      dash: [],
    });
  });

  it('strokes each ring tick in the outline at width 4, then in its colour at width 2', () => {
    const { ops, draw, ball } = setup();
    draw(aim);
    const all = strokes(ops);
    const ticks = ringTicks(ball, aimVisual(aim));
    expect(ticks).toHaveLength(10);
    for (const tick of ticks) {
      const i = findStroke(all, [tick.from, tick.to]);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(all[i]).toMatchObject({ color: COLORS.aimOutline, width: 4 });
      expect(all[i + 1]).toMatchObject({ path: [tick.from, tick.to], color: tick.color, width: 2 });
    }
  });

  it('still draws the dashed forward aim line when not cancelled', () => {
    const { ops, draw } = setup();
    draw(aim);
    expect(strokes(ops).filter((o) => o.dash.length > 0)).toHaveLength(2);
    expect(ops.some((o) => o.kind !== 'stroke' && o.text === 'Release to cancel')).toBe(false);
  });

  it('in the cancel state hides the forward line, greys the band and ring and says Release to cancel', () => {
    const { ops, draw, ball } = setup();
    const weak: Shot = { angle: 1, power: 0.01 };
    draw(weak);
    const all = strokes(ops);
    expect(all.filter((o) => o.dash.length > 0)).toHaveLength(0);

    const band = findStroke(all, [ball, bandEnd(ball, weak)]);
    expect(all[band + 1]).toMatchObject({ color: COLORS.aimCancel });
    for (const tick of ringTicks(ball, aimVisual(weak))) {
      const i = findStroke(all, [tick.from, tick.to]);
      expect(all[i + 1]).toMatchObject({ color: COLORS.aimCancel, width: 2 });
    }

    const at = { text: 'Release to cancel', x: ball.x, y: ball.y + 30, align: 'center' };
    const textOps = ops.filter((o): o is TextOp => o.kind !== 'stroke');
    expect(textOps).toEqual([
      {
        kind: 'strokeText',
        ...at,
        font: 'bold 12px sans-serif',
        color: COLORS.aimOutline,
        width: 3,
      },
      { kind: 'fillText', ...at, font: 'bold 12px sans-serif', color: '#ffffff', width: 3 },
    ]);
  });

  it('fxSnapshot().aim is aimVisual(aim) from the last drawn frame, or null with no aim', () => {
    const { draw, renderer } = setup();
    draw(null);
    expect(renderer.fxSnapshot().aim).toBeNull();
    draw(aim);
    expect(renderer.fxSnapshot().aim).toEqual(aimVisual(aim));
    draw({ angle: 0, power: 0.01 });
    expect(renderer.fxSnapshot().aim).toEqual(aimVisual({ angle: 0, power: 0.01 }));
    draw(null);
    expect(renderer.fxSnapshot().aim).toBeNull();
  });
});
