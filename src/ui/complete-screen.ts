import type { Hole } from '../core/course/schema.ts';
import type { GameState } from '../core/game/state.ts';
import { completionMessage } from '../core/scoring/score.ts';

/** How long the dialog waits after the drop, so it does not cover the cup-plunk animation. */
export const COMPLETE_DELAY_MS = 900;

/** True once the hold after the drop has elapsed; never true before the ball has dropped. */
export function completeDialogDue(holedAtMs: number | null, nowMs: number): boolean {
  return holedAtMs !== null && nowMs - holedAtMs >= COMPLETE_DELAY_MS;
}

export interface CompleteScreen {
  /** `nowMs` is the frame's rAF timestamp. */
  update(state: Readonly<GameState>, hole: Hole, nowMs: number): void;
}

/** "Hole complete — 3 strokes (Par)" overlay with a Play again button. Reads state only. */
export function createCompleteScreen(root: HTMLElement, onRestart: () => void): CompleteScreen {
  const dialog = document.createElement('div');
  dialog.className = 'complete';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'complete-message');
  dialog.hidden = true;
  dialog.innerHTML = `
    <h2 id="complete-message" data-testid="complete-message"></h2>
    <button type="button" class="complete-restart">Play again</button>`;
  root.append(dialog);

  const message = dialog.querySelector('h2');
  const button = dialog.querySelector('button');
  if (!message || !button) throw new Error('Complete screen markup is broken');
  button.addEventListener('click', onRestart);

  let holedAtMs: number | null = null;

  return {
    update(state, hole, nowMs) {
      const holed = state.phase === 'holed';
      if (!holed) holedAtMs = null;
      else holedAtMs ??= nowMs;
      if (holed) {
        const text = completionMessage(state.strokes, hole.par);
        if (message.textContent !== text) message.textContent = text;
      }
      const show = completeDialogDue(holedAtMs, nowMs);
      if (dialog.hidden === show) {
        dialog.hidden = !show;
        if (show) button.focus();
      }
    },
  };
}
