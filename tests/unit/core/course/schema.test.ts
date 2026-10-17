import { describe, expect, it } from 'vitest';
import { compileCourse, terrainAt, zoneIndexAt } from '../../../../src/core/course/course.ts';
import { HoleValidationError, parseHole } from '../../../../src/core/course/schema.ts';
import { CUP_RADIUS } from '../../../../src/core/physics/constants.ts';
import { vec2 } from '../../../../src/core/math/vec2.ts';
import { makeHole } from '../../../helpers/holes.ts';

describe('parseHole', () => {
  it('applies defaults for walls, terrain and cup radius', () => {
    const hole = makeHole();
    expect(hole.walls).toEqual([]);
    expect(hole.terrain).toEqual({ base: 'fairway', zones: [] });
    expect(compileCourse(hole).cupRadius).toBe(CUP_RADIUS);
  });

  it.each([
    ['a non-kebab id', { id: 'Bad Id' }],
    ['a par outside 1–6', { par: 7 }],
    [
      'a boundary with fewer than 3 points',
      {
        boundary: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ],
    ['an unknown terrain kind', { terrain: { base: 'lava', zones: [] } }],
    ['a tee outside the boundary', { tee: { x: 500, y: 500 } }],
    ['a tee touching a wall', { tee: { x: 2, y: 200 } }],
    ['a cup outside the boundary', { cup: { x: -5, y: 10 } }],
    ['a cup too close to a wall to reach', { cup: { x: 200, y: 3 } }],
    ['a zero-length wall', { walls: [{ a: { x: 9, y: 9 }, b: { x: 9, y: 9 } }] }],
    ['geometry outside the hole size', { size: { width: 100, height: 100 } }],
    ['an unknown field (typo protection)', { colour: 'green' }],
    ['a non-finite coordinate', { tee: { x: Number.NaN, y: 1 } }],
  ])('rejects %s with a readable error', (_label, overrides) => {
    expect(() => makeHole(overrides)).toThrow(HoleValidationError);
  });

  it('names the hole and the failing path in the error message', () => {
    try {
      parseHole({ id: 'broken-hole', par: 9 });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('broken-hole');
      expect(String(error)).toContain('par');
    }
  });
});

describe('compileCourse', () => {
  it('collects boundary edges plus interior walls as collision segments', () => {
    const course = compileCourse(
      makeHole({ walls: [{ a: { x: 10, y: 10 }, b: { x: 50, y: 10 } }] }),
    );
    expect(course.segments).toHaveLength(5);
  });
});

describe('terrainAt', () => {
  const zone = (x0: number, x1: number) => ({
    kind: 'fairway',
    polygon: [vec2(x0, 0), vec2(x1, 0), vec2(x1, 400), vec2(x0, 400)],
  });

  it('returns the base terrain outside every zone', () => {
    const course = compileCourse(makeHole({ terrain: { base: 'fairway', zones: [zone(0, 100)] } }));
    expect(terrainAt(course, vec2(300, 200))).toBe('fairway');
  });

  it('returns the last zone containing the point (later zones paint over earlier ones)', () => {
    const course = compileCourse(
      makeHole({ terrain: { base: 'fairway', zones: [zone(0, 200), zone(100, 300)] } }),
    );
    expect(zoneIndexAt(course, vec2(50, 200))).toBe(0);
    expect(zoneIndexAt(course, vec2(150, 200))).toBe(1);
    expect(zoneIndexAt(course, vec2(350, 200))).toBe(-1);
  });
});
