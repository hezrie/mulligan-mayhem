import type { Course } from '../core/course/course.ts';
import type { GameState } from '../core/game/state.ts';
import type { Shot } from '../core/game/shot.ts';
import { length, type Vec2 } from '../core/math/vec2.ts';
import { BALL_RADIUS } from '../core/physics/constants.ts';
import { Rng } from '../core/rng.ts';
import { scoreName } from '../core/scoring/score.ts';
import { aimStrokeStyles, aimVisual, bandEnd, ringTicks, type AimVisual } from './aim.ts';
import { lerp } from './easing.ts';
import {
  addTrauma,
  ballScale,
  decayTrauma,
  shakeAmplitude,
  shakeOffset,
  type BallScale,
} from './impact.ts';
import { drawGhostHand, ghostHandPose, shouldDrawGhostHand } from './ghost-hand.ts';
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
const CANCEL_TEXT = 'Release to cancel';
const CANCEL_FONT = 'bold 12px sans-serif';
/** Below the ball, clear of the power ring. */
const CANCEL_TEXT_OFFSET = 30;
const TICK_WIDTH = 2;
/** Frame gaps longer than this (tab switch, breakpoint) decay trauma as if only this much passed. */
const MAX_TRAUMA_DT_MS = 100;
/** The shake jitter has its own fixed seed, so the simulation's rng is never touched. */
const SHAKE_SEED = 0x5eed;
/** Drop-shadow offset in world units: light from the upper left. */
const SHADOW_OFFSET: Vec2 = { x: 2, y: 3 };
const AT_REST: BallScale = { along: 1, across: 1 };

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
  /** The aim drawn in the last frame, or null when there was none. */
  aim: AimVisual | null;
  /** Shake trauma, the shake amplitude this frame (CSS px), and the ball's stretch along its motion. */
  impact: Readonly<{ trauma: number; shakePx: number; ballAlong: number }>;
}>;

export interface Renderer {
  /**
   * Draws one frame. Reads state; never mutates it. A non-null hint shows the ghost-hand demo at
   * hint.tMs while the ball waits to be aimed.
   */
  draw(
    course: Course,
    state: Readonly<GameState>,
    aim: Shot | null,
    frame: FrameInput,
    hint?: Readonly<{ tMs: number }> | null,
  ): void;
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

/** A line with a dark outline 2 units wider underneath, so it reads on every terrain. */
function strokeOutlined(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  color: string,
  width: number,
): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = COLORS.aimOutline;
  ctx.lineWidth = width + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawBand(ctx: CanvasRenderingContext2D, ball: Vec2, aim: Shot, visual: AimVisual): void {
  ctx.lineCap = 'round';
  strokeOutlined(ctx, ball, bandEnd(ball, aim), visual.color, visual.bandWidth);
}

function drawRing(ctx: CanvasRenderingContext2D, ball: Vec2, visual: AimVisual): void {
  for (const tick of ringTicks(ball, visual)) {
    strokeOutlined(ctx, tick.from, tick.to, tick.color, TICK_WIDTH);
  }
}

function drawCancelHint(ctx: CanvasRenderingContext2D, ball: Vec2): void {
  const y = ball.y + CANCEL_TEXT_OFFSET;
  ctx.font = CANCEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = COLORS.aimOutline;
  ctx.lineWidth = STAMP_OUTLINE_WIDTH;
  ctx.strokeText(CANCEL_TEXT, ball.x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(CANCEL_TEXT, ball.x, y);
}

function drawShadow(ctx: CanvasRenderingContext2D, pos: Vec2): void {
  ctx.beginPath();
  ctx.arc(pos.x + SHADOW_OFFSET.x, pos.y + SHADOW_OFFSET.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.wallShadow;
  ctx.fill();
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  pos: Vec2,
  radius: number,
  vel: Vec2 = { x: 0, y: 0 },
  shape: BallScale = AT_REST,
): void {
  ctx.beginPath();
  const rotation = Math.atan2(vel.y, vel.x);
  ctx.ellipse(pos.x, pos.y, radius * shape.along, radius * shape.across, rotation, 0, Math.PI * 2);
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
  let lastAim: AimVisual | null = null;
  const shakeRng = new Rng(SHAKE_SEED);
  let trauma = 0;
  let shakePx = 0;
  let lastWallHitMs = -Infinity;
  let ballAlong = 1;

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
    draw(course, state, aim, frame, hint = null) {
      // Decay before adding, so the frame that receives a hit shows its full trauma.
      const dtMs = Math.max(0, Math.min(frame.nowMs - nowMs, MAX_TRAUMA_DT_MS));
      trauma = decayTrauma(trauma, dtMs / 1000);
      nowMs = frame.nowMs;
      for (const e of frame.events) {
        if (e.type === 'bounce' && e.impulse > 0) {
          trauma = addTrauma(trauma, e.impulse);
          lastWallHitMs = nowMs;
        }
      }
      eventCounts = countEvents(eventCounts, frame.events);
      if ((window.devicePixelRatio || 1) !== dpr) resize();
      const { hole } = course;
      view = fitView(cssWidth, cssHeight, hole.size, PADDING);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      // Only the drawing shakes; `view` stays unshaken so pointer mapping never jitters.
      const shake = shakeOffset(state.phase, trauma, shakeRng);
      shakePx = state.phase === 'rolling' || state.phase === 'holed' ? shakeAmplitude(trauma) : 0;
      ctx.setTransform(
        dpr * view.scale,
        0,
        0,
        dpr * view.scale,
        dpr * (view.offsetX + shake.x),
        dpr * (view.offsetY + shake.y),
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

      lastAim = null;
      if (!plunk) {
        drawFlag(ctx, course.cup, 0);
        const { pos } = state.ball;
        const shown = aim && state.phase === 'aiming' ? aim : null;
        const visual = shown ? aimVisual(shown) : null;
        if (shown && visual) {
          if (!visual.cancel) drawAim(ctx, pos, shown);
          drawBand(ctx, pos, shown, visual);
        }
        const { vel } = state.ball;
        const shape = ballScale(length(vel), nowMs - lastWallHitMs);
        ballAlong = shape.along;
        drawShadow(ctx, pos);
        drawBall(ctx, pos, BALL_RADIUS, vel, shape);
        if (visual) {
          drawRing(ctx, pos, visual);
          if (visual.cancel) drawCancelHint(ctx, pos);
        }
        if (hint && shouldDrawGhostHand(state.phase, aim, hint)) {
          drawGhostHand(ctx, ghostHandPose(pos, course.cup, hint.tMs));
        }
        lastAim = visual;
        return;
      }

      ballAlong = 1;
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
      aim: lastAim,
      impact: { trauma, shakePx, ballAlong },
    }),
  };
}
