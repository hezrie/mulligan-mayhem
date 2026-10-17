import { scoreEmoji } from './score.ts';

export interface HoleResult {
  readonly strokes: number;
  readonly par: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertPositiveInteger(value: number, name: string, index: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `shareCardText: hole ${String(index + 1)} ${name} must be a positive integer, got ${String(value)}`,
    );
  }
}

/** Golf convention: even par is written "E" rather than "+0". */
function formatVersusPar(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${String(diff)}` : String(diff);
}

/** The two-line emoji scorecard from docs/GAME_DESIGN.md → Share card. */
export function shareCardText(date: string, holes: readonly HoleResult[]): string {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`shareCardText: date must match YYYY-MM-DD, got "${date}"`);
  }
  if (holes.length === 0) {
    throw new Error('shareCardText: need at least one hole');
  }
  holes.forEach((hole, i) => {
    assertPositiveInteger(hole.strokes, 'strokes', i);
    assertPositiveInteger(hole.par, 'par', i);
  });

  const emoji = holes.map((h) => scoreEmoji(h.strokes, h.par)).join('');
  const strokes = holes.reduce((sum, h) => sum + h.strokes, 0);
  const par = holes.reduce((sum, h) => sum + h.par, 0);
  return `Mulligan Mayhem — ${date}\n${emoji}  ${String(strokes)} (${formatVersusPar(strokes - par)})`;
}
