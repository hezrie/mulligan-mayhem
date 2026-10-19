import type { AudioContextLike, GainNodeLike } from './context.ts';
import { playVoice } from './play-voice.ts';
import type { Voice } from './voices.ts';

// The default sound-effects volume (decision settings-defaults), on the 0..100 settings scale.
const DEFAULT_VOLUME = 70;
const MAX_VOLUME = 100;
// Volume snaps to steps of 10 so the gain is always a short decimal like 0.4.
const VOLUME_STEP = 10;
// The sfx bus sits at unity when on; per-voice levels live in the voice recipes.
const SFX_BUS_ON = 1;
const SFX_BUS_OFF = 0;
// Capture phase so a handler that stops propagation can't keep the audio locked.
const LISTENER_OPTIONS = { capture: true } as const;

export type AudioEngineState = 'locked' | 'running' | 'suspended' | 'unavailable';

export type ListenerTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** `document` in the browser; the engine reads only `hidden`. */
export interface VisibilitySource extends ListenerTarget {
  readonly hidden: boolean;
}

export interface AudioEngineOptions {
  /** Builds the context. Called at most once, lazily inside a gesture, so browsers allow sound. */
  readonly createContext: () => AudioContextLike;
}

export interface AudioLevels {
  readonly master: number;
  readonly sfx: number;
}

/** Maps a 0..100 settings volume to a master gain; NaN falls back to the default volume. */
function volumeToGain(volume: number): number {
  const v = Number.isNaN(volume) ? DEFAULT_VOLUME : Math.min(Math.max(volume, 0), MAX_VOLUME);
  return Math.round(v / VOLUME_STEP) / VOLUME_STEP;
}

export interface AudioEngine {
  unlock(): void;
  /** Unlocks on the first pointerdown and retries `resume()` on later gestures. Returns detach. */
  attachUnlock(target: ListenerTarget): () => void;
  /** Suspends the context while the tab is hidden and resumes it when shown. Returns detach. */
  attachVisibility(source: VisibilitySource): () => void;
  play(voice: Voice, options?: { readonly at?: number }): boolean;
  now(): number;
  state(): AudioEngineState;
  /** Sets the master gain from a 0..100 volume. Kept while locked and applied on unlock. */
  setVolume(volume: number): void;
  setSfxEnabled(on: boolean): void;
  levels(): AudioLevels;
}

interface Graph {
  readonly ctx: AudioContextLike;
  readonly sfx: GainNodeLike;
  readonly master: GainNodeLike;
}

export function createAudioEngine({ createContext }: AudioEngineOptions): AudioEngine {
  let graph: Graph | undefined;
  let unavailable = false;
  let hidden = false;
  let levels: AudioLevels = { master: volumeToGain(DEFAULT_VOLUME), sfx: SFX_BUS_ON };

  const applyLevels = (): void => {
    if (graph === undefined) return;
    graph.master.gain.value = levels.master;
    graph.sfx.gain.value = levels.sfx;
  };

  // Rejections are swallowed: a failed resume just means silence, and a console error fails e2e.
  // A gesture must not wake the context while the tab is hidden.
  const resumeIfSuspended = (): void => {
    if (hidden) return;
    if (graph?.ctx.state === 'suspended') graph.ctx.resume().catch(() => undefined);
  };

  const build = (): Graph | undefined => {
    try {
      const ctx = createContext();
      const sfx = ctx.createGain();
      const master = ctx.createGain();
      sfx.connect(master);
      master.connect(ctx.destination);
      return { ctx, sfx, master };
    } catch {
      // No Web Audio on this device: stay silent for good rather than retrying every touch.
      unavailable = true;
      return undefined;
    }
  };

  const unlock = (): void => {
    if (unavailable) return;
    if (graph === undefined) {
      graph = build();
      // Levels set while locked take effect on the new graph.
      applyLevels();
    }
    resumeIfSuspended();
  };

  return {
    unlock,
    attachUnlock(target) {
      target.addEventListener('pointerdown', unlock, LISTENER_OPTIONS);
      target.addEventListener('pointerup', resumeIfSuspended, LISTENER_OPTIONS);
      return () => {
        target.removeEventListener('pointerdown', unlock, LISTENER_OPTIONS);
        target.removeEventListener('pointerup', resumeIfSuspended, LISTENER_OPTIONS);
      };
    },
    attachVisibility(source) {
      const onChange = (): void => {
        hidden = source.hidden;
        if (graph === undefined) return;
        const settled = hidden ? graph.ctx.suspend() : graph.ctx.resume();
        settled.catch(() => undefined);
      };
      source.addEventListener('visibilitychange', onChange);
      return () => {
        source.removeEventListener('visibilitychange', onChange);
      };
    },
    play(voice, options = {}) {
      if (graph === undefined) return false;
      playVoice(graph.ctx, graph.sfx, voice, options.at ?? graph.ctx.currentTime);
      return true;
    },
    now: () => graph?.ctx.currentTime ?? 0,
    state() {
      if (unavailable) return 'unavailable';
      if (graph === undefined) return 'locked';
      return hidden ? 'suspended' : 'running';
    },
    setVolume(volume) {
      levels = { ...levels, master: volumeToGain(volume) };
      applyLevels();
    },
    setSfxEnabled(on) {
      levels = { ...levels, sfx: on ? SFX_BUS_ON : SFX_BUS_OFF };
      applyLevels();
    },
    levels: () => levels,
  };
}
