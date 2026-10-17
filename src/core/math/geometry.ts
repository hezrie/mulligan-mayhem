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
