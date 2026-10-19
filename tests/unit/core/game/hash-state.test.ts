import { describe, expect, it } from 'vitest';
import { createGame } from '../../../../src/core/game/machine.ts';
import { hashState } from '../../../../src/core/hash.ts';
import { vec2 } from '../../../../src/core/math/vec2.ts';
import { makeCourse } from '../../../helpers/holes.ts';

const base = createGame(makeCourse(), 1);

describe('hashState', () => {
  it('is stable for equal states', () => {
    expect(hashState(base)).toBe(hashState({ ...base }));
  });

  it('hazard hashes differently from aiming and rolling', () => {
    const hazard = hashState({ ...base, phase: 'hazard' });
    expect(hazard).not.toBe(hashState({ ...base, phase: 'aiming' }));
    expect(hazard).not.toBe(hashState({ ...base, phase: 'rolling' }));
  });

  it.each([
    ['holeId', { holeId: 'other' }],
    ['phase', { phase: 'rolling' as const }],
    ['strokes', { strokes: 1 }],
    ['step', { step: 1 }],
    ['rollSteps', { rollSteps: 1 }],
    ['rngState', { rngState: 2 }],
    ['ball position', { ball: { ...base.ball, pos: vec2(200, 350.0000000001) } }],
    ['ball velocity', { ball: { ...base.ball, vel: vec2(0, 1e-300) } }],
    ['last resting spot', { lastRest: vec2(1, 1) }],
  ])('changes when %s changes', (_field, change) => {
    expect(hashState({ ...base, ...change })).not.toBe(hashState(base));
  });
});
