/** A player's shot. angle in radians (0 = +x, π/2 = +y, down the screen); power in 0..1. */
export interface Shot {
  readonly angle: number;
  readonly power: number;
}

/** Releases weaker than this are treated as a cancelled aim, not a stroke. */
export const MIN_SHOT_POWER = 0.05;

export function isValidShot(shot: Shot): boolean {
  return Number.isFinite(shot.angle) && shot.power >= MIN_SHOT_POWER && shot.power <= 1;
}
