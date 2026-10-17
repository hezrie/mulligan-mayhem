import { describe, expect, it } from 'vitest';
import {
  completionMessage,
  scoreEmoji,
  scoreLabel,
  scoreName,
} from '../../../../src/core/scoring/score.ts';

describe('scoreName', () => {
  it.each([
    [1, 3, 'hole-in-one'],
    [1, 2, 'hole-in-one'],
    [2, 5, 'eagle'],
    [2, 4, 'eagle'],
    [2, 3, 'birdie'],
    [3, 3, 'par'],
    [4, 3, 'bogey'],
    [5, 3, 'double-bogey'],
    [9, 3, 'double-bogey'],
  ] as const)('%i strokes on par %i is %s', (strokes, par, name) => {
    expect(scoreName(strokes, par)).toBe(name);
  });
});

describe('scoreEmoji (share card)', () => {
  it.each([
    [2, 5, '🟦'],
    [1, 3, '🟦'],
    [1, 2, '🟩'], // hole in one on a par 2 is a birdie on the card
    [2, 3, '🟩'],
    [3, 3, '⬜'],
    [4, 3, '🟨'],
    [5, 3, '🟥'],
    [8, 3, '🟥'],
  ] as const)('%i strokes on par %i → %s', (strokes, par, emoji) => {
    expect(scoreEmoji(strokes, par)).toBe(emoji);
  });
});

describe('scoreLabel', () => {
  it.each([
    [1, 3, 'Hole in one!'],
    [1, 4, 'Hole in one!'],
    [2, 4, 'Eagle'],
    [2, 5, 'Albatross'],
    [3, 4, 'Birdie'],
    [3, 3, 'Par'],
    [4, 3, 'Bogey'],
    [5, 3, 'Double bogey'],
    [6, 3, 'Triple bogey'],
    [8, 3, '+5'],
  ] as const)('%i strokes on par %i → %s', (strokes, par, label) => {
    expect(scoreLabel(strokes, par)).toBe(label);
  });
});

describe('completionMessage', () => {
  it('matches the hole-complete screen copy', () => {
    expect(completionMessage(3, 3)).toBe('Hole complete — 3 strokes (Par)');
    expect(completionMessage(1, 3)).toBe('Hole complete — 1 stroke (Hole in one!)');
    expect(completionMessage(5, 3)).toBe('Hole complete — 5 strokes (Double bogey)');
  });
});
