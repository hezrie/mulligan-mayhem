import type { AudioContextLike, GainNodeLike } from './context.ts';
import { playVoice } from './play-voice.ts';
import type { Voice } from './voices.ts';

// Matches the default sound-effects volume of 70 (decision settings-defaults).
const MASTER_GAIN = 0.7;
// The sfx bus sits at unity; per-voice levels live in the voice recipes.
const SFX_BUS_GAIN = 1.0;
// Capture phase so a handler that stops propagation can't keep the audio locked.
const LISTENER_OPTIONS = { capture: true } as const;

export type AudioEngineState = 'locked' | 'running' | 'unavailable';

export interface AudioEngineOptions {
  /** Builds the context. Called at most once, lazily inside a gesture, so browsers allow sound. */
  readonly createContext: () => AudioContextLike;
}

export interface AudioEngine {
  unlock(): void;
  /** Unlocks on the first pointerdown and retries `resume()` on later gestures. Returns detach. */
  attachUnlock(target: EventTarget): () => void;
  play(voice: Voice, options?: { readonly at?: number }): boolean;
  now(): number;
  state(): AudioEngineState;
}

interface Graph {
  readonly ctx: AudioContextLike;
  readonly sfx: GainNodeLike;
}

export function createAudioEngine({ createContext }: AudioEngineOptions): AudioEngine {
  let graph: Graph | undefined;
  let unavailable = false;

  // Rejections are swallowed: a failed resume just means silence, and a console error fails e2e.
  const resumeIfSuspended = (): void => {
    if (graph?.ctx.state === 'suspended') graph.ctx.resume().catch(() => undefined);
  };

  const build = (): Graph | undefined => {
    try {
      const ctx = createContext();
      const sfx = ctx.createGain();
      const master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      sfx.gain.value = SFX_BUS_GAIN;
      sfx.connect(master);
      master.connect(ctx.destination);
      return { ctx, sfx };
    } catch {
      // No Web Audio on this device: stay silent for good rather than retrying every touch.
      unavailable = true;
      return undefined;
    }
  };

  const unlock = (): void => {
    if (unavailable) return;
    graph ??= build();
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
    play(voice, options = {}) {
      if (graph === undefined) return false;
      playVoice(graph.ctx, graph.sfx, voice, options.at ?? graph.ctx.currentTime);
      return true;
    },
    now: () => graph?.ctx.currentTime ?? 0,
    state() {
      if (unavailable) return 'unavailable';
      return graph === undefined ? 'locked' : 'running';
    },
  };
}
