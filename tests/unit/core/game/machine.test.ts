import { describe, expect, it } from 'vitest';
import { createGame, shoot, ShotRejectedError, tick } from '../../../../src/core/game/machine.ts';
import type { GameState } from '../../../../src/core/game/state.ts';
import {
  DT,
  HAZARD_PAUSE_STEPS,
  MAX_ROLL_STEPS,
  MAX_SHOT_SPEED,
} from '../../../../src/core/physics/constants.ts';
import { seedState } from '../../../../src/core/rng.ts';
import { vec2, ZERO } from '../../../../src/core/math/vec2.ts';
import { makeCourse } from '../../../helpers/holes.ts';

const course = makeCourse();
const UP = -Math.PI / 2; // toward the cup at the top of the test box
// From the tee (200,350) to the cup (200,50) is 300 units. Power 0.62 (496 u/s) arrives at about
// 190 u/s, under the 280 u/s capture speed. Above about 0.68 the ball rolls over the cup.
const WELL_PACED = 0.62;

function rollUntilNotRolling(state: GameState): GameState {
  let s = state;
  for (let i = 0; i <= MAX_ROLL_STEPS && s.phase === 'rolling'; i++) s = tick(s, course).state;
  return s;
}

describe('createGame', () => {
  it('starts aiming at the tee with zero strokes and the seeded RNG state', () => {
    expect(createGame(course, 42)).toEqual({
      holeId: 'test-box',
      phase: 'aiming',
      ball: { pos: vec2(200, 350), vel: ZERO },
      strokes: 0,
      lastRest: vec2(200, 350),
      step: 0,
      rollSteps: 0,
      rngState: seedState(42),
    });
  });
});

describe('shoot', () => {
  it('adds a stroke and launches the ball at power × max speed along the angle', () => {
    const s = shoot(createGame(course, 1), { angle: 0, power: 0.5 });
    expect(s.phase).toBe('rolling');
    expect(s.strokes).toBe(1);
    expect(s.ball.vel).toEqual({ x: MAX_SHOT_SPEED * 0.5, y: 0 });
  });

  it.each([
    ['power below the minimum', { angle: 0, power: 0.01 }],
    ['power above 1', { angle: 0, power: 1.5 }],
    ['a non-finite angle', { angle: Number.NaN, power: 0.5 }],
  ])('rejects %s', (_label, shot) => {
    expect(() => shoot(createGame(course, 1), shot)).toThrow(ShotRejectedError);
  });

  it('rejects shots while the ball is rolling', () => {
    const rolling = shoot(createGame(course, 1), { angle: 0, power: 0.5 });
    expect(() => shoot(rolling, { angle: 0, power: 0.5 })).toThrow(ShotRejectedError);
  });

  it('does not mutate the previous state', () => {
    const start = Object.freeze(createGame(course, 1));
    shoot(start, { angle: 0, power: 0.5 });
    expect(start.strokes).toBe(0);
  });
});

