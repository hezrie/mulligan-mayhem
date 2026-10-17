import type { Hole } from '../core/course/schema.ts';
import type { GameState } from '../core/game/state.ts';
import { completionMessage } from '../core/scoring/score.ts';

export interface CompleteScreen {
  update(state: Readonly<GameState>, hole: Hole): void;
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

  return {
    update(state, hole) {
      const holed = state.phase === 'holed';
      if (holed) {
        const text = completionMessage(state.strokes, hole.par);
        if (message.textContent !== text) message.textContent = text;
      }
      if (dialog.hidden === holed) {
        dialog.hidden = !holed;
        if (holed) button.focus();
      }
    },
  };
}
