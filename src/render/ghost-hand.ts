import type { Shot } from '../core/game/shot.ts';
import type { GamePhase } from '../core/game/state.ts';
import { normalize, sub, type Vec2 } from '../core/math/vec2.ts';
import { COLORS } from './palette.ts';

/** One full demo: fade in, drag back, hold, release and fade out. */
export const GHOST_HAND_LOOP_MS = 2400;
/** How far back from the ball the hand drags, in world units. */
export const GHOST_HAND_DRAG = 110;
const FADE_IN_END_MS = 300;
const DRAG_END_MS = 1500;
const HOLD_END_MS = 1900;
const FINGERTIP_RADIUS = 14;
/** The press ring reads as "finger is down" without hiding the ball underneath. */
const PRESS_RING_RADIUS = 20;
const PRESS_RING_WIDTH = 2;
/** Even fully faded in, the hand stays slightly see-through so it reads as a hint, not an object. */
const GHOST_ALPHA = 0.9;
/** With the ball on the cup there is no "away from the cup", so drag straight down the screen. */
const FALLBACK_DIR: Vec2 = { x: 0, y: 1 };

export type GhostHandPose = Readonly<{ pos: Vec2; alpha: number; pressed: boolean }>;

/** The slice of the 2D context the hand needs, so tests can record it with a plain object. */
export type GhostHandContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'globalAlpha'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
>;

/** Where the demo hand is at tMs: it drags from the ball directly away from the cup, on a loop. */
export function ghostHandPose(ball: Vec2, cup: Vec2, tMs: number): GhostHandPose {
  const t = ((tMs % GHOST_HAND_LOOP_MS) + GHOST_HAND_LOOP_MS) % GHOST_HAND_LOOP_MS;
  const away = normalize(sub(ball, cup));
  const dir = away.x === 0 && away.y === 0 ? FALLBACK_DIR : away;
  const dragT = Math.min(Math.max((t - FADE_IN_END_MS) / (DRAG_END_MS - FADE_IN_END_MS), 0), 1);
  const d = GHOST_HAND_DRAG * dragT;
  const pos = { x: ball.x + dir.x * d, y: ball.y + dir.y * d };
  const alpha =
    t < FADE_IN_END_MS
      ? t / FADE_IN_END_MS
      : t < HOLD_END_MS
        ? 1
        : 1 - (t - HOLD_END_MS) / (GHOST_HAND_LOOP_MS - HOLD_END_MS);
  return { pos, alpha, pressed: t >= FADE_IN_END_MS && t < HOLD_END_MS };
}

/** Only an idle aiming ball gets the demo; a real drag or a moving ball hides it. */
export function shouldDrawGhostHand(
  phase: GamePhase,
  aim: Shot | null,
  hint: Readonly<{ tMs: number }> | null,
): boolean {
  return phase === 'aiming' && aim === null && hint !== null;
}

/** Draws in world space: a fingertip disc, plus a ring while the finger is pressed. */
export function drawGhostHand(ctx: GhostHandContext, pose: GhostHandPose): void {
  if (pose.alpha <= 0) return;
  const { x, y } = pose.pos;
  ctx.save();
  ctx.globalAlpha = GHOST_ALPHA * pose.alpha;
  ctx.beginPath();
  ctx.arc(x, y, FINGERTIP_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.ghostHand;
  ctx.fill();
  ctx.strokeStyle = COLORS.ballOutline;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (pose.pressed) {
    ctx.beginPath();
    ctx.arc(x, y, PRESS_RING_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.ghostHand;
    ctx.lineWidth = PRESS_RING_WIDTH;
    ctx.stroke();
  }
  ctx.restore();
}
