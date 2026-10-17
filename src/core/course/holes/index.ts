/**
 * The hole registry. Every hole is JSON data validated against HoleSchema when this module
 * loads, so a malformed hole fails the test suite immediately. To add a hole: create
 * `<id>.json` here, import it, and add it to RAW_HOLES.
 */
import { parseHole, type Hole } from '../schema.ts';
import skeleton01 from './skeleton-01.json';

const RAW_HOLES: readonly unknown[] = [skeleton01];

export const DEFAULT_HOLE_ID = 'skeleton-01';

export class UnknownHoleError extends Error {
  override readonly name = 'UnknownHoleError';
}

/** Validates every raw hole and indexes it by id. Throws on invalid data or duplicate ids. */
export function buildHoleRegistry(rawHoles: readonly unknown[]): ReadonlyMap<string, Hole> {
  const map = new Map<string, Hole>();
  for (const raw of rawHoles) {
    const hole = parseHole(raw);
    if (map.has(hole.id)) throw new Error(`Duplicate hole id "${hole.id}"`);
    map.set(hole.id, hole);
  }
  return map;
}

const HOLES = buildHoleRegistry(RAW_HOLES);

export function getHole(id: string): Hole {
  const hole = HOLES.get(id);
  if (!hole) throw new UnknownHoleError(`Unknown hole "${id}". Known: ${listHoleIds().join(', ')}`);
  return hole;
}

export function listHoleIds(): string[] {
  return [...HOLES.keys()];
}
