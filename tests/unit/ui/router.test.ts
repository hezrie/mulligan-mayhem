import { describe, expect, it } from 'vitest';
import {
  INITIAL_ROUTE,
  hashFor,
  parseHash,
  route,
  topScreen,
  type RouteState,
  type ScreenId,
} from '../../../src/ui/router.ts';

/** Deep-frozen input state, so any mutation by route() throws. */
function frozen(...stack: ScreenId[]): RouteState {
  return Object.freeze({ stack: Object.freeze(stack) });
}

describe('router environment', () => {
  it('runs without a DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof history).toBe('undefined');
    expect(typeof location).toBe('undefined');
  });
});

describe('INITIAL_ROUTE', () => {
  it('is a frozen play-only stack', () => {
    expect(INITIAL_ROUTE.stack).toEqual(['play']);
    expect(Object.isFrozen(INITIAL_ROUTE)).toBe(true);
    expect(Object.isFrozen(INITIAL_ROUTE.stack)).toBe(true);
    expect(topScreen(INITIAL_ROUTE)).toBe('play');
  });
});

describe('route: open', () => {
  it('pushes a new screen on top', () => {
    const next = route(INITIAL_ROUTE, { type: 'open', screen: 'pause' });
    expect(next.stack).toEqual(['play', 'pause']);
    expect(topScreen(next)).toBe('pause');
  });

  it('returns the same object when the screen is already on top', () => {
    expect(route(INITIAL_ROUTE, { type: 'open', screen: 'play' })).toBe(INITIAL_ROUTE);
    const s = frozen('play', 'pause');
    expect(route(s, { type: 'open', screen: 'pause' })).toBe(s);
  });

  it.each<[ScreenId[], ScreenId, ScreenId[]]>([
    [['play', 'pause', 'settings'], 'pause', ['play', 'pause']],
    [['play', 'pause'], 'play', ['play']],
  ])('truncates %j back to %s', (stack, screen, expected) => {
    expect(route(frozen(...stack), { type: 'open', screen }).stack).toEqual(expected);
  });
});

describe('route: back and reset', () => {
  it('pops one entry', () => {
    const next = route(frozen('play', 'pause', 'settings'), { type: 'back' });
    expect(next.stack).toEqual(['play', 'pause']);
  });

  it('never pops the play root', () => {
    expect(route(INITIAL_ROUTE, { type: 'back' })).toBe(INITIAL_ROUTE);
    const s = frozen('play');
    expect(route(s, { type: 'back' })).toBe(s);
  });

  it.each<[ScreenId, ScreenId[]]>([
    ['menu', ['play', 'menu']],
    ['play', ['play']],
  ])('reset to %s gives %j', (screen, expected) => {
    expect(route(frozen('play', 'pause'), { type: 'reset', screen }).stack).toEqual(expected);
  });
});

describe('parseHash', () => {
  it.each([
    ['', { kind: 'screen', screen: 'play' }],
    ['#', { kind: 'screen', screen: 'play' }],
    ['#/', { kind: 'screen', screen: 'play' }],
    ['#/play', { kind: 'screen', screen: 'play' }],
    ['#/menu', { kind: 'screen', screen: 'menu' }],
    ['#/settings', { kind: 'screen', screen: 'settings' }],
    ['#g=AbC-1', { kind: 'reserved', key: 'g', payload: 'AbC-1' }],
    ['#c=', { kind: 'reserved', key: 'c', payload: '' }],
    ['#h=x', { kind: 'reserved', key: 'h', payload: 'x' }],
    ['#/pause', { kind: 'unknown' }],
    ['#/how-to-play', { kind: 'unknown' }],
    ['#/MENU', { kind: 'unknown' }],
    ['#/nope', { kind: 'unknown' }],
    ['#x=1', { kind: 'unknown' }],
  ])('parses %j', (hash, expected) => {
    expect(parseHash(hash)).toEqual(expected);
  });
});

