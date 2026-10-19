import { describe, expect, it } from 'vitest';
import { getHole } from '../../../../src/core/course/holes/index.ts';
import { GameSession, MAX_PENDING_EVENTS } from '../../../../src/core/game/session.ts';
import { hashState } from '../../../../src/core/hash.ts';
import { vec2, ZERO } from '../../../../src/core/math/vec2.ts';
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

  it('runUntilRest plays through a water hazard back to aiming', () => {
    const water = [vec2(0, 180), vec2(400, 180), vec2(400, 240), vec2(0, 240)];
    const hole = makeHole({
      terrain: { base: 'fairway', zones: [{ kind: 'water', polygon: water }] },
    });
    const session = new GameSession(hole, 1);
    session.shoot({ angle: UP, power: 0.5 });
    session.runUntilRest();
    expect(session.state.phase).toBe('aiming');
    expect(session.state.ball).toEqual({ pos: vec2(200, 350), vel: ZERO });
    expect(session.state.strokes).toBe(2);
    session.shoot({ angle: UP, power: 0.5 });
    expect(session.state.phase).toBe('rolling');
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

  it('reports each event with the step that produced it', () => {
    const ACE = { angle: -2.481, power: 0.925 };
    const viaAdvance: [string, number][] = [];
    const a = new GameSession(getHole('skeleton-01'), 1);
    a.shoot(ACE);
    const returned = a.advance(200, (e, step) => viaAdvance.push([e.type, step]));
    expect(viaAdvance).toEqual([
      ['bounce', 55],
      ['cup', 151],
      ['holed', 151],
    ]);
    expect(returned.map((e) => e.type)).toEqual(['bounce', 'cup', 'holed']);

    const viaRun: [string, number][] = [];
    const b = new GameSession(getHole('skeleton-01'), 1);
    b.shoot(ACE);
    expect(b.runUntilRest((e, step) => viaRun.push([e.type, step]))).toBe(151);
    expect(viaRun).toEqual(viaAdvance);
    expect(b.drainEvents().map((e) => e.type)).toEqual(['bounce', 'cup', 'holed']);
  });

  describe('drainEvents', () => {
    const skeleton = (): GameSession => new GameSession(getHole('skeleton-01'), 1);
    const BOUNCE_SHOT = { angle: -1.4, power: 0.7 };
    const ACE_SHOT = { angle: -2.481, power: 0.925 };

    it('returns every event from runUntilRest in order, then empties', () => {
      const session = skeleton();
      session.shoot(BOUNCE_SHOT);
      session.runUntilRest();
      const events = session.drainEvents();
      expect(events).toHaveLength(2);
      const [bounce, rest] = events;
      expect(bounce?.type).toBe('bounce');
      expect(bounce?.type === 'bounce' ? bounce.impulse : NaN).toBeCloseTo(748.5476, 3);
      expect(rest).toEqual({ type: 'rest', forced: false });
      expect(session.drainEvents()).toEqual([]);
    });

    it('advance returns its events and also buffers them', () => {
      const session = skeleton();
      session.shoot(ACE_SHOT);
      const events = session.advance(200);
      expect(events).toHaveLength(3);
      const [bounce, cup, holed] = events;
      expect(bounce?.type).toBe('bounce');
      expect(bounce?.type === 'bounce' ? bounce.impulse : NaN).toBeCloseTo(817.2657, 3);
      expect(cup).toEqual({ type: 'cup' });
      expect(holed).toEqual({ type: 'holed', strokes: 1 });
      expect(session.drainEvents()).toEqual(events);
    });

    it('keeps runUntilRest step counts unchanged', () => {
      const a = skeleton();
      a.shoot(BOUNCE_SHOT);
      expect(a.runUntilRest()).toBe(158);
      const b = skeleton();
      b.shoot(ACE_SHOT);
      expect(b.runUntilRest()).toBe(151);
    });

    it('is emptied by reset() and load()', () => {
      const session = skeleton();
      session.shoot(BOUNCE_SHOT);
      session.runUntilRest();
      session.reset();
      expect(session.drainEvents()).toEqual([]);

      session.shoot(BOUNCE_SHOT);
      session.runUntilRest();
      session.load(getHole('skeleton-01'), 1);
      expect(session.drainEvents()).toEqual([]);
    });

    it('holds at most MAX_PENDING_EVENTS, dropping the oldest', () => {
      expect(MAX_PENDING_EVENTS).toBe(1024);
      const session = skeleton();
      for (let i = 0; i < 1100; i++) {
        session.shoot({ angle: i % 2 === 0 ? 0 : Math.PI, power: 0.05 });
        session.runUntilRest();
      }
      const events = session.drainEvents();
      expect(events.length).toBe(1024);
      expect(events.every((e) => e.type === 'rest' && !e.forced)).toBe(true);
    });
  });
});
