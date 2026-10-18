import { MIN_SHOT_POWER, type Shot } from '../core/game/shot.ts';
import { direction } from '../core/math/trig.ts';
import { add, scale, type Vec2 } from '../core/math/vec2.ts';
import { clamp01, lerp } from './easing.ts';
import { COLORS } from './palette.ts';

export type StrokeStyle = Readonly<{ color: string; width: number }>;

/** Above this power the aim line turns from the weak to the strong colour. */
const STRONG_POWER = 0.66;

/**
 * Length of the band at full power. Render cannot import src/input, so this mirrors MAX_DRAG and
 * tests/unit/render/aim.test.ts pins the two together: the band end then sits under the finger.
 */
export const BAND_MAX_LENGTH = 160;

/** The power ring: 10 ticks, one per tenth of power, drawn just outside the ball. */
const RING_TICKS = 10;
const RING_INNER_RADIUS = 22;
const RING_OUTER_RADIUS = 26;
const RING_UNLIT_COLOR = 'rgba(255, 255, 255, 0.35)';

/** Power at which the ramp reaches its middle colour (yellow). */
const POWER_MID_AT = 0.6;

/** Absorbs float error so a power of exactly k/10 lights k ticks even if power · 10 lands a hair below k. */
const TICK_EPSILON = 1e-9;

export type AimVisual = Readonly<{
  cancel: boolean;
  bandWidth: number;
  litTicks: number;
  color: string;
}>;

export type RingTick = Readonly<{ from: Vec2; to: Vec2; color: string }>;

/**
 * Stroke passes for the aim line, drawn in order: a dark outline first, then the coloured line on
 * top, so the line stays readable on light terrain (sand, ice) as well as dark.
 */
export function aimStrokeStyles(power: number): readonly StrokeStyle[] {
  const width = 2 + 3 * power;
  return [
    { color: COLORS.aimOutline, width: width + 2 },
    { color: power > STRONG_POWER ? COLORS.aimStrong : COLORS.aimWeak, width },
  ];
}

/** The band stretches thinner as it is pulled further, like real elastic. */
export function bandWidth(power: number): number {
  return 6 - 4 * clamp01(power);
}

/** The shot points away from the drag, so the band runs backwards from the ball to the finger. */
export function bandEnd(ball: Vec2, shot: Shot): Vec2 {
  return add(ball, scale(direction(shot.angle), -shot.power * BAND_MAX_LENGTH));
}

export function litTicks(power: number): number {
  return Math.floor(clamp01(power) * RING_TICKS + TICK_EPSILON);
}

export function powerColor(power: number): string {
  const t = clamp01(power);
  return t <= POWER_MID_AT
    ? mixHex(COLORS.powerLow, COLORS.powerMid, t / POWER_MID_AT)
    : mixHex(COLORS.powerMid, COLORS.powerHigh, (t - POWER_MID_AT) / (1 - POWER_MID_AT));
}

export function aimVisual(shot: Shot): AimVisual {
  const cancel = shot.power < MIN_SHOT_POWER;
  return {
    cancel,
    bandWidth: bandWidth(shot.power),
    litTicks: litTicks(shot.power),
    color: cancel ? COLORS.aimCancel : powerColor(shot.power),
  };
}

/** Tick 1 points straight up and the rest follow clockwise (screen y points down). */
export function ringTicks(center: Vec2, visual: AimVisual): readonly RingTick[] {
  const ticks: RingTick[] = [];
  for (let i = 1; i <= RING_TICKS; i++) {
    const dir = direction(-Math.PI / 2 + ((i - 1) * 2 * Math.PI) / RING_TICKS);
    ticks.push({
      from: add(center, scale(dir, RING_INNER_RADIUS)),
      to: add(center, scale(dir, RING_OUTER_RADIUS)),
      color: visual.cancel
        ? COLORS.aimCancel
        : i <= visual.litTicks
          ? powerColor(i / RING_TICKS)
          : RING_UNLIT_COLOR,
    });
  }
  return ticks;
}

/** Per-channel lerp between two '#rrggbb' colours, rounded to whole channel values. */
function mixHex(a: string, b: string, t: number): string {
  let out = '#';
  for (let offset = 1; offset < 7; offset += 2) {
    const from = parseInt(a.slice(offset, offset + 2), 16);
    const to = parseInt(b.slice(offset, offset + 2), 16);
    out += Math.round(lerp(from, to, t))
      .toString(16)
      .padStart(2, '0');
  }
  return out;
}
