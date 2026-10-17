/** Score categories used for the share card. Hole in one is named separately on screen. */
export type ScoreName = 'hole-in-one' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double-bogey';

export function scoreName(strokes: number, par: number): ScoreName {
  if (strokes === 1) return 'hole-in-one';
  const diff = strokes - par;
  if (diff <= -2) return 'eagle';
  if (diff === -1) return 'birdie';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  return 'double-bogey';
}

/** Share-card emoji. It always follows strokes versus par (docs/GAME_DESIGN.md). */
export function scoreEmoji(strokes: number, par: number): string {
  const diff = strokes - par;
  if (diff <= -2) return '🟦';
  if (diff === -1) return '🟩';
  if (diff === 0) return '⬜';
  if (diff === 1) return '🟨';
  return '🟥';
}

const LABELS: Readonly<Record<number, string>> = {
  [-3]: 'Albatross',
  [-2]: 'Eagle',
  [-1]: 'Birdie',
  0: 'Par',
  1: 'Bogey',
  2: 'Double bogey',
  3: 'Triple bogey',
};

/** Human label for the hole-complete screen. */
export function scoreLabel(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const diff = strokes - par;
  return LABELS[diff] ?? (diff > 0 ? `+${String(diff)}` : String(diff));
}

/** e.g. "Hole complete — 3 strokes (Par)". */
export function completionMessage(strokes: number, par: number): string {
  const unit = strokes === 1 ? 'stroke' : 'strokes';
  return `Hole complete — ${String(strokes)} ${unit} (${scoreLabel(strokes, par)})`;
}
