/**
 * Easing curves shared by every juice effect, so the plunk, aim ring and callouts all move on
 * exactly the same curves. Pure maths: every easing clamps t to [0, 1] and hits 0 and 1 exactly.
 */

/** Overshoot amount for easeOutBack (the standard ~10% overshoot). */
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

export function easeOutCubic(t: number): number {
  const u = clamp01(t) - 1;
  return 1 + u * u * u;
}

export function easeOutBack(t: number): number {
  const x = clamp01(t);
  // The polynomial only cancels to 0 at x = 0 up to rounding, so pin the start explicitly.
  if (x === 0) return 0;
  const u = x - 1;
  return 1 + BACK_C3 * u * u * u + BACK_C1 * u * u;
}
