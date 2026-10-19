import { Rng, seedState } from '../rng.ts';
import type { Vec2 } from '../math/vec2.ts';
import { parseHole, type Hole } from './schema.ts';

/**
 * Daily Course hole generator. Every coordinate is an integer drawn from the seeded Rng, so the
 * output is exact on every engine (ADR 0001) and needs no trig. Bump GENERATOR_VERSION whenever
 * the output for any (seed, index) changes; shared links embed it (docs/GAME_DESIGN.md).
 */
export const GENERATOR_VERSION = 1;

/** Holes per Daily Course; valid indices are 0..HOLES_PER_COURSE-1. */
export const HOLES_PER_COURSE = 9;

// Portrait sizes in steps of 10, around the skeleton hole's phone-first 320×560.
const WIDTH_TENS = { min: 28, max: 36 };
const HEIGHT_TENS = { min: 48, max: 60 };
/** Tee and cup stay this far from the side walls: well clear of BALL_RADIUS and CUP_RADIUS. */
const EDGE_MARGIN = 30;
/** The cup sits this far from the top edge; the tee the same distance from the bottom. */
const END_BAND = { near: 40, far: 90 };
/** Interior walls stay this far from the top and bottom, so they never crowd the tee or cup. */
const WALL_BAND_INSET = 130;
const MAX_WALLS = 4;
/** Shortest wall, and the opening every wall leaves so the ball can get past it. */
const WALL_MIN_LENGTH = 80;
const WALL_MIN_GAP = 60;
const MAX_ZONES = 3;
const ZONE_KINDS = ['rough', 'sand'] as const;
const ZONE_SIZE = { min: 40, max: 160 };
const PAR_MIN = 2;
const PAR_MAX = 5;
/** A tee–cup drop longer than this needs an extra stroke. */
const LONG_HOLE = 400;
// Mixes the index into the seed (golden-ratio constant) so the nine holes get unrelated streams.
const INDEX_MIX = 0x9e3779b9;

/** Builds hole `index` (0–8) of the Daily Course for `seed`. Pure: same inputs, same hole. */
export function generateHole(seed: number, index: number): Hole {
  if (!Number.isInteger(index) || index < 0 || index >= HOLES_PER_COURSE) {
    throw new RangeError(`hole index must be an integer 0–8, got ${String(index)}`);
  }
  const rng = Rng.fromState(seedState(seed) ^ Math.imul(index + 1, INDEX_MIX));
  const width = rng.int(WIDTH_TENS.min, WIDTH_TENS.max) * 10;
  const height = rng.int(HEIGHT_TENS.min, HEIGHT_TENS.max) * 10;
  const tee = {
    x: rng.int(EDGE_MARGIN, width - EDGE_MARGIN),
    y: height - rng.int(END_BAND.near, END_BAND.far),
  };
  const cup = {
    x: rng.int(EDGE_MARGIN, width - EDGE_MARGIN),
    y: rng.int(END_BAND.near, END_BAND.far),
  };
  const walls = generateWalls(rng, width, height);
  const zones = generateZones(rng, width, height);
  const hasSand = zones.some((z) => z.kind === 'sand');
  const par =
    PAR_MIN +
    Math.floor(walls.length / 2) +
    (hasSand ? 1 : 0) +
    (tee.y - cup.y > LONG_HOLE ? 1 : 0);
  return parseHole({
    id: `daily-${String(seed >>> 0)}-${String(index + 1)}`,
    name: `Daily Hole ${String(index + 1)}`,
    par: Math.min(par, PAR_MAX),
    size: { width, height },
    boundary: rect(0, 0, width, height),
    walls,
    tee,
    cup,
    terrain: { base: 'fairway', zones },
  });
}

/** Horizontal walls in evenly spaced rows, each from a side wall part of the way across. */
function generateWalls(rng: Rng, width: number, height: number): { a: Vec2; b: Vec2 }[] {
  const count = rng.int(0, MAX_WALLS);
  const span = height - 2 * WALL_BAND_INSET;
  return Array.from({ length: count }, (_, k) => {
    const y = WALL_BAND_INSET + Math.floor(((k + 1) * span) / (count + 1));
    const length = rng.int(WALL_MIN_LENGTH, width - WALL_MIN_GAP);
    const fromLeft = rng.int(0, 1) === 0;
    return fromLeft
      ? { a: { x: 0, y }, b: { x: length, y } }
      : { a: { x: width - length, y }, b: { x: width, y } };
  });
}

/** Rough and sand rectangles inside the hole; never water, so tee and cup are always playable. */
function generateZones(
  rng: Rng,
  width: number,
  height: number,
): { kind: (typeof ZONE_KINDS)[number]; polygon: Vec2[] }[] {
  return Array.from({ length: rng.int(0, MAX_ZONES) }, () => {
    const kind = ZONE_KINDS[rng.int(0, ZONE_KINDS.length - 1)] ?? 'rough';
    const w = rng.int(ZONE_SIZE.min, ZONE_SIZE.max);
    const h = rng.int(ZONE_SIZE.min, ZONE_SIZE.max);
    const x = rng.int(0, width - w);
    const y = rng.int(0, height - h);
    return { kind, polygon: rect(x, y, x + w, y + h) };
  });
}

function rect(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

/** 32-bit FNV-1a over UTF-16 code units (one byte each for the ASCII dates it hashes). */
export function fnv1a32(text: string): number {
  let h = FNV32_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), FNV32_PRIME);
  }
  return h >>> 0;
}

/** The Daily seed for a "YYYY-MM-DD" date key. Which date is "today" is decided elsewhere. */
export function seedForDate(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError(`date must be YYYY-MM-DD, got "${date}"`);
  }
  return fnv1a32(date);
}
