import { describe, expect, it } from 'vitest';
import {
  BALL_RADIUS,
  CUP_CAPTURE_SPEED,
  DT,
  MAX_SHOT_SPEED,
  REST_SPEED,
  WALL_RESTITUTION,
} from '../../../../src/core/physics/constants.ts';
import { stepBall } from '../../../../src/core/physics/step.ts';
import { TERRAIN } from '../../../../src/core/physics/terrain.ts';
import { length, vec2, ZERO } from '../../../../src/core/math/vec2.ts';
import { makeCourse } from '../../../helpers/holes.ts';

const course = makeCourse();
const FAIRWAY = TERRAIN.fairway.rollingDecel;

describe('stepBall', () => {
  it('decelerates by exactly the terrain rolling deceleration per step, keeping direction', () => {
    const r = stepBall({ pos: vec2(200, 200), vel: vec2(300, 0) }, course);
    expect(r.ball.vel.x).toBeCloseTo(300 - FAIRWAY * DT, 10);
    expect(r.ball.vel.y).toBe(0);
    expect(r.ball.pos.x).toBeCloseTo(200 + (300 - FAIRWAY * DT) * DT, 10);
  });

  it('comes to rest instead of reversing, below the rest speed', () => {
    const r = stepBall({ pos: vec2(200, 200), vel: vec2(REST_SPEED * 0.5, 0) }, course);
    expect(r.atRest).toBe(true);
    expect(r.ball.vel).toEqual(ZERO);
  });

  it('does nothing to a ball already at rest', () => {
    const r = stepBall({ pos: vec2(120, 220), vel: ZERO }, course);
    expect(r.ball).toEqual({ pos: vec2(120, 220), vel: ZERO });
    expect(r.atRest).toBe(true);
  });

  it('bounces off a boundary wall with restitution and reports the impact', () => {
    const r = stepBall({ pos: vec2(200, 400 - BALL_RADIUS - 1), vel: vec2(0, 300) }, course);
    expect(r.ball.vel.y).toBeLessThan(0);
    expect(-r.ball.vel.y).toBeCloseTo((300 - FAIRWAY * DT) * WALL_RESTITUTION, 6);
    expect(r.events.some((e) => e.type === 'bounce' && e.impulse > 0)).toBe(true);
  });

  it('cannot tunnel through a thin interior wall at maximum speed', () => {
    const walled = makeCourse({ walls: [{ a: { x: 100, y: 200 }, b: { x: 300, y: 200 } }] });
    let ball = { pos: vec2(200, 230), vel: vec2(0, -MAX_SHOT_SPEED) };
    for (let i = 0; i < 20; i++) {
      ball = stepBall(ball, walled).ball;
      expect(ball.pos.y).toBeGreaterThanOrEqual(200 + BALL_RADIUS - 1e-9);
    }
  });

  it('drops into the cup when slow enough over it', () => {
    const r = stepBall({ pos: vec2(200, 58), vel: vec2(0, -CUP_CAPTURE_SPEED * 0.5) }, course);
    expect(r.holed).toBe(true);
    expect(r.ball).toEqual({ pos: vec2(200, 50), vel: ZERO });
    expect(r.events).toContainEqual({ type: 'cup' });
  });

  it('rolls over the cup when too fast (lip-over)', () => {
    let ball = { pos: vec2(200, 80), vel: vec2(0, -CUP_CAPTURE_SPEED * 2) };
    let holed = false;
    for (let i = 0; i < 12; i++) {
      const r = stepBall(ball, course);
      ball = r.ball;
      holed ||= r.holed;
    }
    expect(holed).toBe(false);
    expect(ball.pos.y).toBeLessThan(50);
  });

  it('never increases speed', () => {
    let ball = { pos: vec2(30, 370), vel: vec2(MAX_SHOT_SPEED * 0.6, -MAX_SHOT_SPEED * 0.6) };
    let speed = length(ball.vel);
    for (let i = 0; i < 600; i++) {
      ball = stepBall(ball, course).ball;
      expect(length(ball.vel)).toBeLessThanOrEqual(speed + 1e-9);
      speed = length(ball.vel);
    }
  });
});
