import { describe, expect, it } from 'vitest';
import { add, dot, length, scale, sub, vec2 } from '../../../../src/core/math/vec2.ts';

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

  it('never mutates its inputs', () => {
    const a = Object.freeze(vec2(1, 2));
    const b = Object.freeze(vec2(3, 4));
    expect(() => [add(a, b), sub(a, b), scale(a, 2), dot(a, b), length(a)]).not.toThrow();
  });
});
