import { describe, expect, it } from 'vitest';
import { GameSession } from '../../../../src/core/game/session.ts';
import { hashState } from '../../../../src/core/hash.ts';
import { makeHole } from '../../../helpers/holes.ts';

const UP = -Math.PI / 2;
// From the tee (200,350) to the cup (200,50) is 300 units. Power 0.62 (496 u/s) arrives at about
// 190 u/s, under the 280 u/s capture speed. Above about 0.68 the ball rolls over the cup.
const WELL_PACED = 0.62;

describe('GameSession', () => {
  it('runs a shot until rest and reports the steps taken', () => {
    const session = new GameSession(makeHole(), 1);
    session.shoot({ angle: Math.PI, power: 0.4 });
    const steps = session.runUntilRest();
    expect(steps).toBeGreaterThan(0);
    expect(session.state.phase).toBe('aiming');
    expect(session.runUntilRest()).toBe(0);
  });

  it('advances a fixed number of steps and collects events', () => {
    const session = new GameSession(makeHole(), 1);
    session.shoot({ angle: UP, power: WELL_PACED });
    const events = session.advance(10_000);
    expect(session.state.phase).toBe('holed');
    expect(events).toContainEqual({ type: 'holed', strokes: 1 });
    expect(session.state.step).toBe(10_000);
  });

  it('resets to the tee and loads other holes', () => {
    const session = new GameSession(makeHole(), 1);
    session.shoot({ angle: 0, power: 0.5 });
    session.reset();
    expect(session.state.strokes).toBe(0);
    expect(session.state.phase).toBe('aiming');

    session.load(makeHole({ id: 'other-hole', tee: { x: 100, y: 100 } }), 7);
    expect(session.state.holeId).toBe('other-hole');
    expect(session.state.ball.pos).toEqual({ x: 100, y: 100 });
    expect(session.course.hole.id).toBe('other-hole');
  });

  it('is deterministic: same hole + seed + shots ⇒ same state hash', () => {
    const play = (): string => {
      const s = new GameSession(makeHole(), 9);
      for (const angle of [0.3, 2.1, -1.2]) {
        s.shoot({ angle, power: 0.7 });
        s.runUntilRest();
      }
      return hashState(s.state);
    };
    expect(play()).toBe(play());
  });
});
