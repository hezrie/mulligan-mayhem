import { describe, expect, it } from 'vitest';
import {
  mergeBestStars,
  parseBestStars,
  starsAriaLabel,
  starsFor,
  totalStars,
  type BestStars,
} from '../../../../src/core/scoring/stars.ts';

describe('starsFor', () => {
  const pars = [1, 2, 3, 4, 5, 6];
  const cases = pars.flatMap((par) => [
    { par, strokes: 1, stars: 3 },
    { par, strokes: par, stars: 3 },
    { par, strokes: par + 1, stars: 2 },
    { par, strokes: par + 2, stars: 2 },
    { par, strokes: par + 3, stars: 1 },
    { par, strokes: par + 5, stars: 1 },
  ]);

  it.each(cases)('par $par, $strokes strokes → $stars stars', ({ par, strokes, stars }) => {
    expect(starsFor(strokes, par)).toBe(stars);
  });

  it.each([0, -1, 2.5, Number.NaN])('throws a RangeError for strokes %s', (strokes) => {
    expect(() => starsFor(strokes, 3)).toThrow(RangeError);
  });

  it.each([0, 7, 3.5])('throws a RangeError for par %s', (par) => {
    expect(() => starsFor(3, par)).toThrow(RangeError);
  });
});

describe('starsAriaLabel', () => {
  it.each([
    [1, '1 of 3 stars'],
    [2, '2 of 3 stars'],
    [3, '3 of 3 stars'],
  ] as const)('labels %s stars as "%s"', (stars, label) => {
    expect(starsAriaLabel(stars)).toBe(label);
  });
});

describe('mergeBestStars', () => {
  const holeId = 'skeleton-01';

  it('never lowers a best: recording 3 then 1 keeps 3', () => {
    const afterThree = mergeBestStars(Object.freeze({}), holeId, 3);
    const afterOne = mergeBestStars(Object.freeze(afterThree), holeId, 1);
    expect(afterOne[holeId]).toBe(3);
  });

  it('raises a best: recording 2 then 3 gives 3', () => {
    const afterTwo = mergeBestStars(Object.freeze({}), holeId, 2);
    const afterThree = mergeBestStars(Object.freeze(afterTwo), holeId, 3);
    expect(afterThree[holeId]).toBe(3);
  });

  it('records into an empty record', () => {
    expect(mergeBestStars(Object.freeze({}), holeId, 2)).toEqual({ [holeId]: 2 });
  });

  it('leaves other entries unchanged and does not mutate the input', () => {
    const best: BestStars = Object.freeze({ 'dogleg-02': 1, [holeId]: 2 });
    const next = mergeBestStars(best, holeId, 3);
    expect(next).toEqual({ 'dogleg-02': 1, [holeId]: 3 });
    expect(next).not.toBe(best);
    expect(best).toEqual({ 'dogleg-02': 1, [holeId]: 2 });
  });
});

describe('parseBestStars and totalStars', () => {
  it('keeps only valid hole ids with 1, 2 or 3 stars', () => {
    const parsed = parseBestStars({ 'skeleton-01': 3, 'dogleg-02': 2, 'Bad Id': 3, x: 7 });
    expect(parsed).toStrictEqual({ 'skeleton-01': 3, 'dogleg-02': 2 });
    expect(totalStars(parsed)).toBe(5);
  });

  it('drops non-integer and non-number values', () => {
    expect(parseBestStars({ a: 2.5, b: '3', c: null, d: 0, e: 1 })).toStrictEqual({ e: 1 });
  });

  it.each([null, undefined, [], [3], 'skeleton-01', 3])('returns {} for %j', (data) => {
    expect(parseBestStars(data)).toStrictEqual({});
  });

  it('totals 0 for an empty record', () => {
    expect(totalStars({})).toBe(0);
  });
});
