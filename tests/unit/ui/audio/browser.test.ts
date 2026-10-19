import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { createBrowserSoundscape, type SoundWindow } from '../../../../src/ui/audio/browser.ts';
import { FakeAudioContext } from '../../../helpers/fake-audio-context.ts';

function countingContext() {
  const made: FakeAudioContext[] = [];
  class CountingAudioContext extends FakeAudioContext {
    constructor() {
      super();
      made.push(this);
    }
  }
  return { CountingAudioContext, made };
}

const fakeDocument = () => Object.assign(new EventTarget(), { hidden: false });

let consoleError: MockInstance;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).toHaveBeenCalledTimes(0);
  consoleError.mockRestore();
});

describe('createBrowserSoundscape', () => {
  it('builds no context until a pointerdown on the window, then exactly one', () => {
    const { CountingAudioContext, made } = countingContext();
    const win = Object.assign(new EventTarget(), {
      AudioContext: CountingAudioContext,
      document: fakeDocument(),
    });
    const { debugState } = createBrowserSoundscape(win);
    expect(made).toHaveLength(0);
    expect(debugState()).toEqual({ engine: 'locked' });
    win.dispatchEvent(new Event('pointerdown'));
    win.dispatchEvent(new Event('pointerdown'));
    expect(made).toHaveLength(1);
    expect(debugState()).toEqual({ engine: 'running' });
  });

  it('falls back to webkitAudioContext', () => {
    const { CountingAudioContext, made } = countingContext();
    const win = Object.assign(new EventTarget(), {
      webkitAudioContext: CountingAudioContext,
      document: fakeDocument(),
    });
    const { debugState } = createBrowserSoundscape(win);
    win.dispatchEvent(new Event('pointerdown'));
    expect(made).toHaveLength(1);
    expect(debugState().engine).toBe('running');
  });

  it('is unavailable without any AudioContext, and nothing throws', () => {
    const win = Object.assign(new EventTarget(), { document: fakeDocument() });
    const { debugState } = createBrowserSoundscape(win);
    expect(() => win.dispatchEvent(new Event('pointerdown'))).not.toThrow();
    expect(debugState().engine).toBe('unavailable');
  });

  it('attaches visibility to the document', () => {
    const { CountingAudioContext, made } = countingContext();
    const document = fakeDocument();
    const win = Object.assign(new EventTarget(), { AudioContext: CountingAudioContext, document });
    const { debugState } = createBrowserSoundscape(win);
    win.dispatchEvent(new Event('pointerdown'));
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(debugState().engine).toBe('suspended');
    expect(made[0]?.suspendCalls).toBe(1);
  });

  it('accepts the real browser window type', () => {
    expectTypeOf<Window & typeof globalThis>().toExtend<SoundWindow>();
  });

  it('logs soundscape cues to a fresh cue log', () => {
    const win = Object.assign(new EventTarget(), { document: fakeDocument() });
    const { soundscape, cueLog } = createBrowserSoundscape(win);
    expect(cueLog.entries()).toEqual([]);
    soundscape.handle({ type: 'cup' }, { step: 4, par: 3 });
    expect(cueLog.entries()).toEqual([{ channel: 'sfx', cue: 'cup', step: 4 }]);
  });
});

describe('createBrowserSoundscape haptics', () => {
  /** A navigator whose vibrate throws 'Illegal invocation' unless called as its method. */
  function fakeNavigator() {
    const calls: unknown[] = [];
    const navigator = {
      vibrate(this: unknown, pattern: VibratePattern): boolean {
        if (this !== navigator) throw new TypeError('Illegal invocation');
        calls.push(pattern);
        return true;
      },
    };
    return { navigator, calls };
  }

  it('pulses nothing until the first pointerdown on the window', () => {
    const { navigator, calls } = fakeNavigator();
    const win = Object.assign(new EventTarget(), { navigator, document: fakeDocument() });
    const { soundscape, haptics } = createBrowserSoundscape(win);
    soundscape.handle({ type: 'shot', power: 0.925 }, { step: 0, par: 3 });
    expect(calls).toEqual([]);

    win.dispatchEvent(new Event('pointerdown'));
    soundscape.handle({ type: 'shot', power: 0.925 }, { step: 1, par: 3 });
    soundscape.handle({ type: 'holed', strokes: 1 }, { step: 2, par: 3 });
    expect(calls).toEqual([24, [30, 60, 30, 60, 120]]);
    expect(haptics.enabled()).toBe(true);
  });

  it('arms on pointerdown in the capture phase', () => {
    const { navigator, calls } = fakeNavigator();
    const win = Object.assign(new EventTarget(), { navigator, document: fakeDocument() });
    // Only capture-phase listeners are registered, so arming must come from one of them.
    const register = win.addEventListener.bind(win);
    vi.spyOn(win, 'addEventListener').mockImplementation((type, listener, options) => {
      if (typeof options === 'object' && options.capture === true) {
        register(type, listener, options);
      }
    });
    const { soundscape } = createBrowserSoundscape(win);
    win.dispatchEvent(new Event('pointerdown'));
    soundscape.handle({ type: 'shot', power: 1 }, { step: 0, par: 3 });
    expect(calls).toEqual([25]);
  });

  it('builds without navigator.vibrate, and its shots pulse nothing', () => {
    const win = Object.assign(new EventTarget(), { navigator: {}, document: fakeDocument() });
    const { soundscape } = createBrowserSoundscape(win);
    expect(() => {
      win.dispatchEvent(new Event('pointerdown'));
      soundscape.handle({ type: 'shot', power: 1 }, { step: 0, par: 3 });
    }).not.toThrow();
  });
});
