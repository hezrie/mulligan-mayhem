import type { GameState } from './state.ts';

/**
 * Strokes over par after which an unholed hole ends (docs/GAME_DESIGN.md → pick-up-rule), so a
 * struggling player always finishes the round. Classic and Daily always use this; Party House
 * Rules may pass 3, or null for no cap.
 */
export const PICK_UP_OVER_PAR = 4;

/**
 * True once the ball is at rest, unholed, after stroke par + overPar. Lives outside GameState and
 * the phase machine so hashState and every golden replay stay unchanged.
 */
export function shouldPickUp(
  state: Readonly<GameState>,
  par: number,
  overPar: number | null = PICK_UP_OVER_PAR,
): boolean {
  return overPar !== null && state.phase === 'aiming' && state.strokes >= par + overPar;
}

/** A picked-up hole counts one more than the cap, so it never ties a finished hole. */
export function pickUpStrokes(par: number, overPar: number = PICK_UP_OVER_PAR): number {
  return par + overPar + 1;
}

/** e.g. "Picked up — counts as 8 (+5)". */
export function pickUpMessage(par: number, overPar: number = PICK_UP_OVER_PAR): string {
  const strokes = pickUpStrokes(par, overPar);
  return `Picked up — counts as ${String(strokes)} (+${String(strokes - par)})`;
}
