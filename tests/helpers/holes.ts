import { compileCourse, type Course } from '../../src/core/course/course.ts';
import { parseHole, type Hole } from '../../src/core/course/schema.ts';

/** A valid open rectangular hole; override any field to build test fixtures. */
export function makeHole(overrides: Record<string, unknown> = {}): Hole {
  return parseHole({
    id: 'test-box',
    name: 'Test Box',
    par: 2,
    size: { width: 400, height: 400 },
    boundary: [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 400 },
      { x: 0, y: 400 },
    ],
    walls: [],
    tee: { x: 200, y: 350 },
    cup: { x: 200, y: 50 },
    ...overrides,
  });
}

export function makeCourse(overrides: Record<string, unknown> = {}): Course {
  return compileCourse(makeHole(overrides));
}
