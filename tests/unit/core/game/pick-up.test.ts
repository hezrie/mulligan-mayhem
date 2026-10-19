import { describe, expect, it } from 'vitest';
import { compileCourse } from '../../../../src/core/course/course.ts';
import { getHole } from '../../../../src/core/course/holes/index.ts';
import { createGame } from '../../../../src/core/game/machine.ts';
import {
  PICK_UP_OVER_PAR,
  pickUpMessage,
  pickUpStrokes,
  shouldPickUp,
} from '../../../../src/core/game/pick-up.ts';
import type { GamePhase, GameState } from '../../../../src/core/game/state.ts';
import { scoreEmoji } from '../../../../src/core/scoring/score.ts';

const base = createGame(compileCourse(getHole('skeleton-01')), 1);
const at = (phase: GamePhase, strokes: number): GameState => ({ ...base, phase, strokes });

describe('shouldPickUp', () => {
  it('defaults to a cap of par+4', () => {
    expect(PICK_UP_OVER_PAR).toBe(4);
  });

  it('is true only when aiming at par+4 strokes or more (par 3)', () => {
    expect(shouldPickUp(at('aiming', 6), 3)).toBe(false);
    expect(shouldPickUp(at('aiming', 7), 3)).toBe(true);
    expect(shouldPickUp(at('rolling', 7), 3)).toBe(false);
    expect(shouldPickUp(at('holed', 7), 3)).toBe(false);
  });

  it('honours a lower cap and a removed cap', () => {
    expect(shouldPickUp(at('aiming', 6), 3, 3)).toBe(true);
    expect(shouldPickUp(at('aiming', 20), 3, null)).toBe(false);
  });
});

describe('pickUpStrokes', () => {
  it('counts a picked-up hole as par + overPar + 1', () => {
    expect(pickUpStrokes(1)).toBe(6);
    expect(pickUpStrokes(3)).toBe(8);
    expect(pickUpStrokes(6)).toBe(11);
    expect(pickUpStrokes(3, 3)).toBe(7);
  });

  it('is always a red square on the share card', () => {
    for (let p = 1; p <= 6; p++) expect(scoreEmoji(pickUpStrokes(p), p)).toBe('🟥');
  });
});

describe('pickUpMessage', () => {
  it('names the counted strokes and the score versus par', () => {
    expect(pickUpMessage(3)).toBe('Picked up — counts as 8 (+5)');
    expect(pickUpMessage(2)).toBe('Picked up — counts as 7 (+5)');
    expect(pickUpMessage(3, 3)).toBe('Picked up — counts as 7 (+4)');
  });
});
