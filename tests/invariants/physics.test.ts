/**
 * Physics invariants, checked at every fixed step over many seeded random shots:
 *  - the ball never leaves the hole's boundary and never sinks into a wall;
 *  - speed never increases (the skeleton has no external forces);
 *  - every roll comes to rest naturally within the analytic bound (speed / deceleration);
 *  - the same hole + seed + shots always give the same state hash.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCourse, type Course } from '../../src/core/course/course.ts';
import { getHole } from '../../src/core/course/holes/index.ts';
import { parseHole, type Hole } from '../../src/core/course/schema.ts';
import { tick, type GameEvent } from '../../src/core/game/machine.ts';
import { GameSession } from '../../src/core/game/session.ts';
import { MIN_SHOT_POWER, type Shot } from '../../src/core/game/shot.ts';
import { hashState } from '../../src/core/hash.ts';
import { distanceToSegment, pointInPolygon } from '../../src/core/math/geometry.ts';
import { length } from '../../src/core/math/vec2.ts';
import { BALL_RADIUS, DT, MAX_SHOT_SPEED } from '../../src/core/physics/constants.ts';
import { TERRAIN, TERRAIN_KINDS } from '../../src/core/physics/terrain.ts';
import { Rng } from '../../src/core/rng.ts';

const pinball = parseHole(
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/holes/pinball.json'), 'utf8')),
);
const HOLES: Hole[] = [getHole('skeleton-01'), pinball];

const SHOTS_PER_HOLE = 300;
const SLOWEST_DECEL = Math.min(...TERRAIN_KINDS.map((k) => TERRAIN[k].rollingDecel));
/** Analytic worst case: full speed decelerating at the slowest rate, plus one step of slack. */
const MAX_NATURAL_ROLL_STEPS = Math.ceil(MAX_SHOT_SPEED / SLOWEST_DECEL / DT) + 1;
/** Push-out leaves the ball exactly touching; allow only floating-point noise (measured ~1e-14). */
const MAX_PENETRATION = 1e-9;

function randomShot(rng: Rng): Shot {
  return {
    angle: (rng.float() * 2 - 1) * Math.PI,
    power: MIN_SHOT_POWER + rng.float() * (1 - MIN_SHOT_POWER),
  };
}

interface RollReport {
  steps: number;
  forcedRest: boolean;
  worstPenetration: number;
  leftBounds: boolean;
  speedIncreased: boolean;
}

/** Shoots from the session's current position and audits every step until the ball stops. */
function auditRoll(session: GameSession, course: Course, shot: Shot): RollReport {
  session.shoot(shot);
  const report: RollReport = {
    steps: 0,
    forcedRest: false,
    worstPenetration: 0,
    leftBounds: false,
    speedIncreased: false,
  };
  let state = session.state;
  let speed = length(state.ball.vel);
  while (state.phase === 'rolling') {
    const { state: next, events } = tick(state, course);
    state = next;
    report.steps++;
    const pos = state.ball.pos;
    if (!pointInPolygon(pos, course.hole.boundary)) report.leftBounds = true;
    for (const seg of course.segments) {
      report.worstPenetration = Math.max(
        report.worstPenetration,
        BALL_RADIUS - distanceToSegment(pos, seg),
      );
    }
    const nextSpeed = length(state.ball.vel);
    if (nextSpeed > speed + 1e-9) report.speedIncreased = true;
    speed = nextSpeed;
    if (events.some((e: GameEvent) => e.type === 'rest' && e.forced)) report.forcedRest = true;
  }
  // Keep the session in sync with the audited state for multi-shot sequences.
  session.runUntilRest();
  return report;
}

describe.each(HOLES.map((h) => [h.id, h] as const))('physics invariants on %s', (_id, hole) => {
  const course = compileCourse(hole);
  const rng = new Rng(20261017);
  const reports = Array.from({ length: SHOTS_PER_HOLE }, () =>
    auditRoll(new GameSession(hole, 1), course, randomShot(rng)),
  );

  it('the ball never leaves the hole boundary', () => {
    expect(reports.filter((r) => r.leftBounds)).toHaveLength(0);
  });

  it('the ball never sinks into a wall (no tunnelling)', () => {
    const worst = Math.max(...reports.map((r) => r.worstPenetration));
    expect(worst).toBeLessThanOrEqual(MAX_PENETRATION);
  });

  it('speed never increases without an external force', () => {
    expect(reports.filter((r) => r.speedIncreased)).toHaveLength(0);
  });

  it(`every roll comes to rest naturally within ${String(MAX_NATURAL_ROLL_STEPS)} steps`, () => {
    expect(reports.filter((r) => r.forcedRest)).toHaveLength(0);
    expect(Math.max(...reports.map((r) => r.steps))).toBeLessThanOrEqual(MAX_NATURAL_ROLL_STEPS);
  });

  it('multi-shot sequences from wherever the ball stops keep every invariant', () => {
    const seqRng = new Rng(7);
    for (let game = 0; game < 40; game++) {
      const session = new GameSession(hole, game);
      for (let shot = 0; shot < 4 && session.state.phase === 'aiming'; shot++) {
        const r = auditRoll(session, course, randomShot(seqRng));
        expect(r.leftBounds || r.speedIncreased || r.forcedRest).toBe(false);
        expect(r.worstPenetration).toBeLessThanOrEqual(MAX_PENETRATION);
      }
    }
  });
});

describe('determinism', () => {
  function playGame(hole: Hole, seed: number, shots: Shot[]): string {
    const session = new GameSession(hole, seed);
    for (const shot of shots) {
      if (session.state.phase !== 'aiming') break;
      session.shoot(shot);
      session.runUntilRest();
    }
    return hashState(session.state);
  }

  it('same hole + seed + shots ⇒ identical state hash, with no hidden global state', () => {
    const rng = new Rng(99);
    const shots = Array.from({ length: 5 }, () => randomShot(rng));
    const first = playGame(pinball, 3, shots);
    playGame(getHole('skeleton-01'), 8, shots.slice().reverse()); // unrelated game in between
    expect(playGame(pinball, 3, shots)).toBe(first);
  });

  it('different shots or seeds ⇒ different hashes', () => {
    const shots = [{ angle: 0.5, power: 0.6 }];
    const base = playGame(pinball, 3, shots);
    expect(playGame(pinball, 4, shots)).not.toBe(base);
    expect(playGame(pinball, 3, [{ angle: 0.5, power: 0.6000001 }])).not.toBe(base);
  });
});
