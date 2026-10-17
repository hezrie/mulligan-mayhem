import { describe, expect, it } from 'vitest';
import { fnv1a64, hashValues } from '../../../src/core/hash.ts';

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
