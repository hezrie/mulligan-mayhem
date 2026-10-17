import { describe, expect, it } from 'vitest';
import { shareCardText } from '../../../../src/core/scoring/share-card.ts';

const holes = (strokes: readonly number[], pars: readonly number[]) =>
  strokes.map((s, i) => ({ strokes: s, par: pars[i] ?? 0 }));

describe('shareCardText', () => {
  it('returns exactly two lines: title with date, then emoji, two spaces and the total', () => {
    const text = shareCardText('2026-01-02', [{ strokes: 3, par: 3 }]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Mulligan Mayhem — 2026-01-02');
    expect(lines[1]).toBe('⬜  3 (E)');
  });

  it('uses scoreEmoji for each hole, one of each of the five emoji', () => {
    const text = shareCardText('2026-01-02', holes([2, 2, 3, 4, 6], [4, 3, 3, 3, 3]));
    expect(text.split('\n')[1]).toBe('🟦🟩⬜🟨🟥  17 (+1)');
  });

  it.each([
    [[16, 15], [15, 15], '31 (+1)'],
    [[14, 13], [14, 13], '27 (E)'],
    [[12, 13], [14, 13], '25 (-2)'],
  ] as const)('strokes %j on pars %j show the total as %s', (strokes, pars, total) => {
    const line = shareCardText('2026-01-02', holes(strokes, pars)).split('\n')[1];
    expect(line?.endsWith(`  ${total}`)).toBe(true);
  });

  it('reproduces the GAME_DESIGN.md example exactly', () => {
    const text = shareCardText(
      '2026-10-17',
      holes([2, 3, 4, 4, 3, 2, 3, 7, 3], [3, 3, 4, 3, 3, 4, 3, 4, 3]),
    );
    expect(text).toBe('Mulligan Mayhem — 2026-10-17\n🟩⬜⬜🟨⬜🟦⬜🟥⬜  31 (+1)');
  });

  it('throws for an empty hole list', () => {
    expect(() => shareCardText('2026-10-17', [])).toThrow(/at least one hole/);
  });

  it.each(['2026-1-7', '17-10-2026', '2026/10/17', '', '2026-10-17 ', 'x2026-10-17'])(
    'throws for a date %j not matching YYYY-MM-DD',
    (date) => {
      expect(() => shareCardText(date, [{ strokes: 3, par: 3 }])).toThrow(/YYYY-MM-DD/);
    },
  );

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'throws for strokes or par of %s',
    (bad) => {
      expect(() => shareCardText('2026-10-17', [{ strokes: bad, par: 3 }])).toThrow(
        /strokes.*positive integer/,
      );
      expect(() => shareCardText('2026-10-17', [{ strokes: 3, par: bad }])).toThrow(
        /par.*positive integer/,
      );
    },
  );
});
