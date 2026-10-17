/**
 * Deterministic sin/cos (ADR 0001). ECMAScript lets engines approximate Math.sin/cos, so results
 * may differ between browsers. These use only + − × ÷ and Math.round, which IEEE 754 defines
 * exactly, so every engine produces bit-identical output.
 *
 * Range reduction: Cody–Waite with a two-part π/2. Kernels: the fdlibm minimax polynomials on
 * [−π/4, π/4]. Accurate to ~1 ulp for the angles a game uses (|x| < 1e5).
 */
import type { Vec2 } from './vec2.ts';

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_HI = 1.57079632673412561417; // first 33 bits of π/2, so k * PIO2_HI is exact
const PIO2_LO = 6.07710050650619224932e-11; // π/2 − PIO2_HI

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(r: number): number {
  const z = r * r;
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

function kernelCos(r: number): number {
  const z = r * r;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

/** Reduces x to r ∈ [−π/4, π/4] and the quadrant q ∈ {0,1,2,3} with x = r + q·π/2 (mod 2π). */
function reduce(x: number): { r: number; q: number } {
  const k = Math.round(x * INV_PIO2);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  return { r, q: ((k % 4) + 4) % 4 };
}

export function sin(x: number): number {
  if (x === 0) return x; // keeps the sign of ±0
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return kernelSin(r);
    case 1:
      return kernelCos(r);
    case 2:
      return -kernelSin(r);
    default:
      return -kernelCos(r);
  }
}

export function cos(x: number): number {
  const { r, q } = reduce(x);
  switch (q) {
    case 0:
      return kernelCos(r);
    case 1:
      return -kernelSin(r);
    case 2:
      return -kernelCos(r);
    default:
      return kernelSin(r);
  }
}

/** Unit vector for an angle. 0 = +x; π/2 = +y, which points down the screen. */
export function direction(angle: number): Vec2 {
  return { x: cos(angle), y: sin(angle) };
}
