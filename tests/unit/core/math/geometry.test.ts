import { describe, expect, it } from 'vitest';
import {
  closestPointOnSegment,
  distanceToSegment,
  pointInPolygon,
  polygonEdges,
} from '../../../../src/core/math/geometry.ts';
import { vec2 } from '../../../../src/core/math/vec2.ts';

const seg = { a: vec2(0, 0), b: vec2(10, 0) };

describe('closestPointOnSegment', () => {
  it('projects onto the interior of the segment', () => {
    expect(closestPointOnSegment(vec2(4, 7), seg)).toEqual({ x: 4, y: 0 });
  });

  it('clamps to the end-points', () => {
    expect(closestPointOnSegment(vec2(-3, 2), seg)).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment(vec2(15, -2), seg)).toEqual({ x: 10, y: 0 });
  });

  it('handles a degenerate (zero-length) segment', () => {
    const point = { a: vec2(2, 2), b: vec2(2, 2) };
    expect(closestPointOnSegment(vec2(5, 6), point)).toEqual({ x: 2, y: 2 });
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular and end-point distances', () => {
    expect(distanceToSegment(vec2(5, 3), seg)).toBe(3);
    expect(distanceToSegment(vec2(13, 4), seg)).toBe(5);
  });
});

describe('pointInPolygon', () => {
  const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)];
  const lShape = [vec2(0, 0), vec2(4, 0), vec2(4, 6), vec2(10, 6), vec2(10, 10), vec2(0, 10)];

  it('detects inside and outside points', () => {
    expect(pointInPolygon(vec2(5, 5), square)).toBe(true);
    expect(pointInPolygon(vec2(11, 5), square)).toBe(false);
    expect(pointInPolygon(vec2(-1, -1), square)).toBe(false);
  });

  it('handles concave polygons', () => {
    expect(pointInPolygon(vec2(2, 2), lShape)).toBe(true);
    expect(pointInPolygon(vec2(8, 2), lShape)).toBe(false);
    expect(pointInPolygon(vec2(8, 8), lShape)).toBe(true);
  });

  it('does not depend on winding order', () => {
    expect(pointInPolygon(vec2(5, 5), [...square].reverse())).toBe(true);
  });
});

describe('polygonEdges', () => {
  it('returns the closed loop of edges', () => {
    const tri = [vec2(0, 0), vec2(1, 0), vec2(0, 1)];
    expect(polygonEdges(tri)).toEqual([
      { a: tri[0], b: tri[1] },
      { a: tri[1], b: tri[2] },
      { a: tri[2], b: tri[0] },
    ]);
  });
});
