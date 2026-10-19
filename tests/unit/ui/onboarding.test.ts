import { describe, expect, it } from 'vitest';
import type { GamePhase } from '../../../src/core/game/state.ts';
import { showOnboarding } from '../../../src/ui/onboarding.ts';

const PHASES: readonly GamePhase[] = ['aiming', 'rolling', 'holed'];

const rows = [true, false].flatMap((onboarded) =>
  PHASES.flatMap((phase) =>
    [0, 1].flatMap((strokes) =>
      [true, false].map((aimActive) => ({ onboarded, phase, strokes, aimActive })),
    ),
  ),
);

describe('showOnboarding', () => {
  it('covers all 24 rows of the truth table', () => {
    expect(rows).toHaveLength(24);
  });

  it.each(rows)(
    'onboarded=$onboarded phase=$phase strokes=$strokes aimActive=$aimActive',
    ({ onboarded, phase, strokes, aimActive }) => {
      const expected = !onboarded && phase === 'aiming' && strokes === 0 && !aimActive;
      expect(showOnboarding(onboarded, { phase, strokes }, aimActive)).toBe(expected);
    },
  );

  it('is true only for a fresh, idle, unshot ball', () => {
    expect(rows.filter((r) => showOnboarding(r.onboarded, r, r.aimActive))).toEqual([
      { onboarded: false, phase: 'aiming', strokes: 0, aimActive: false },
    ]);
  });
});
