/** Immutable 2D vector. All helpers return new vectors and never mutate inputs. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lengthSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

/** Euclidean length. Math.sqrt is correctly rounded by IEEE 754, so it is deterministic. */
export function length(v: Vec2): number {
  return Math.sqrt(lengthSq(v));
}

export function distance(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

/** Unit vector in the same direction; the zero vector maps to zero instead of NaN. */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? ZERO : { x: v.x / len, y: v.y / len };
}

/** Quarter turn toward +y. Screen y points down, so this is clockwise on screen. */
export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}
