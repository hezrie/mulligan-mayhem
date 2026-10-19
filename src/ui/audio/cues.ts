import type { GameEvent } from '../../core/game/machine.ts';
import type { AudioEngine } from './engine.ts';
import { hapticFor, type HapticCue, type Haptics } from './haptics.ts';
import { voiceFor, type Voice } from './voices.ts';

/** Softer contacts than this are rolling scuffs, not knocks worth a sound. */
const BOUNCE_MIN_IMPULSE = 30;
// 3 physics steps (25 ms): a ball rattling in a corner gives one tonk, not a burst.
const BOUNCE_COOLDOWN_STEPS = 3;
const DEFAULT_LOG_CAPACITY = 200;

export type SoundTrigger = GameEvent | { readonly type: 'shot'; readonly power: number };

export type CueChannel = 'sfx' | 'stinger' | 'crowd';

export interface CueLogEntry {
  readonly channel: CueChannel;
  readonly cue: string;
  readonly step: number;
}

/** Every cue in order, so tests can check what was heard without hearing it. */
export interface CueLog {
  record(entry: CueLogEntry): void;
  entries(): readonly CueLogEntry[];
  clear(): void;
}

export function createCueLog(capacity = DEFAULT_LOG_CAPACITY): CueLog {
  let entries: CueLogEntry[] = [];
  return {
    record(entry) {
      entries.push(entry);
      if (entries.length > capacity) entries = entries.slice(entries.length - capacity);
    },
    entries: () => [...entries],
    clear() {
      entries = [];
    },
  };
}

export interface SoundContext {
  readonly step: number;
  /** Unused until score stingers; part of the signature so the app is wired only once. */
  readonly par: number;
}

export interface Soundscape {
  handle(trigger: SoundTrigger, context: SoundContext): void;
}

export interface SoundscapeOptions {
  readonly engine: Pick<AudioEngine, 'play' | 'now'>;
  readonly log: CueLog;
  readonly haptics?: Pick<Haptics, 'pulse'>;
}

export function createSoundscape({ engine, log, haptics }: SoundscapeOptions): Soundscape {
  let lastBounceStep = -Infinity;
  const buzz = (cue: HapticCue): void => haptics?.pulse(hapticFor(cue));

  // Logged before playing, so a locked or missing engine still leaves a full cue log.
  const cue = (name: string, step: number, voice: Voice): void => {
    log.record({ channel: 'sfx', cue: name, step });
    engine.play(voice);
  };

  return {
    handle(trigger, { step }) {
      switch (trigger.type) {
        case 'shot':
          cue('putt', step, voiceFor('putt', { power: trigger.power }));
          buzz({ type: 'putt', power: trigger.power });
          return;
        case 'bounce':
          if (trigger.impulse < BOUNCE_MIN_IMPULSE) return;
          // A step earlier than the last bounce means a new or restarted hole, so no cooldown.
          if (step >= lastBounceStep && step - lastBounceStep < BOUNCE_COOLDOWN_STEPS) return;
          lastBounceStep = step;
          // Seeding the jitter with the step makes a replay sound the same every time.
          cue('bounce', step, voiceFor('bounce', { impulse: trigger.impulse, seed: step }));
          buzz({ type: 'bounce', impulse: trigger.impulse });
          return;
        case 'cup':
          // The cup buzz waits for 'holed', which knows whether to celebrate a hole in one.
          cue('cup', step, voiceFor('cup', {}));
          return;
        case 'holed':
          buzz({ type: trigger.strokes === 1 ? 'hole-in-one' : 'cup' });
          return;
        default:
          return;
      }
    },
  };
}
