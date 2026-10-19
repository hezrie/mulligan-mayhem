import { describe, expect, it } from 'vitest';
import { getHole } from '../../../src/core/course/holes/index.ts';
import type { Hole } from '../../../src/core/course/schema.ts';
import { fnv1a64, hashHole, hashValues } from '../../../src/core/hash.ts';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('fnv1a64', () => {
  it('matches published FNV-1a 64-bit test vectors', () => {
    expect(fnv1a64(bytes(''))).toBe('cbf29ce484222325');
    expect(fnv1a64(bytes('a'))).toBe('af63dc4c8601ec8c');
    expect(fnv1a64(bytes('foobar'))).toBe('85944171f73967e8');
  });
});

describe('hashValues', () => {
  it('is stable for identical input', () => {
    expect(hashValues(['skeleton-01', 1.5, 3])).toBe(hashValues(['skeleton-01', 1.5, 3]));
  });

  it('is sensitive to a one-ulp change in a float', () => {
    const x = 0.1 + 0.2;
    const nextUp = x + Number.EPSILON * x;
    expect(nextUp).not.toBe(x);
    expect(hashValues([x])).not.toBe(hashValues([nextUp]));
  });

  it('distinguishes +0 and -0, order, and type', () => {
    expect(hashValues([0])).not.toBe(hashValues([-0]));
    expect(hashValues([1, 2])).not.toBe(hashValues([2, 1]));
    expect(hashValues(['1'])).not.toBe(hashValues([1]));
    expect(hashValues(['ab', 'c'])).not.toBe(hashValues(['a', 'bc']));
  });

  it('returns 16 lowercase hex digits', () => {
    expect(hashValues(['x', 42])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('hashHole', () => {
  const base = getHole('skeleton-01');
  const triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const variants: [string, Hole][] = [
    ['id', { ...base, id: 'other' }],
    ['name', { ...base, name: 'Other' }],
    ['par', { ...base, par: base.par + 1 }],
    ['size', { ...base, size: { ...base.size, width: base.size.width + 1 } }],
    ['boundary', { ...base, boundary: base.boundary.slice(1) }],
    ['walls', { ...base, walls: [] }],
    ['tee', { ...base, tee: { ...base.tee, x: base.tee.x + 1 } }],
    ['cup', { ...base, cup: { ...base.cup, y: base.cup.y + 1 } }],
    ['cup radius', { ...base, cup: { ...base.cup, radius: 12 } }],
    ['terrain base', { ...base, terrain: { ...base.terrain, base: 'rough' } }],
    [
      'terrain zones',
      { ...base, terrain: { base: 'fairway', zones: [{ kind: 'sand', polygon: triangle }] } },
    ],
  ];

  it('is stable for equal holes and changes when any field changes', () => {
    expect(hashHole(structuredClone(base))).toBe(hashHole(base));
    for (const [field, hole] of variants) {
      expect(hashHole(hole), field).not.toBe(hashHole(base));
    }
    expect(new Set(variants.map(([, h]) => hashHole(h))).size).toBe(variants.length);
  });
});
