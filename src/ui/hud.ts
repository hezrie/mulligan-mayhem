import type { Hole } from '../core/course/schema.ts';
import type { GameState } from '../core/game/state.ts';

export interface Hud {
  update(state: Readonly<GameState>, hole: Hole): void;
}

/** Top bar: hole name, par, stroke counter and a restart button. Reads state only. */
export function createHud(root: HTMLElement, onRestart: () => void): Hud {
  const bar = document.createElement('header');
  bar.className = 'hud';
  bar.innerHTML = `
    <span class="hud-hole" data-testid="hole-name"></span>
    <span class="hud-par">Par <b data-testid="par"></b></span>
    <span class="hud-strokes">Strokes <b data-testid="strokes"></b></span>
    <button type="button" class="hud-restart" aria-label="Restart hole">↺</button>`;
  root.append(bar);

  const field = (id: string): HTMLElement => {
    const el = bar.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`HUD is missing ${id}`);
    return el;
  };
  const name = field('hole-name');
  const par = field('par');
  const strokes = field('strokes');
  bar.querySelector('button')?.addEventListener('click', onRestart);

  let last = '';
  return {
    update(state, hole) {
      const key = `${hole.name}|${String(hole.par)}|${String(state.strokes)}`;
      if (key === last) return;
      last = key;
      name.textContent = hole.name;
      par.textContent = String(hole.par);
      strokes.textContent = String(state.strokes);
    },
  };
}
