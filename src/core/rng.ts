/**
 * Seeded PRNG: mulberry32. It is the ONLY source of randomness in the game (ESLint bans
 * Math.random in core). It uses only 32-bit integer operations, so every engine produces the
 * same sequence. The state is a plain integer, so it can live in GameState and be hashed.
 */

export interface RandomResult {
  readonly value: number;
  readonly state: number;
}

/** Normalizes any number to a 32-bit integer state. */
export function seedState(seed: number): number {
  return Math.trunc(seed) | 0;
}

/** Next float in [0, 1) and the advanced state. */
export function nextFloat(state: number): RandomResult {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: s };
}

/** Next integer in [min, max] (inclusive) and the advanced state. */
export function nextInt(state: number, min: number, max: number): RandomResult {
  const r = nextFloat(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

/** Mutable convenience wrapper for generators and tests. */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = seedState(seed);
  }

  static fromState(state: number): Rng {
    const rng = new Rng(0);
    rng.#state = state;
    return rng;
  }

  get state(): number {
    return this.#state;
  }

  float(): number {
    const r = nextFloat(this.#state);
    this.#state = r.state;
    return r.value;
  }

  int(min: number, max: number): number {
    const r = nextInt(this.#state, min, max);
    this.#state = r.state;
    return r.value;
  }
}
