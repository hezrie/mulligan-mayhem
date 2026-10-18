/**
 * Timeline and geometry for the cup plunk: the ball drops, a ripple spreads, the flag hops and the
 * score stamp slams down. Pure maths of elapsed milliseconds, so the renderer only has to draw it.
 */
import type { ScoreName } from '../core/scoring/score.ts';
import { distance, type Vec2 } from '../core/math/vec2.ts';
import { clamp01, easeInCubic, easeOutBack, easeOutCubic, lerp } from './easing.ts';

/** How long the ball takes to shrink into the cup. */
export const PLUNK_BALL_MS = 220;
/** The ripple is the longest part, so it decides when the whole plunk is done. */
export const PLUNK_RIPPLE_MS = 450;
export const PLUNK_FLAG_MS = 300;
export const PLUNK_STAMP_MS = 300;
/** Ball scale at the bottom of the drop, just before it disappears. */
export const PLUNK_BALL_END_SCALE = 0.4;
export const RIPPLE_FROM = 10;
export const RIPPLE_TO = 30;
/** Peak height of the flag's hop, in world units. */
export const FLAG_HOP = 6;
export const FLAG_POLE = 30;
/** The stamp starts oversized and lands at scale 1 with a small overshoot. */
export const STAMP_FROM = 1.8;
/** Farther than this the previous position is stale (e.g. the tee), so slide from the cup. */
export const SLIDE_MAX = 40;

const PENNANT_WIDTH = 14;
const PENNANT_HEIGHT = 10;
/** Keeps the widest stamp text inside the hole horizontally. */
const STAMP_EDGE_X = 80;
const STAMP_ABOVE_CUP = 50;
const STAMP_MIN_Y = 24;

export interface PlunkFrame {
  readonly ballT: number;
  readonly ballScale: number;
  readonly ballVisible: boolean;
  readonly rippleRadius: number;
  readonly rippleAlpha: number;
  readonly flagLift: number;
  readonly stampScale: number;
  readonly done: boolean;
}

export interface FlagGeometry {
  readonly poleBottom: Vec2;
  readonly poleTop: Vec2;
  readonly pennant: readonly [Vec2, Vec2, Vec2];
}

export interface HoleSize {
  readonly width: number;
  readonly height: number;
}

export function plunkFrame(elapsedMs: number): PlunkFrame {
  const e = elapsedMs;
  const ballT = easeInCubic(e / PLUNK_BALL_MS);
  const u = clamp01(e / PLUNK_FLAG_MS);
  return {
    ballT,
    ballScale: lerp(1, PLUNK_BALL_END_SCALE, ballT),
    ballVisible: e < PLUNK_BALL_MS,
    rippleRadius: lerp(RIPPLE_FROM, RIPPLE_TO, easeOutCubic(e / PLUNK_RIPPLE_MS)),
    rippleAlpha: 1 - clamp01(e / PLUNK_RIPPLE_MS),
    // A parabola that peaks at FLAG_HOP halfway through and lands back at 0.
    flagLift: FLAG_HOP * 4 * u * (1 - u),
    stampScale: lerp(STAMP_FROM, 1, easeOutBack(e / PLUNK_STAMP_MS)),
    done: e >= PLUNK_RIPPLE_MS,
  };
}

const STAMP_TEXT: Readonly<Record<ScoreName, string>> = {
  'hole-in-one': 'HOLE IN ONE!',
  eagle: 'EAGLE!',
  birdie: 'BIRDIE!',
  par: 'PAR',
  bogey: 'BOGEY',
  'double-bogey': 'DOUBLE BOGEY+',
};

export function stampText(name: ScoreName): string {
  return STAMP_TEXT[name];
}

export function stampAnchor(cup: Vec2, size: HoleSize): Vec2 {
  const maxX = size.width - STAMP_EDGE_X;
  const x = cup.x < STAMP_EDGE_X ? STAMP_EDGE_X : cup.x > maxX ? maxX : cup.x;
  return { x, y: Math.max(cup.y - STAMP_ABOVE_CUP, STAMP_MIN_Y) };
}

export function flagGeometry(cup: Vec2, lift: number): FlagGeometry {
  const bottomY = cup.y - lift;
  const topY = bottomY - FLAG_POLE;
  return {
    poleBottom: { x: cup.x, y: bottomY },
    poleTop: { x: cup.x, y: topY },
    pennant: [
      { x: cup.x, y: topY },
      { x: cup.x + PENNANT_WIDTH, y: topY + PENNANT_HEIGHT / 2 },
      { x: cup.x, y: topY + PENNANT_HEIGHT },
    ],
  };
}

export function plunkSlideStart(prevPos: Vec2, cup: Vec2): Vec2 {
  return distance(prevPos, cup) <= SLIDE_MAX ? prevPos : cup;
}
