import { describe, expect, it } from 'vitest';
import {
  add,
  distance,
  dot,
  length,
  lengthSq,
  normalize,
  perp,
  scale,
  sub,
  vec2,
  ZERO,
} from '../../../../src/core/math/vec2.ts';

describe('vec2', () => {
  it('constructs a vector from components', () => {
    expect(vec2(3, -4)).toEqual({ x: 3, y: -4 });
  });

  it('adds and subtracts component-wise', () => {
    expect(add(vec2(1, 2), vec2(3, 4))).toEqual({ x: 4, y: 6 });
    expect(sub(vec2(1, 2), vec2(3, 4))).toEqual({ x: -2, y: -2 });
  });

  it('scales by a scalar', () => {
    expect(scale(vec2(1.5, -2), 2)).toEqual({ x: 3, y: -4 });
  });

  it('computes the dot product', () => {
    expect(dot(vec2(1, 2), vec2(3, 4))).toBe(11);
    expect(dot(vec2(1, 0), vec2(0, 1))).toBe(0);
  });

  it('computes the euclidean length', () => {
    expect(length(vec2(3, 4))).toBe(5);
    expect(length(vec2(0, 0))).toBe(0);
  });

  it('computes squared length and distance', () => {
    expect(lengthSq(vec2(3, 4))).toBe(25);
    expect(distance(vec2(1, 1), vec2(4, 5))).toBe(5);
  });

  it('normalizes to unit length and maps the zero vector to zero', () => {
    expect(normalize(vec2(0, -5))).toEqual({ x: 0, y: -1 });
    expect(length(normalize(vec2(3, 4)))).toBeCloseTo(1, 15);
    expect(normalize(ZERO)).toEqual(ZERO);
  });

  it('rotates a quarter turn with perp (toward +y for +x in screen space)', () => {
    expect(perp(vec2(1, 0))).toEqual({ x: -0, y: 1 });
    expect(dot(perp(vec2(2, 3)), vec2(2, 3))).toBe(0);
  });

  it('never mutates its inputs', () => {
    const a = Object.freeze(vec2(1, 2));
    const b = Object.freeze(vec2(3, 4));
    expect(() => [add(a, b), sub(a, b), scale(a, 2), dot(a, b), length(a)]).not.toThrow();
  });
});
