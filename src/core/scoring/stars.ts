import { z } from 'zod';

/** Stars for one finished hole; the only progression currency (docs/GAME_DESIGN.md → unlock-economy). */
export type Stars = 1 | 2 | 3;

/** Best stars per hole id. */
export type BestStars = Readonly<Record<string, Stars>>;

/** Holes are authored with pars in this range; anything else is a caller bug. */
const MIN_PAR = 1;
const MAX_PAR = 6;

/** Strokes over par that still earn 2 stars (decision star-thresholds). */
const TWO_STAR_MAX_OVER_PAR = 2;

/** Same rule as the HoleSchema id, so stored keys always name a loadable hole. */
const HOLE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const HoleIdSchema = z.string().regex(HOLE_ID_PATTERN);
const StarsSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** 3 at or under par, 2 at par+1 or par+2, 1 for any other finish (a pick-up still finishes). */
export function starsFor(strokes: number, par: number): Stars {
  if (!Number.isInteger(strokes) || strokes < 1) {
    throw new RangeError(`starsFor: strokes must be a positive integer, got ${String(strokes)}`);
  }
  if (!Number.isInteger(par) || par < MIN_PAR || par > MAX_PAR) {
    throw new RangeError(
      `starsFor: par must be an integer from ${String(MIN_PAR)} to ${String(MAX_PAR)}, got ${String(par)}`,
    );
  }
  const overPar = strokes - par;
  if (overPar <= 0) return 3;
  if (overPar <= TWO_STAR_MAX_OVER_PAR) return 2;
  return 1;
}

export function starsAriaLabel(stars: Stars): string {
  return `${String(stars)} of 3 stars`;
}

/** Stars are never spent, so a worse round must never lower the recorded best. */
export function mergeBestStars(best: BestStars, holeId: string, stars: Stars): BestStars {
  const previous = best[holeId];
  const kept = previous !== undefined && previous > stars ? previous : stars;
  return { ...best, [holeId]: kept };
}

/** Untrusted save data: invalid entries are dropped one by one rather than failing the whole record. */
export function parseBestStars(data: unknown): BestStars {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const best: Record<string, Stars> = {};
  for (const [key, value] of Object.entries(data)) {
    const id = HoleIdSchema.safeParse(key);
    const stars = StarsSchema.safeParse(value);
    if (id.success && stars.success) best[id.data] = stars.data;
  }
  return best;
}

export function totalStars(best: BestStars): number {
  return Object.values(best).reduce((sum, stars) => sum + stars, 0);
}
