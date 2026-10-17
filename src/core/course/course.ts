import { pointInPolygon, polygonEdges, type Segment } from '../math/geometry.ts';
import type { Vec2 } from '../math/vec2.ts';
import { CUP_RADIUS } from '../physics/constants.ts';
import type { TerrainKind } from '../physics/terrain.ts';
import type { Hole } from './schema.ts';

/** A hole prepared for simulation: collision segments and resolved defaults. Never mutated. */
export interface Course {
  readonly hole: Hole;
  readonly segments: readonly Segment[];
  readonly cup: Vec2;
  readonly cupRadius: number;
}

export function compileCourse(hole: Hole): Course {
  return {
    hole,
    segments: [...polygonEdges(hole.boundary), ...hole.walls],
    cup: { x: hole.cup.x, y: hole.cup.y },
    cupRadius: hole.cup.radius ?? CUP_RADIUS,
  };
}

/** Index of the last terrain zone containing the point, or -1 if none (base terrain). */
export function zoneIndexAt(course: Course, p: Vec2): number {
  const zones = course.hole.terrain.zones;
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    if (zone && pointInPolygon(p, zone.polygon)) return i;
  }
  return -1;
}

export function terrainAt(course: Course, p: Vec2): TerrainKind {
  const index = zoneIndexAt(course, p);
  return course.hole.terrain.zones[index]?.kind ?? course.hole.terrain.base;
}
