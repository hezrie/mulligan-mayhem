/**
 * Pick-up rule invariant: over many seeded random shot sequences, every hole ends (holed or picked
 * up) within par+4 strokes, and the rule never fires before the cap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHole } from '../../src/core/course/holes/index.ts';
import { parseHole, type Hole } from '../../src/core/course/schema.ts';
import { pickUpStrokes, shouldPickUp } from '../../src/core/game/pick-up.ts';
import { GameSession } from '../../src/core/game/session.ts';
import { Rng } from '../../src/core/rng.ts';

const bunkers = parseHole(
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/holes/bunkers.json'), 'utf8')),
);
const HOLES: Hole[] = [getHole('skeleton-01'), bunkers];
const SEQUENCES = 200;

describe('pick-up rule', () => {
  it.each(HOLES.map((h) => [h.id, h] as const))(
    'ends every random sequence on %s within par+4 strokes',
    (_id, hole) => {
      expect(hole.par).toBe(3);
      let pickedUp = 0;
      for (let seed = 1; seed <= SEQUENCES; seed++) {
        const rng = new Rng(seed);
        const session = new GameSession(hole, seed);
        while (session.state.phase !== 'holed' && !shouldPickUp(session.state, hole.par)) {
          // shouldPickUp was false at this rest, so the cap has not been reached yet.
          expect(session.state.strokes).toBeLessThan(hole.par + 4);
          session.shoot({
            angle: (rng.float() * 2 - 1) * Math.PI,
            power: 0.05 + rng.float() * 0.95,
          });
          session.runUntilRest();
        }
        expect(session.state.strokes).toBeLessThanOrEqual(hole.par + 4);
        if (session.state.phase !== 'holed') {
          pickedUp++;
          expect(session.state.strokes).toBe(hole.par + 4);
          expect(pickUpStrokes(hole.par)).toBe(hole.par + 5);
        }
      }
      // Random shots rarely hole out, so the pick-up path must actually be exercised.
      expect(pickedUp).toBeGreaterThan(0);
    },
  );
});
