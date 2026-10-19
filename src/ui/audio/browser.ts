import type { AudioContextLike } from './context.ts';
import { createCueLog, createSoundscape, type CueLog, type Soundscape } from './cues.ts';
import {
  createAudioEngine,
  type AudioEngineState,
  type ListenerTarget,
  type VisibilitySource,
} from './engine.ts';

type AudioContextConstructor = new () => AudioContextLike;

/** The slice of `window` sound needs, so Node tests can pass a fake. */
export interface SoundWindow extends ListenerTarget {
  readonly AudioContext?: AudioContextConstructor;
  /** Safari before 14.1 only has the prefixed constructor. */
  readonly webkitAudioContext?: AudioContextConstructor;
  readonly document: VisibilitySource;
}

export interface BrowserSoundscape {
  readonly soundscape: Soundscape;
  readonly cueLog: CueLog;
  readonly debugState: () => { readonly engine: AudioEngineState };
}

export function createBrowserSoundscape(win: SoundWindow): BrowserSoundscape {
  const engine = createAudioEngine({
    createContext() {
      const Ctor = win.AudioContext ?? win.webkitAudioContext;
      // The engine catches this and stays 'unavailable'.
      if (Ctor === undefined) throw new Error('Web Audio is not supported');
      return new Ctor();
    },
  });
  engine.attachUnlock(win);
  engine.attachVisibility(win.document);
  const cueLog = createCueLog();
  return {
    soundscape: createSoundscape({ engine, log: cueLog }),
    cueLog,
    debugState: () => ({ engine: engine.state() }),
  };
}
