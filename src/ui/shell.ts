import { hashFor, INITIAL_ROUTE, route, topScreen } from './router.ts';
import type { RouteAction, RouteState, ScreenId } from './router.ts';
import type { Nav, Screen } from './screen.ts';
import { createMenuScreen } from './screens/menu.ts';
import { createPauseScreen } from './screens/pause.ts';
import { createSettingsScreen } from './screens/settings.ts';
import type { SettingsStore } from './settings-store.ts';

/** Screens with a view. 'play' is the canvas itself; ids without an entry mount nothing yet. */
const SCREENS: Partial<Record<ScreenId, (nav: Nav, deps: ShellDeps) => Screen>> = {
  menu: createMenuScreen,
  settings: (nav, deps) => createSettingsScreen(nav, deps.settings),
  pause: (nav, deps) => createPauseScreen(nav, deps.restart),
};

export interface ShellDeps {
  readonly window: Window;
  /** The page's one settings store; screens must reuse it, never create their own. */
  readonly settings: SettingsStore;
  /** Restarts the current hole; the pause screen's Restart hole calls it. */
  readonly restart: () => void;
}

export interface Shell {
  readonly nav: Nav;
  /** True whenever a screen covers play; the frame loop must not advance the simulation then. */
  isPaused(): boolean;
}

/**
 * Keeps the route stack in step with the browser history and mounts the top screen. History
 * entries carry `{ mmStack, mmDepth }` so Back restores overlays and knows if it may leave the app.
 */
export function createShell(app: HTMLElement, deps: ShellDeps): Shell {
  const { history, location } = deps.window;
  const depth = (): number => {
    const raw: unknown = (history.state as { mmDepth?: unknown } | null)?.mmDepth;
    return typeof raw === 'number' ? raw : 0;
  };

  let state: RouteState = INITIAL_ROUTE;
  let mounted: { readonly id: ScreenId; readonly screen: Screen; readonly el: HTMLElement } | null =
    null;

  const render = (): void => {
    const id = topScreen(state);
    if (mounted?.id === id) return;
    if (mounted) {
      mounted.screen.unmount();
      mounted.el.remove();
      mounted = null;
    }
    const create = SCREENS[id];
    if (!create) return;
    const el = document.createElement('section');
    el.className = 'screen';
    el.dataset['testid'] = `screen-${id}`;
    const screen = create(nav, deps);
    screen.mount(el);
    app.append(el);
    mounted = { id, screen, el };
  };

  const dispatch = (action: RouteAction): void => {
    state = route(state, action);
    render();
  };
  const save = (mmDepth: number): { mmStack: readonly ScreenId[]; mmDepth: number } => ({
    mmStack: state.stack,
    mmDepth,
  });

  const nav: Nav = {
    open(id) {
      const next = depth() + 1;
      dispatch({ type: 'open', screen: id });
      history.pushState(save(next), '', hashFor(state));
    },
    reset(id) {
      const kept = depth();
      dispatch({ type: 'reset', screen: id });
      history.replaceState(save(kept), '', hashFor(state));
    },
    back() {
      if (depth() > 0) {
        history.back();
        return;
      }
      dispatch({ type: 'back' });
      history.replaceState(save(0), '', hashFor(state));
    },
  };

  deps.window.addEventListener('popstate', (event) => {
    dispatch({ type: 'pop', historyState: event.state, hash: location.hash });
  });
  deps.window.addEventListener('hashchange', () => {
    dispatch({ type: 'hash', hash: location.hash });
  });

  // Never rewrite the URL on boot: the root URL must stay hash-free and land in play.
  dispatch({ type: 'pop', historyState: history.state, hash: location.hash });
  return { nav, isPaused: () => topScreen(state) !== 'play' };
}
