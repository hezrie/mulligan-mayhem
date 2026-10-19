import type { AudioContextLike } from './context.ts';
import { createCueLog, createSoundscape, type CueLog, type Soundscape } from './cues.ts';
import {
  createAudioEngine,
  type AudioEngineState,
  type ListenerTarget,
  type VisibilitySource,
} from './engine.ts';
import { createHaptics, type Haptics } from './haptics.ts';

type AudioContextConstructor = new () => AudioContextLike;

/** `navigator` in the browser; haptics read only `vibrate`, which iOS Safari lacks. */
export interface VibrateSource {
  vibrate?(pattern: VibratePattern): unknown;
}

/** The slice of `window` sound needs, so Node tests can pass a fake. */
export interface SoundWindow extends ListenerTarget {
  readonly AudioContext?: AudioContextConstructor;
  /** Safari before 14.1 only has the prefixed constructor. */
  readonly webkitAudioContext?: AudioContextConstructor;
  readonly document: VisibilitySource;
  readonly navigator?: VibrateSource;
}

export interface BrowserSoundscape {
  readonly soundscape: Soundscape;
  readonly cueLog: CueLog;
  readonly haptics: Haptics;
  readonly debugState: () => { readonly engine: AudioEngineState };
}

const ARM_OPTIONS = { capture: true } as const;

function createBrowserHaptics(win: SoundWindow): Haptics {
  const nav = win.navigator;
  // Called as a method: a detached `vibrate` throws 'Illegal invocation'.
  const haptics = createHaptics(
    nav?.vibrate === undefined ? {} : { vibrate: (pattern) => nav.vibrate?.(pattern) },
  );
  // Armed by the press, not by audio: Chrome blocks vibration before user activation, and a page
  // without Web Audio should still buzz. Capture runs before the canvas aim handler, so the press
  // that grabs the ball already arms it.
  const arm = (): void => {
    haptics.arm();
    win.removeEventListener('pointerdown', arm, ARM_OPTIONS);
  };
  win.addEventListener('pointerdown', arm, ARM_OPTIONS);
  return haptics;
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
  const haptics = createBrowserHaptics(win);
  return {
    soundscape: createSoundscape({ engine, log: cueLog, haptics }),
    cueLog,
    haptics,
    debugState: () => ({ engine: engine.state() }),
  };
}
