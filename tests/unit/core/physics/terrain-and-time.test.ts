import { describe, expect, it } from 'vitest';
import {
  DT,
  MAX_FRAME_SECONDS,
  MAX_ROLL_STEPS,
  MAX_ROLL_SECONDS,
} from '../../../../src/core/physics/constants.ts';
import { TERRAIN, TERRAIN_KINDS } from '../../../../src/core/physics/terrain.ts';
import { advanceClock } from '../../../../src/core/physics/timestep.ts';

describe('terrain table', () => {
  it('defines positive rolling deceleration for every terrain kind', () => {
    for (const kind of TERRAIN_KINDS) {
      expect(TERRAIN[kind].rollingDecel).toBeGreaterThan(0);
      expect(TERRAIN[kind].label.length).toBeGreaterThan(0);
    }
  });
});

describe('constants', () => {
  it('derives the roll cap in whole steps', () => {
    expect(MAX_ROLL_STEPS).toBe(Math.ceil(MAX_ROLL_SECONDS / DT));
  });
});

describe('advanceClock', () => {
  it('converts real time into whole fixed steps and carries the remainder', () => {
    const r = advanceClock(0, 2.5 * DT);
    expect(r.steps).toBe(2);
    expect(r.accumulator).toBeCloseTo(0.5 * DT, 12);
    const next = advanceClock(r.accumulator, 0.6 * DT);
    expect(next.steps).toBe(1);
  });

  it('clamps long frames (e.g. a backgrounded tab) to avoid a catch-up spiral', () => {
    expect(advanceClock(0, 10).steps).toBe(Math.floor(MAX_FRAME_SECONDS / DT));
  });

  it('ignores negative frame times', () => {
    expect(advanceClock(0, -1)).toEqual({ steps: 0, accumulator: 0 });
  });
});
