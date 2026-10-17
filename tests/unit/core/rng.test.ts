import { describe, expect, it } from 'vitest';
import { nextFloat, nextInt, Rng, seedState } from '../../../src/core/rng.ts';

describe('seeded PRNG (mulberry32)', () => {
  it('matches the reference mulberry32 sequence', () => {
    // Reference values from the canonical mulberry32 implementation.
    const rng = new Rng(1);
    expect([rng.float(), rng.float(), rng.float()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
    const other = new Rng(123456789);
    expect([other.float(), other.float()]).toEqual([0.2577907438389957, 0.9707721115555614]);
  });

  it('is a pure function of its state', () => {
    const s = seedState(42);
    expect(nextFloat(s)).toEqual(nextFloat(s));
    const first = nextFloat(s);
    expect(nextFloat(first.state).value).not.toBe(first.value);
  });

  it('produces floats in [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces integers in an inclusive range, covering both ends', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) seen.add(rng.int(2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('exposes its state so it can be stored in game state and resumed', () => {
    const a = new Rng(99);
    a.float();
    const b = Rng.fromState(a.state);
    expect(b.float()).toBe(a.float());
    expect(nextInt(seedState(5), 0, 0).value).toBe(0);
  });

  it('normalizes seeds to 32-bit integers', () => {
    expect(seedState(2 ** 32 + 5)).toBe(seedState(5));
    expect(Number.isInteger(seedState(1.9))).toBe(true);
  });
});
