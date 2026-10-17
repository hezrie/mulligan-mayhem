import { z } from 'zod';
import { distanceToSegment, pointInPolygon, polygonEdges, type Segment } from '../math/geometry.ts';
import { BALL_RADIUS, CUP_RADIUS } from '../physics/constants.ts';
import { TERRAIN_KINDS } from '../physics/terrain.ts';

const Vec2Schema = z.strictObject({ x: z.number(), y: z.number() });

const SegmentSchema = z
  .strictObject({ a: Vec2Schema, b: Vec2Schema })
  .refine((s) => s.a.x !== s.b.x || s.a.y !== s.b.y, 'wall has zero length');

const TerrainKindSchema = z.enum(TERRAIN_KINDS);

/** A hole is pure data. See docs/ARCHITECTURE.md ("Hole schema") for field meanings. */
export const HoleSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be kebab-case'),
    name: z.string().min(1),
    par: z.int().min(1).max(6),
    size: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
    boundary: z.array(Vec2Schema).min(3),
    walls: z.array(SegmentSchema).default([]),
    tee: Vec2Schema,
    cup: z.strictObject({ x: z.number(), y: z.number(), radius: z.number().positive().optional() }),
    terrain: z
      .strictObject({
        base: TerrainKindSchema,
        zones: z
          .array(z.strictObject({ kind: TerrainKindSchema, polygon: z.array(Vec2Schema).min(3) }))
          .default([]),
      })
      .default({ base: 'fairway', zones: [] }),
  })
  .superRefine((hole, ctx) => {
    const segments: Segment[] = [...polygonEdges(hole.boundary), ...hole.walls];
    const radius = hole.cup.radius ?? CUP_RADIUS;
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    const allPoints = [...hole.boundary, ...hole.walls.flatMap((w) => [w.a, w.b])];
    if (
      allPoints.some((p) => p.x < 0 || p.y < 0 || p.x > hole.size.width || p.y > hole.size.height)
    ) {
      issue('size', 'boundary and walls must lie within size');
    }
    if (!pointInPolygon(hole.tee, hole.boundary)) issue('tee', 'tee must be inside the boundary');
    if (segments.some((s) => distanceToSegment(hole.tee, s) <= BALL_RADIUS)) {
      issue('tee', 'tee must be clear of every wall by more than the ball radius');
    }
    if (!pointInPolygon(hole.cup, hole.boundary)) issue('cup', 'cup must be inside the boundary');
    if (segments.some((s) => distanceToSegment(hole.cup, s) < Math.max(BALL_RADIUS, radius))) {
      issue('cup', 'cup must be clear of every wall so the ball can reach it');
    }
  });

export type Hole = z.infer<typeof HoleSchema>;

export class HoleValidationError extends Error {
  override readonly name = 'HoleValidationError';
}

/** Validates unknown data as a hole. Throws HoleValidationError listing every problem. */
export function parseHole(data: unknown): Hole {
  const result = HoleSchema.safeParse(data);
  if (result.success) return result.data;
  const id =
    typeof data === 'object' && data !== null && 'id' in data ? String(data.id) : '(no id)';
  const details = result.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new HoleValidationError(`Invalid hole "${id}":\n${details}`);
}
