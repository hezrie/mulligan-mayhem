import { add, dot, distance, lengthSq, scale, sub, type Vec2 } from './vec2.ts';

export interface Segment {
  readonly a: Vec2;
  readonly b: Vec2;
}

export function closestPointOnSegment(p: Vec2, seg: Segment): Vec2 {
  const ab = sub(seg.b, seg.a);
  const lenSq = lengthSq(ab);
  if (lenSq === 0) return seg.a;
  const t = Math.min(1, Math.max(0, dot(sub(p, seg.a), ab) / lenSq));
  return add(seg.a, scale(ab, t));
}

export function distanceToSegment(p: Vec2, seg: Segment): number {
  return distance(p, closestPointOnSegment(p, seg));
}

/** Shortest distance between two segments; exactly 0 when they cross, touch or overlap. */
export function distanceBetweenSegments(s1: Segment, s2: Segment): number {
  if (segmentsTouch(s1, s2)) return 0;
  // Disjoint segments are closest at an end-point of one of them.
  return Math.min(
    distanceToSegment(s1.a, s2),
    distanceToSegment(s1.b, s2),
    distanceToSegment(s2.a, s1),
    distanceToSegment(s2.b, s1),
  );
}

/** Sign of the turn p → q → r: positive, negative, or 0 when collinear. Exact for integer input. */
function orientation(p: Vec2, q: Vec2, r: Vec2): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

/** For a point already known to be collinear with seg: is it within the segment's bounds? */
function withinBounds(p: Vec2, seg: Segment): boolean {
  return (
    p.x >= Math.min(seg.a.x, seg.b.x) &&
    p.x <= Math.max(seg.a.x, seg.b.x) &&
    p.y >= Math.min(seg.a.y, seg.b.y) &&
    p.y <= Math.max(seg.a.y, seg.b.y)
  );
}

function oppositeSides(o1: number, o2: number): boolean {
  return (o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0);
}

function segmentsTouch(s1: Segment, s2: Segment): boolean {
  const o1 = orientation(s1.a, s1.b, s2.a);
  const o2 = orientation(s1.a, s1.b, s2.b);
  const o3 = orientation(s2.a, s2.b, s1.a);
  const o4 = orientation(s2.a, s2.b, s1.b);
  if (oppositeSides(o1, o2) && oppositeSides(o3, o4)) return true;
  return (
    (o1 === 0 && withinBounds(s2.a, s1)) ||
    (o2 === 0 && withinBounds(s2.b, s1)) ||
    (o3 === 0 && withinBounds(s1.a, s2)) ||
    (o4 === 0 && withinBounds(s1.b, s2))
  );
}

/** Even-odd ray casting. Works for concave polygons and either winding order. */
export function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (!a || !b) continue;
    const crosses = a.y > p.y !== b.y > p.y;
    if (crosses && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Edges of a closed polygon, including the closing edge from the last point back to the first. */
export function polygonEdges(polygon: readonly Vec2[]): Segment[] {
  return polygon.flatMap((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return b ? [{ a, b }] : [];
  });
}
