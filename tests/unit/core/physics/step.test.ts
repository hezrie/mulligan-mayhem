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

describe('stepBall on rough and sand', () => {
  /** A long open box so a speed-400 roll on fairway (~222 units) never reaches a wall. */
  const longBox = (terrain: Record<string, unknown>) =>
    makeCourse({
      size: { width: 1000, height: 400 },
      boundary: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 400 },
        { x: 0, y: 400 },
      ],
      tee: { x: 100, y: 200 },
      cup: { x: 500, y: 50 },
      terrain,
    });

  function stoppingDistance(base: string): number {
    const c = longBox({ base, zones: [] });
    let ball = { pos: vec2(100, 200), vel: vec2(400, 0) };
    for (let i = 0; i < 10_000; i++) {
      const r = stepBall(ball, c);
      ball = r.ball;
      if (r.atRest) break;
    }
    expect(ball.vel).toEqual(ZERO);
    return ball.pos.x - 100;
  }

  it('stops within 3% of one third of the fairway distance on sand', () => {
    const third = stoppingDistance('fairway') / 3;
    expect(Math.abs(stoppingDistance('sand') - third)).toBeLessThanOrEqual(0.03 * third);
  });

  it('stops within 3% of one half of the fairway distance on rough', () => {
    const half = stoppingDistance('fairway') / 2;
    expect(Math.abs(stoppingDistance('rough') - half)).toBeLessThanOrEqual(0.03 * half);
  });

  it('rolls within 3% of four times the fairway distance on ice', () => {
    // Ice at speed 400 rolls ~889 units: the box leaves ~894 before the ball touches the wall.
    const quadruple = stoppingDistance('fairway') * 4;
    expect(Math.abs(stoppingDistance('ice') - quadruple)).toBeLessThanOrEqual(0.03 * quadruple);
  });

  it('decelerates at the sand rate only while the centre is inside a sand zone', () => {
    const sand = {
      kind: 'sand',
      polygon: [
        { x: 300, y: 0 },
        { x: 600, y: 0 },
        { x: 600, y: 400 },
        { x: 300, y: 400 },
      ],
    };
    const c = longBox({ base: 'fairway', zones: [sand] });
    let ball = { pos: vec2(200, 200), vel: vec2(400, 0) };
    let fairwaySteps = 0;
    let sandSteps = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = stepBall(ball, c);
      if (r.atRest) break;
      const inside = ball.pos.x > 300 && ball.pos.x < 600;
      const decel = (ball.vel.x - r.ball.vel.x) / DT;
      expect(decel).toBeCloseTo(inside ? TERRAIN.sand.rollingDecel : FAIRWAY, 6);
      if (inside) sandSteps++;
      else fairwaySteps++;
      ball = r.ball;
    }
    expect(fairwaySteps).toBeGreaterThan(0);
    expect(sandSteps).toBeGreaterThan(0);
    expect(ball.pos.x).toBeGreaterThan(300);
  });
});
