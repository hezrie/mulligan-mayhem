import { describe, expect, it } from 'vitest';
import {
  emptySave,
  hasFlag,
  mergeBest,
  parseSave,
  setFlag,
  type Save,
} from '../../../../src/core/game/save.ts';
import { Rng } from '../../../../src/core/rng.ts';

const HOLE = 'skeleton-01';

describe('emptySave', () => {
  it('is version 1 with no bests or flags, and new on every call', () => {
    expect(emptySave()).toEqual({ version: 1, best: {}, flags: {} });
    expect(emptySave()).not.toBe(emptySave());
  });
});

describe('parseSave', () => {
  it.each([{}, { version: 1 }])('defaults missing fields for %j', (raw) => {
    expect(parseSave(raw)).toEqual({ save: emptySave(), corrupt: false });
  });

  it('round-trips a valid save through JSON unchanged', () => {
    const save: Save = {
      version: 1,
      best: { [HOLE]: { strokes: 3, stars: 3 } },
      flags: { 'tip.sand': true },
    };
    const parsed = parseSave(JSON.parse(JSON.stringify(save)));
    expect(parsed).toEqual({ save, corrupt: false });
  });

  it('strips unknown top-level keys without marking the save corrupt', () => {
    expect(parseSave({ version: 1, extra: 1 })).toEqual({ save: emptySave(), corrupt: false });
  });

  it.each([
    undefined,
    null,
    42,
    'x',
    [],
    { version: 2 },
    { best: 'x' },
    { best: { [HOLE]: { strokes: 0, stars: 1 } } },
    { best: { [HOLE]: { strokes: 3, stars: 4 } } },
    { best: { 'Bad Id': { strokes: 3, stars: 1 } } },
    { flags: { 'tip.sand': 'yes' } },
  ])('marks %j corrupt and returns an empty save', (raw) => {
    expect(parseSave(raw)).toEqual({ save: emptySave(), corrupt: true });
  });
});

describe('mergeBest', () => {
  it('keeps the minimum strokes and the maximum stars independently, without mutating', () => {
    const steps: [number, number, { strokes: number; stars: number }][] = [
      [4, 2, { strokes: 4, stars: 2 }],
      [5, 3, { strokes: 4, stars: 3 }],
      [3, 1, { strokes: 3, stars: 3 }],
    ];
    let save: Save = Object.freeze(emptySave());
    for (const [strokes, stars, expected] of steps) {
      const before = JSON.stringify(save);
      const input = Object.freeze({ holeId: HOLE, strokes, stars });
      const next = mergeBest(save, input);
      expect(next.best[HOLE]).toEqual(expected);
      expect(JSON.stringify(save)).toBe(before);
      expect(input).toEqual({ holeId: HOLE, strokes, stars });
      save = Object.freeze(next);
    }
  });

  it.each([
    { holeId: HOLE, strokes: 0, stars: 1 },
    { holeId: HOLE, strokes: 2.5, stars: 1 },
    { holeId: HOLE, strokes: 100, stars: 1 },
    { holeId: HOLE, strokes: 3, stars: 0 },
    { holeId: HOLE, strokes: 3, stars: 4 },
    { holeId: HOLE, strokes: 3, stars: 1.5 },
    { holeId: 'Bad Id', strokes: 3, stars: 1 },
  ])('returns the same save for invalid input %j', (input) => {
    const save = emptySave();
    expect(mergeBest(save, input)).toBe(save);
  });

  it('treats an id that names an Object.prototype member as a new hole', () => {
    expect(mergeBest(emptySave(), { holeId: 'constructor', strokes: 2, stars: 3 }).best).toEqual({
      constructor: { strokes: 2, stars: 3 },
    });
  });
});

describe('flags', () => {
  it('hasFlag is false on an empty save', () => {
    expect(hasFlag(emptySave(), 'tip.sand')).toBe(false);
  });

  it('setFlag returns a new save with the flag set to true', () => {
    const save = Object.freeze(emptySave());
    const next = setFlag(save, 'tip.sand');
    expect(next).not.toBe(save);
    expect(next.flags['tip.sand']).toBe(true);
    expect(hasFlag(next, 'tip.sand')).toBe(true);
    expect(save.flags).toEqual({});
  });

  it.each(['', 'Has Space', 'a'.repeat(41)])('setFlag returns the same save for key %j', (key) => {
    const save = emptySave();
    expect(setFlag(save, key)).toBe(save);
  });
});

const KEYS = ['version', 'best', 'flags', HOLE, 'strokes', 'stars', 'tip.sand', 'extra'];
const PRIMITIVES: unknown[] = [null, true, false, '', 'x', 'tip.sand', 0, 1, 2, 3, 4, 99, 2.5];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.int(0, items.length - 1)] as T;
}

function randomPrimitive(rng: Rng): unknown {
  return rng.float() < 0.5 ? pick(rng, PRIMITIVES) : rng.int(-200, 200);
}

/** Depth 0 is a leaf; containers nest up to `depth` levels. */
function randomValue(rng: Rng, depth: number): unknown {
  const kind = depth === 0 ? 0 : rng.int(0, 2);
  if (kind === 0) return randomPrimitive(rng);
  if (kind === 1) return Array.from({ length: rng.int(0, 3) }, () => randomValue(rng, depth - 1));
  const value: Record<string, unknown> = {};
  for (const key of KEYS) if (rng.float() < 0.4) value[key] = randomValue(rng, depth - 1);
  return value;
}

describe('parseSave property', () => {
  it('never throws, resets corrupt saves and returns JSON-stable valid saves', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 500; i++) {
      const input = randomValue(rng, 3);
      let result: ReturnType<typeof parseSave> | undefined;
      expect(() => (result = parseSave(input))).not.toThrow();
      if (result === undefined) throw new Error('parseSave returned nothing');
      if (result.corrupt) expect(result.save).toEqual(emptySave());
      else expect(parseSave(JSON.parse(JSON.stringify(result.save))).save).toEqual(result.save);
    }
  });
});
