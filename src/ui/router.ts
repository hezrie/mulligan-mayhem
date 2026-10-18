/**
 * Pure screen router. The DOM shell feeds it button presses, hashchange and popstate, and mounts
 * whatever stack comes back. Kept DOM-free so it can be unit-tested in vitest's node environment.
 */

export type ScreenId = 'play' | 'menu' | 'settings' | 'pause' | 'how-to-play';

/** Screens bottom to top. Invariant: 1..5 distinct entries and stack[0] is always 'play'. */
export interface RouteState {
  readonly stack: readonly ScreenId[];
}

export type RouteAction =
  | { readonly type: 'open'; readonly screen: ScreenId }
  | { readonly type: 'back' }
  | { readonly type: 'reset'; readonly screen: ScreenId }
  | { readonly type: 'hash'; readonly hash: string }
  | { readonly type: 'pop'; readonly historyState: unknown; readonly hash: string };

export type HashTarget =
  | { readonly kind: 'screen'; readonly screen: HashScreen }
  | { readonly kind: 'reserved'; readonly key: ReservedKey; readonly payload: string }
  | { readonly kind: 'unknown' };

/** Screens with a URL; 'pause' and 'how-to-play' are overlays and have none. */
type HashScreen = 'play' | 'menu' | 'settings';
/** Ghost, challenge and hole links; their payloads belong to later epics. */
type ReservedKey = 'g' | 'c' | 'h';

const SCREENS: readonly ScreenId[] = ['play', 'menu', 'settings', 'pause', 'how-to-play'];
const HASH_SCREENS: readonly HashScreen[] = ['play', 'menu', 'settings'];
const RESERVED_KEYS: readonly ReservedKey[] = ['g', 'c', 'h'];

export const INITIAL_ROUTE: RouteState = freeze(['play']);

export function topScreen(state: RouteState): ScreenId {
  return state.stack[state.stack.length - 1] ?? 'play';
}

export function parseHash(hash: string): HashTarget {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  if (body === '' || body === '/') return { kind: 'screen', screen: 'play' };
  if (body.startsWith('/')) {
    const screen = HASH_SCREENS.find((s) => s === body.slice(1));
    return screen ? { kind: 'screen', screen } : { kind: 'unknown' };
  }
  const key = RESERVED_KEYS.find((k) => body.startsWith(`${k}=`));
  return key ? { kind: 'reserved', key, payload: body.slice(2) } : { kind: 'unknown' };
}

export function hashFor(state: RouteState): string {
  return `#/${hashScreen(state)}`;
}

export function route(state: RouteState, action: RouteAction): RouteState {
  switch (action.type) {
    case 'open': {
      const at = state.stack.indexOf(action.screen);
      return at === -1
        ? freeze([...state.stack, action.screen])
        : keep(state, state.stack.slice(0, at + 1));
    }
    case 'back':
      return state.stack.length > 1 ? freeze(state.stack.slice(0, -1)) : state;
    case 'reset':
      return keep(state, resetStack(action.screen));
    case 'hash': {
      const target = hashTargetScreen(action.hash);
      return target === hashScreen(state) ? state : keep(state, resetStack(target));
    }
    case 'pop': {
      const saved = savedStack(action.historyState);
      return keep(state, saved ?? resetStack(hashTargetScreen(action.hash)));
    }
  }
}

/** Top-most hash-addressable screen; 'play' is always at the root so there is one. */
function hashScreen(state: RouteState): HashScreen {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const screen = HASH_SCREENS.find((s) => s === state.stack[i]);
    if (screen) return screen;
  }
  return 'play';
}

function hashTargetScreen(hash: string): HashScreen {
  const target = parseHash(hash);
  return target.kind === 'screen' ? target.screen : 'play';
}

function resetStack(screen: ScreenId): ScreenId[] {
  return screen === 'play' ? ['play'] : ['play', screen];
}

/** The stack the shell saved with pushState, or null if the entry has none or it is malformed. */
function savedStack(historyState: unknown): ScreenId[] | null {
  if (typeof historyState !== 'object' || historyState === null) return null;
  const raw: unknown = (historyState as { mmStack?: unknown }).mmStack;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > SCREENS.length) return null;
  const stack: ScreenId[] = [];
  for (const entry of raw) {
    const screen = SCREENS.find((s) => s === entry);
    if (!screen || stack.includes(screen)) return null;
    stack.push(screen);
  }
  return stack[0] === 'play' ? stack : null;
}

/** Returns `state` itself when nothing changed, so the shell can skip re-rendering. */
function keep(state: RouteState, stack: readonly ScreenId[]): RouteState {
  const same = stack.length === state.stack.length && stack.every((s, i) => s === state.stack[i]);
  return same ? state : freeze(stack);
}

function freeze(stack: readonly ScreenId[]): RouteState {
  return Object.freeze({ stack: Object.freeze([...stack]) });
}
