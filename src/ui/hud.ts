import type { Hole } from '../core/course/schema.ts';
import type { GameState } from '../core/game/state.ts';

export interface Hud {
  update(state: Readonly<GameState>, hole: Hole): void;
}

/** Top bar: hole name, par, stroke counter, a restart and a ☰ menu button. Reads state only. */
export function createHud(root: HTMLElement, onRestart: () => void, onMenu: () => void): Hud {
  const bar = document.createElement('header');
  bar.className = 'hud';
  bar.innerHTML = `
    <span class="hud-hole" data-testid="hole-name"></span>
    <span class="hud-par">Par <b data-testid="par"></b></span>
    <span class="hud-strokes">Strokes <b data-testid="strokes"></b></span>
    <button type="button" class="hud-restart" aria-label="Restart hole">↺</button>
    <button type="button" class="hud-menu" aria-label="Menu" data-testid="hud-menu">☰</button>`;
  root.append(bar);

  const field = (id: string): HTMLElement => {
    const el = bar.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) throw new Error(`HUD is missing ${id}`);
    return el;
  };
  const name = field('hole-name');
  const par = field('par');
  const strokes = field('strokes');
  bar.querySelector('.hud-restart')?.addEventListener('click', onRestart);
  bar.querySelector('.hud-menu')?.addEventListener('click', onMenu);

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
