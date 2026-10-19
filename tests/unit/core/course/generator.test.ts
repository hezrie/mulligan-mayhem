import { describe, expect, it } from 'vitest';
import {
  fnv1a32,
  generateHole,
  GENERATOR_VERSION,
  seedForDate,
} from '../../../../src/core/course/generator.ts';
import { HoleSchema, type Hole } from '../../../../src/core/course/schema.ts';
import { hashHole } from '../../../../src/core/hash.ts';

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);
const INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8];

// The full 4,500-hole sample, generated once for every sweep test.
const SAMPLE: { seed: number; index: number; hole: Hole }[] = SEEDS.flatMap((seed) =>
  INDICES.map((index) => ({ seed, index, hole: generateHole(seed, index) })),
);

describe('generateHole', () => {
  it('returns a deep-equal hole and the same hashHole for the same seed and index', () => {
    const pairs = [
      [1, 0],
      [12345, 0],
      [0xffffffff, 8],
      [42, 4],
    ] as const;
    const first = pairs.map(([s, i]) => generateHole(s, i));
    generateHole(7, 3); // unrelated calls in between must not leak state
    const second = pairs.map(([s, i]) => generateHole(s, i));
    expect(second).toStrictEqual(first);
    expect(second.map(hashHole)).toStrictEqual(first.map(hashHole));
  });

  it('different seeds or indices give different holes', () => {
    expect(hashHole(generateHole(1, 0))).not.toBe(hashHole(generateHole(2, 0)));
    expect(hashHole(generateHole(1, 0))).not.toBe(hashHole(generateHole(1, 1)));
    expect(new Set(SAMPLE.map((s) => hashHole(s.hole))).size).toBe(SAMPLE.length);
  });

  it('throws RangeError for an index outside 0–8 or a non-integer index', () => {
    expect(() => generateHole(1, -1)).toThrow(RangeError);
    expect(() => generateHole(1, 9)).toThrow(RangeError);
    expect(() => generateHole(1, 0.5)).toThrow(RangeError);
  });

  it('gives each hole a kebab-case id and a name from its seed and index', () => {
    const hole = generateHole(12345, 0);
    expect(hole.id).toBe('daily-12345-1');
    expect(hole.name).toBe('Daily Hole 1');
  });

  it('exposes the generator version', () => {
    expect(GENERATOR_VERSION).toBe(1);
  });
});

describe('generateHole sweep (seeds 1–500, indices 0–8)', () => {
  it('every hole passes HoleSchema', () => {
    const failures = SAMPLE.filter((s) => !HoleSchema.safeParse(s.hole).success).map(
      (s) => `seed ${String(s.seed)} index ${String(s.index)}`,
    );
    expect(failures).toStrictEqual([]);
  });

  it('uses only fairway, rough and sand terrain', () => {
    const kinds = new Set(
      SAMPLE.flatMap((s) => [s.hole.terrain.base, ...s.hole.terrain.zones.map((z) => z.kind)]),
    );
    expect([...kinds].sort()).toStrictEqual(['fairway', 'rough', 'sand']);
  });

  it('has between 0 and 4 interior walls', () => {
    for (const { hole } of SAMPLE) {
      expect(hole.walls.length).toBeGreaterThanOrEqual(0);
      expect(hole.walls.length).toBeLessThanOrEqual(4);
    }
  });

  it('has a par between 2 and 5', () => {
    for (const { hole } of SAMPLE) {
      expect(hole.par).toBeGreaterThanOrEqual(2);
      expect(hole.par).toBeLessThanOrEqual(5);
    }
  });

  it('covers the whole range of wall counts and pars', () => {
    const walls = new Set(SAMPLE.map((s) => s.hole.walls.length));
    const pars = new Set(SAMPLE.map((s) => s.hole.par));
    expect([...walls].sort()).toStrictEqual([0, 1, 2, 3, 4]);
    expect([...pars].sort()).toStrictEqual([2, 3, 4, 5]);
  });
});

/** Every date from 2026-01-01 to 2028-12-31 (2028 is a leap year). */
function datesOf2026To2028(): string[] {
  const out: string[] = [];
  for (let year = 2026; year <= 2028; year++) {
    const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    days.forEach((n, m) => {
      for (let d = 1; d <= n; d++) {
        out.push(`${String(year)}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
      }
    });
  }
  return out;
}

describe('seedForDate', () => {
  it('matches the FNV-1a 32-bit reference vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
    expect(seedForDate('2026-11-01')).toBe(fnv1a32('2026-11-01'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const date of ['2026-01-01', '2027-06-15', '2028-12-31']) {
      const seed = seedForDate(date);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });

  it('gives a distinct seed for every day of 2026–2028', () => {
    const dates = datesOf2026To2028();
    expect(dates).toHaveLength(1096);
    expect(new Set(dates.map(seedForDate)).size).toBe(1096);
  });

  it('rejects strings that are not YYYY-MM-DD', () => {
    for (const bad of ['', '2026-1-01', '2026/01/01', '20260101', ' 2026-01-01', '2026-01-01x']) {
      expect(() => seedForDate(bad)).toThrow(RangeError);
    }
  });
});
