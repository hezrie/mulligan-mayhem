import type { Course } from '../core/course/course.ts';
import type { GameState } from '../core/game/state.ts';
import type { Shot } from '../core/game/shot.ts';
import type { Vec2 } from '../core/math/vec2.ts';
import { BALL_RADIUS } from '../core/physics/constants.ts';
import { aimStrokeStyles } from './aim.ts';
import { countEvents, ZERO_COUNTS, type EventCounts, type FrameInput } from './fx-frame.ts';
import { COLORS, TERRAIN_COLORS } from './palette.ts';
import { fitView, screenToWorld, worldToScreen, type View } from './view.ts';

const PADDING = 16;
const WALL_WIDTH = 4;

/** Plain data (structuredClone-safe) so the test API can hand it out as an FxSnapshot. */
export type RendererFxSnapshot = Readonly<{
  clock: Readonly<{ nowMs: number }>;
  /** Events seen since page load. */
  events: EventCounts;
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

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let view: View = { scale: 1, offsetX: 0, offsetY: 0 };
  let nowMs = 0;
  let eventCounts = ZERO_COUNTS;

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
        const { pos } = state.ball;
        if (aim && state.phase === 'aiming') drawAim(ctx, pos, aim);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.ball;
        ctx.fill();
        ctx.strokeStyle = COLORS.ballOutline;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
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
    fxSnapshot: () => ({ clock: { nowMs }, events: eventCounts }),
  };
}