describe('route: hash', () => {
  it.each<[string, ScreenId[]]>([
    ['#/play', ['play']],
    ['#g=abc', ['play']],
    ['#/nope', ['play']],
    ['#/menu', ['play', 'menu']],
    ['#/settings', ['play', 'settings']],
  ])('%s resolves to %j', (hash, expected) => {
    expect(route(frozen('play', 'menu'), { type: 'hash', hash }).stack).toEqual(expected);
  });

  it('is a no-op when the hash already matches, ignoring overlays', () => {
    const s = frozen('play', 'pause');
    expect(route(s, { type: 'hash', hash: '#/play' })).toBe(s);
    const m = frozen('play', 'menu', 'how-to-play');
    expect(route(m, { type: 'hash', hash: '#/menu' })).toBe(m);
    expect(route(INITIAL_ROUTE, { type: 'hash', hash: '#g=x' })).toBe(INITIAL_ROUTE);
  });
});

describe('route: pop', () => {
  it.each<[unknown, string, ScreenId[], ScreenId[]]>([
    [{ mmStack: ['play', 'pause'] }, '#/play', ['play', 'pause', 'settings'], ['play', 'pause']],
    [null, '', ['play', 'pause'], ['play']],
    [null, '#/menu', ['play', 'menu', 'how-to-play'], ['play', 'menu']],
    [null, '#/settings', ['play'], ['play', 'settings']],
    [null, '#g=x', ['play', 'menu'], ['play']],
  ])('(%j, %j) from %j gives %j', (historyState, hash, stack, expected) => {
    expect(route(frozen(...stack), { type: 'pop', historyState, hash }).stack).toEqual(expected);
  });

  it('works from INITIAL_ROUTE', () => {
    const next = route(INITIAL_ROUTE, { type: 'pop', historyState: null, hash: '#/settings' });
    expect(next.stack).toEqual(['play', 'settings']);
    const reserved = route(INITIAL_ROUTE, { type: 'pop', historyState: null, hash: '#g=x' });
    expect(reserved.stack).toEqual(['play']);
  });

  it.each([
    [undefined],
    [42],
    ['x'],
    [{}],
    [{ mmStack: 'x' }],
    [{ mmStack: [] }],
    [{ mmStack: ['menu'] }],
    [{ mmStack: ['play', 'nope'] }],
    [{ mmStack: ['play', 'pause', 'pause'] }],
  ])('falls back to the hash for invalid historyState %j', (historyState) => {
    const next = route(frozen('play', 'pause'), { type: 'pop', historyState, hash: '#/menu' });
    expect(next.stack).toEqual(['play', 'menu']);
  });

  it('returns the same object when the restored stack is unchanged', () => {
    const s = frozen('play', 'pause');
    const restored = { mmStack: ['play', 'pause'] };
    expect(route(s, { type: 'pop', historyState: restored, hash: '#/play' })).toBe(s);
    expect(route(s, { type: 'pop', historyState: null, hash: '#/play' }).stack).toEqual(['play']);
    expect(route(INITIAL_ROUTE, { type: 'pop', historyState: null, hash: '' })).toBe(INITIAL_ROUTE);
  });

  it('does not share the history array with the result', () => {
    const mmStack: string[] = ['play', 'menu'];
    const next = route(INITIAL_ROUTE, { type: 'pop', historyState: { mmStack }, hash: '' });
    mmStack.push('pause');
    expect(next.stack).toEqual(['play', 'menu']);
  });
});

describe('hashFor', () => {
  it.each<[ScreenId[], string]>([
    [['play'], '#/play'],
    [['play', 'menu', 'pause'], '#/menu'],
    [['play', 'settings'], '#/settings'],
  ])('%j gives %s', (stack, expected) => {
    expect(hashFor(frozen(...stack))).toBe(expected);
  });

  it.each<ScreenId>(['play', 'menu', 'settings'])('round-trips %s through parseHash', (s) => {
    const state = route(INITIAL_ROUTE, { type: 'reset', screen: s });
    expect(parseHash(hashFor(state))).toEqual({ kind: 'screen', screen: s });
  });
});
