import type { Course } from '../core/course/course.ts';
import type { GameState } from '../core/game/state.ts';
import type { Shot } from '../core/game/shot.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { BALL_RADIUS } from '../core/physics/constants.ts';
import { scoreName } from '../core/scoring/score.ts';
import { aimStrokeStyles } from './aim.ts';
import { lerp } from './easing.ts';
import { countEvents, ZERO_COUNTS, type EventCounts, type FrameInput } from './fx-frame.ts';
import { COLORS, TERRAIN_COLORS } from './palette.ts';
import {
  flagGeometry,
  plunkFrame,
  plunkSlideStart,
  stampAnchor,
  stampText,
  type PlunkFrame,
} from './plunk.ts';
import { fitView, screenToWorld, worldToScreen, type View } from './view.ts';

const PADDING = 16;
const WALL_WIDTH = 4;
const STAMP_FONT = 'bold 24px sans-serif';
const STAMP_OUTLINE_WIDTH = 3;

/** What the renderer remembers about the drop it is animating. */
interface Plunk {
  readonly startMs: number;
  /** Where the ball slides in from: the last frame before the holed snap, or the cup. */
  readonly from: Vec2;
  readonly stamp: string;
}

/** Plain data (structuredClone-safe) so the test API can hand it out as an FxSnapshot. */
export type RendererFxSnapshot = Readonly<{
  clock: Readonly<{ nowMs: number }>;
  /** Events seen since page load. */
  events: EventCounts;
  /** The cup plunk while holed, otherwise null. */
  plunk: Readonly<{ elapsedMs: number; stamp: string; done: boolean }> | null;
}>;

export interface Renderer {
  /** Draws one frame. Reads state; never mutates it. */
  draw(course: Course, state: Readonly<GameState>, aim: Shot | null, frame: FrameInput): void;
  clientToWorld(clientX: number, clientY: number): Vec2;
  worldToClient(p: Vec2): Vec2;
  fxSnapshot(): RendererFxSnapshot;
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: readonly Vec2[]): void {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

function drawAim(ctx: CanvasRenderingContext2D, from: Vec2, aim: Shot): void {
  const len = 30 + aim.power * 130;
  const dx = Math.cos(aim.angle);
  const dy = Math.sin(aim.angle);
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(from.x + dx * len, from.y + dy * len);
  for (const style of aimStrokeStyles(aim.power)) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawBall(ctx: CanvasRenderingContext2D, pos: Vec2, radius: number): void {
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.ball;
  ctx.fill();
  ctx.strokeStyle = COLORS.ballOutline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Pole and pennant are outlined because on their own they nearly vanish on ice and rough.
function drawFlag(ctx: CanvasRenderingContext2D, cup: Vec2, lift: number): void {
  const flag = flagGeometry(cup, lift);
  ctx.beginPath();
  ctx.moveTo(flag.poleBottom.x, flag.poleBottom.y);
  ctx.lineTo(flag.poleTop.x, flag.poleTop.y);
  ctx.strokeStyle = COLORS.aimOutline;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = COLORS.flagPole;
  ctx.lineWidth = 2;
  ctx.stroke();
  tracePolygon(ctx, flag.pennant);
  ctx.strokeStyle = COLORS.aimOutline;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = COLORS.flag;
  ctx.fill();
}

function drawRipple(ctx: CanvasRenderingContext2D, cup: Vec2, f: PlunkFrame): void {
  ctx.save();
  ctx.globalAlpha = f.rippleAlpha;
  ctx.beginPath();
  ctx.arc(cup.x, cup.y, f.rippleRadius, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, at: Vec2, text: string, scale: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(scale, scale);
  ctx.font = STAMP_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = COLORS.aimOutline;
  ctx.lineWidth = STAMP_OUTLINE_WIDTH;
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  let nowMs = 0;
  let eventCounts = ZERO_COUNTS;
  // The drop is detected from what the renderer saw last frame, so the game emits nothing extra.
  let prevBallPos: Vec2 | null = null;
  let plunk: Plunk | null = null;

  // Keep the backing store matched to the canvas's CSS size × device pixel ratio, so drawing is
  // crisp and the view fits what's on screen. A ResizeObserver catches every layout change
  // (HUD insertion, rotation, window resize); the dpr check catches moving between screens.
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  };
  resize();
  new ResizeObserver(resize).observe(canvas);

  return {
    draw(course, state, aim, frame) {
      nowMs = frame.nowMs;
      eventCounts = countEvents(eventCounts, frame.events);
      if ((window.devicePixelRatio || 1) !== dpr) resize();
      const { hole } = course;
      view = fitView(cssWidth, cssHeight, hole.size, PADDING);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.setTransform(
        dpr * view.scale,
        0,
        0,
        dpr * view.scale,
        dpr * view.offsetX,
        dpr * view.offsetY,
      );

      tracePolygon(ctx, hole.boundary);
      ctx.fillStyle = TERRAIN_COLORS[hole.terrain.base];
      ctx.fill();
      for (const zone of hole.terrain.zones) {
        tracePolygon(ctx, zone.polygon);
        ctx.fillStyle = TERRAIN_COLORS[zone.kind];
        ctx.fill();
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = COLORS.wall;
      ctx.lineWidth = WALL_WIDTH;
      for (const seg of course.segments) {
        ctx.beginPath();
        ctx.moveTo(seg.a.x, seg.a.y);
        ctx.lineTo(seg.b.x, seg.b.y);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(course.cup.x, course.cup.y, course.cupRadius, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.cup;
      ctx.fill();
      ctx.strokeStyle = COLORS.cupRim;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (state.phase !== 'holed') {
        plunk = null;
        prevBallPos = state.ball.pos;
      } else {
        // stepBall snaps a holed ball to the cup, so slide from where it was last frame.
        plunk ??= {
          startMs: nowMs,
          from: plunkSlideStart(prevBallPos ?? course.cup, course.cup),
          stamp: stampText(scoreName(state.strokes, hole.par)),
        };
      }

      if (!plunk) {
        drawFlag(ctx, course.cup, 0);
        const { pos } = state.ball;
        if (aim && state.phase === 'aiming') drawAim(ctx, pos, aim);
        drawBall(ctx, pos, BALL_RADIUS);
        return;
      }

      const f = plunkFrame(nowMs - plunk.startMs);
      if (!f.done) drawRipple(ctx, course.cup, f);
      drawFlag(ctx, course.cup, f.flagLift);
      if (f.ballVisible) {
        const pos = {
          x: lerp(plunk.from.x, course.cup.x, f.ballT),
          y: lerp(plunk.from.y, course.cup.y, f.ballT),
        };
        drawBall(ctx, pos, BALL_RADIUS * f.ballScale);
      }
      drawStamp(ctx, stampAnchor(course.cup, hole.size), plunk.stamp, f.stampScale);
    },
    clientToWorld(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return screenToWorld(view, { x: clientX - rect.left, y: clientY - rect.top });
    },
    worldToClient(p) {
      const rect = canvas.getBoundingClientRect();
      const s = worldToScreen(view, p);
      return { x: s.x + rect.left, y: s.y + rect.top };
    },
    fxSnapshot: () => ({
      clock: { nowMs },
      events: eventCounts,
      plunk: plunk
        ? {
            elapsedMs: nowMs - plunk.startMs,
            stamp: plunk.stamp,
            done: plunkFrame(nowMs - plunk.startMs).done,
          }
        : null,
    }),
  };
}
