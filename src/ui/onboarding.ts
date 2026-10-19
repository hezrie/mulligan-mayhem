import { hasFlag, setFlag } from '../core/game/save.ts';
import type { GameState } from '../core/game/state.ts';
import type { SaveStore } from './save-store.ts';

const ONBOARDED_FLAG = 'onboarded';
const CAPTION = 'Drag back from the ball, then let go';

/** Only a first-timer's idle ball, before any stroke, gets the hint; a drag in progress hides it. */
export function showOnboarding(
  onboarded: boolean,
  state: Readonly<Pick<GameState, 'phase' | 'strokes'>>,
  aimActive: boolean,
): boolean {
  return !onboarded && state.phase === 'aiming' && state.strokes === 0 && !aimActive;
}

export interface Onboarding {
  update(state: Readonly<GameState>, aimActive: boolean): void;
  /** The ghost-hand clock while the hint shows, else null (renderer.draw's hint argument). */
  hint(nowMs: number): Readonly<{ tMs: number }> | null;
  /** Only pointer shots count: the test API's shots must never mark the player as onboarded. */
  markRealShot(): void;
}

/** The caption is DOM, not canvas text, so it follows the text size and never takes pointers. */
export function createOnboarding(root: HTMLElement, saves: SaveStore): Onboarding {
  const caption = document.createElement('p');
  caption.className = 'onboarding-caption';
  caption.setAttribute('data-testid', 'onboarding-caption');
  caption.textContent = CAPTION;
  caption.hidden = true;
  root.append(caption);

  // Kept in memory too, so blocked storage still hides the hint for the rest of the session.
  let onboarded = hasFlag(saves.get(), ONBOARDED_FLAG);
  let shownSinceMs: number | null = null;

  return {
    update(state, aimActive) {
      const show = showOnboarding(onboarded, state, aimActive);
      if (!show) shownSinceMs = null;
      if (caption.hidden === show) caption.hidden = !show;
    },
    hint(nowMs) {
      if (caption.hidden) return null;
      shownSinceMs ??= nowMs;
      return { tMs: nowMs - shownSinceMs };
    },
    markRealShot() {
      onboarded = true;
      saves.update((s) => setFlag(s, ONBOARDED_FLAG));
    },
  };
}
