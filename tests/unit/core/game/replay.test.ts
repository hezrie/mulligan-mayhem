import { describe, expect, it } from 'vitest';
import { playReplay, ReplayError } from '../../../../src/core/game/replay.ts';
import { makeHole } from '../../../helpers/holes.ts';

const UP = -Math.PI / 2;
// From the tee (200,350) to the cup (200,50) is 300 units. Power 0.62 (496 u/s) arrives at about
// 190 u/s, under the 280 u/s capture speed. Above about 0.68 the ball rolls over the cup.
const WELL_PACED = 0.62;

describe('playReplay', () => {
  it('plays shots to rest and reports strokes, outcome and final hash', () => {
    const result = playReplay(makeHole(), 1, [{ angle: UP, power: WELL_PACED }]);
    expect(result.strokes).toBe(1);
    expect(result.holed).toBe(true);
    expect(result.finalStateHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reports an unfinished hole', () => {
    const result = playReplay(makeHole(), 1, [{ angle: Math.PI, power: 0.2 }]);
    expect(result).toMatchObject({ strokes: 1, holed: false });
  });

  it('rejects replays that keep shooting after the ball is holed', () => {
    expect(() =>
      playReplay(makeHole(), 1, [
        { angle: UP, power: WELL_PACED },
        { angle: 0, power: 0.5 },
      ]),
    ).toThrow(ReplayError);
  });
});
