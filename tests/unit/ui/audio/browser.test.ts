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
