import { describe, expect, it } from 'vitest';
import { contactCircleSegment, resolveContact } from '../../../../src/core/physics/collision.ts';
import { length, vec2 } from '../../../../src/core/math/vec2.ts';

const floor = { a: vec2(0, 100), b: vec2(200, 100) };

describe('contactCircleSegment', () => {
  it('reports no contact when the circle is clear of the segment', () => {
    expect(contactCircleSegment(vec2(50, 90), 6, floor)).toBeNull();
    expect(contactCircleSegment(vec2(50, 94), 6, floor)).toBeNull(); // exactly touching
  });

  it('reports the normal (pointing at the circle) and penetration depth', () => {
    expect(contactCircleSegment(vec2(50, 96), 6, floor)).toEqual({
      normal: { x: 0, y: -1 },
      depth: 2,
    });
    expect(contactCircleSegment(vec2(50, 103), 6, floor)).toEqual({
      normal: { x: 0, y: 1 },
      depth: 3,
    });
  });

  it('treats end-points as round corners', () => {
    const c = contactCircleSegment(vec2(203, 104), 6, floor);
    expect(c?.normal.x).toBeCloseTo(0.6, 12);
    expect(c?.normal.y).toBeCloseTo(0.8, 12);
    expect(c?.depth).toBeCloseTo(1, 12);
  });

  it('falls back to the segment normal when the centre lies exactly on the segment', () => {
    const c = contactCircleSegment(vec2(50, 100), 6, floor);
    expect(c?.depth).toBe(6);
    expect(Math.abs(c?.normal.y ?? 0)).toBe(1);
  });
});

describe('resolveContact', () => {
  it('pushes the ball out and reflects the normal velocity with restitution', () => {
    const r = resolveContact(vec2(50, 96), vec2(30, 40), { normal: vec2(0, -1), depth: 2 }, 0.8, 0);
    expect(r.pos).toEqual({ x: 50, y: 94 });
    expect(r.vel.x).toBe(30);
    expect(r.vel.y).toBeCloseTo(-32, 12);
    expect(r.impulse).toBeCloseTo(72, 12);
  });

  it('applies tangential friction on impact', () => {
    const r = resolveContact(
      vec2(50, 96),
      vec2(100, 10),
      { normal: vec2(0, -1), depth: 1 },
      0.5,
      0.1,
    );
    expect(r.vel.x).toBeCloseTo(90, 12);
    expect(r.vel.y).toBeCloseTo(-5, 12);
  });

  it('only separates (no bounce) when already moving away from the wall', () => {
    const r = resolveContact(
      vec2(50, 96),
      vec2(0, -20),
      { normal: vec2(0, -1), depth: 2 },
      0.8,
      0.1,
    );
    expect(r.vel).toEqual({ x: 0, y: -20 });
    expect(r.impulse).toBe(0);
  });

  it('never increases speed', () => {
    for (const [vx, vy] of [
      [300, 400],
      [-500, 10],
      [0, 800],
      [700, -700],
    ] as const) {
      const v = vec2(vx, vy);
      const r = resolveContact(vec2(0, 0), v, { normal: vec2(0, -1), depth: 1 }, 0.8, 0.05);
      expect(length(r.vel)).toBeLessThanOrEqual(length(v));
    }
  });
});