describe('tick', () => {
  it('advances the step counter even while aiming, without moving the ball', () => {
    const start = createGame(course, 1);
    const { state, events } = tick(start, course);
    expect(state.step).toBe(1);
    expect(state.ball).toEqual(start.ball);
    expect(events).toEqual([]);
  });

  it('returns to aiming at rest and records the resting spot', () => {
    const s = rollUntilNotRolling(shoot(createGame(course, 1), { angle: 0, power: 0.3 }));
    expect(s.phase).toBe('aiming');
    expect(s.ball.vel).toEqual(ZERO);
    expect(s.lastRest).toEqual(s.ball.pos);
    expect(s.rollSteps).toBe(0);
  });

  it('emits a natural rest event (not forced by the cap)', () => {
    let s = shoot(createGame(course, 1), { angle: Math.PI, power: 0.2 });
    const events = [];
    while (s.phase === 'rolling') {
      const r = tick(s, course);
      s = r.state;
      events.push(...r.events);
    }
    expect(events.at(-1)).toEqual({ type: 'rest', forced: false });
  });

  it('holes a well-paced straight putt and stops simulating afterwards', () => {
    let s = shoot(createGame(course, 1), { angle: UP, power: WELL_PACED });
    const events = [];
    while (s.phase === 'rolling') {
      const r = tick(s, course);
      s = r.state;
      events.push(...r.events);
    }
    expect(s.phase).toBe('holed');
    expect(s.strokes).toBe(1);
    expect(events).toContainEqual({ type: 'holed', strokes: 1 });
    const after = tick(s, course).state;
    expect(after.ball).toEqual(s.ball);
    expect(after.phase).toBe('holed');
  });

  it('forces rest at the safety cap so no roll can last forever', () => {
    const endless: GameState = {
      ...createGame(course, 1),
      phase: 'rolling',
      ball: { pos: vec2(200, 200), vel: vec2(100, 0) },
      rollSteps: MAX_ROLL_STEPS - 1,
    };
    const { state, events } = tick(endless, course);
    expect(state.phase).toBe('aiming');
    expect(state.ball.vel).toEqual(ZERO);
    expect(events).toContainEqual({ type: 'rest', forced: true });
  });
});

describe('water hazard', () => {
  /** A water band across the box between the tee (y 350) and the cup (y 50). */
  const pond = makeCourse({
    terrain: {
      base: 'fairway',
      zones: [
        { kind: 'water', polygon: [vec2(0, 180), vec2(400, 180), vec2(400, 240), vec2(0, 240)] },
      ],
    },
  });
  // From a resting spot at (200,300), a shot straight up reaches the water within a few steps.
  const rested: GameState = {
    ...createGame(pond, 1),
    ball: { pos: vec2(200, 300), vel: ZERO },
    lastRest: vec2(200, 300),
    strokes: 2,
  };

  function rollIntoWater(): GameState {
    let s = shoot(rested, { angle: UP, power: 0.5 });
    for (let i = 0; i <= MAX_ROLL_STEPS && s.phase === 'rolling'; i++) s = tick(s, pond).state;
    return s;
  }

  it('HAZARD_PAUSE_STEPS is 60 (0.5 s)', () => {
    expect(HAZARD_PAUSE_STEPS).toBe(60);
    expect(HAZARD_PAUSE_STEPS * DT).toBeCloseTo(0.5, 12);
  });

  it('rolling into water enters the hazard phase', () => {
    const s = rollIntoWater();
    expect(s.phase).toBe('hazard');
    expect(s.ball.vel).toEqual(ZERO);
    expect(s.ball.pos.y).toBeLessThan(240);
    expect(s.ball.pos.y).toBeGreaterThan(180);
    expect(s.strokes).toBe(3);
  });

  it('stays in hazard for exactly HAZARD_PAUSE_STEPS steps', () => {
    let s = rollIntoWater();
    for (let i = 0; i < HAZARD_PAUSE_STEPS - 1; i++) s = tick(s, pond).state;
    expect(s.phase).toBe('hazard');
    s = tick(s, pond).state;
    expect(s.phase).toBe('aiming');
  });

  it('after the pause the ball is at lastRest with zero velocity and one penalty stroke', () => {
    let s = rollIntoWater();
    const entered = s.step;
    for (let i = 0; i < HAZARD_PAUSE_STEPS; i++) s = tick(s, pond).state;
    expect(s.phase).toBe('aiming');
    expect(s.ball).toEqual({ pos: vec2(200, 300), vel: ZERO });
    expect(s.lastRest).toEqual(vec2(200, 300));
    expect(s.strokes).toBe(4);
    expect(s.rollSteps).toBe(0);
    expect(s.step).toBe(entered + HAZARD_PAUSE_STEPS);
  });

  it('rejects a shot during the hazard phase', () => {
    const s = rollIntoWater();
    expect(s.phase).toBe('hazard');
    expect(() => shoot(s, { angle: UP, power: 0.5 })).toThrow(ShotRejectedError);
  });
});
