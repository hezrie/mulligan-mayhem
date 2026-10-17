import type { GameState } from './game/state.ts';

/**
 * Stable hashing for determinism and golden-replay tests. FNV-1a 64-bit runs over the exact
 * IEEE-754 bit pattern of every number, so a one-ulp change produces a different hash.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

const TAG_NUMBER = 1;
const TAG_STRING = 2;

export function fnv1a64(bytes: Uint8Array): string {
  let h = FNV_OFFSET;
  for (const byte of bytes) {
    h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return h.toString(16).padStart(16, '0');
}

/** Encodes values unambiguously (type tag + payload; strings length-prefixed), then hashes. */
export function hashValues(values: readonly (number | string)[]): string {
  const out: number[] = [];
  const view = new DataView(new ArrayBuffer(8));
  const pushFloat = (n: number): void => {
    view.setFloat64(0, n, true);
    for (let i = 0; i < 8; i++) out.push(view.getUint8(i));
  };
  for (const value of values) {
    if (typeof value === 'number') {
      out.push(TAG_NUMBER);
      pushFloat(value);
    } else {
      out.push(TAG_STRING);
      pushFloat(value.length);
      for (let i = 0; i < value.length; i++) {
        const unit = value.charCodeAt(i);
        out.push(unit & 0xff, unit >>> 8);
      }
    }
  }
  return fnv1a64(Uint8Array.from(out));
}

/** Hash of the full game state in a fixed field order. Any behavioural change alters it. */
export function hashState(state: GameState): string {
  return hashValues([
    state.holeId,
    state.phase,
    state.strokes,
    state.step,
    state.rollSteps,
    state.rngState,
    state.ball.pos.x,
    state.ball.pos.y,
    state.ball.vel.x,
    state.ball.vel.y,
    state.lastRest.x,
    state.lastRest.y,
  ]);
}
