import { z } from 'zod';

/** Same shape as HoleSchema's id, capped so a hand-edited save cannot hold huge keys. */
const HoleIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const FlagKeySchema = z.string().regex(/^[a-z0-9.-]{1,40}$/);

/** A finished hole always earns at least 1 star (star-thresholds), so 0 stars is corrupt. */
const BestSchema = z.object({
  strokes: z.int().min(1).max(99),
  stars: z.int().min(1).max(3),
});

/**
 * Save profile v1. Missing fields default so older or partial saves load; any present but
 * invalid value fails the whole parse, so the caller can set the corrupt save aside instead of
 * silently dropping progress. Kept apart from GameState so it never affects hashState.
 */
export const SaveSchema = z.object({
  version: z.literal(1).default(1),
  best: z.record(HoleIdSchema, BestSchema).default(() => ({})),
  flags: z.record(FlagKeySchema, z.literal(true)).default(() => ({})),
});

export type Save = z.infer<typeof SaveSchema>;
export type Best = z.infer<typeof BestSchema>;

export interface ParsedSave {
  readonly save: Save;
  readonly corrupt: boolean;
}

export interface BestResult extends Best {
  readonly holeId: string;
}

export function emptySave(): Save {
  return { version: 1, best: {}, flags: {} };
}

/** Never throws: anything that is not a valid v1 save becomes an empty save marked corrupt. */
export function parseSave(raw: unknown): ParsedSave {
  const result = SaveSchema.safeParse(raw);
  return result.success
    ? { save: result.data, corrupt: false }
    : { save: emptySave(), corrupt: true };
}

/** Strokes and stars improve independently; invalid input leaves the save untouched (same object). */
export function mergeBest(save: Save, { holeId, strokes, stars }: BestResult): Save {
  const valid =
    HoleIdSchema.safeParse(holeId).success && BestSchema.safeParse({ strokes, stars }).success;
  if (!valid) return save;
  // hasOwn: a valid id such as 'constructor' must not read Object.prototype.
  const old = Object.hasOwn(save.best, holeId) ? save.best[holeId] : undefined;
  const best = old
    ? { strokes: Math.min(old.strokes, strokes), stars: Math.max(old.stars, stars) }
    : { strokes, stars };
  return { ...save, best: { ...save.best, [holeId]: best } };
}

export function hasFlag(save: Save, key: string): boolean {
  return save.flags[key] === true;
}

/** Invalid keys leave the save untouched (same object), so callers can't write an unloadable save. */
export function setFlag(save: Save, key: string): Save {
  if (!FlagKeySchema.safeParse(key).success) return save;
  return { ...save, flags: { ...save.flags, [key]: true } };
}
