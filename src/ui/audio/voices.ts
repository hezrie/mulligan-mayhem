import { nextFloat, seedState } from '../../core/rng.ts';

/**
 * Sound recipes as plain data: no audio files and no Web Audio here, so they run in Node tests and
 * sound the same on every device. A player turns each layer into an oscillator or noise burst.
 */

export type VoiceSource =
  | { readonly kind: 'noise' }
  | { readonly kind: 'sine' | 'triangle' | 'square' | 'sawtooth'; readonly freq: number };

export interface VoiceFilter {
  readonly type: 'bandpass' | 'lowpass' | 'highpass';
  readonly freq: number;
  readonly q: number;
}

export interface VoiceLayer {
  readonly source: VoiceSource;
  readonly filter?: VoiceFilter;
  /** 0 < gain <= 1. */
  readonly gain: number;
  readonly startMs: number;
  readonly durationMs: number;
}

export interface Voice {
  readonly layers: readonly VoiceLayer[];
}

export interface VoiceParams {
  readonly putt: { readonly power: number };
  readonly bounce: { readonly impulse: number; readonly seed: number };
  readonly cup: Readonly<Record<string, never>>;
}

export type Cue = keyof VoiceParams;

// Floor keeps the faintest tap audible.
const PUTT_MIN_POWER = 0.05;
// Impulse that reaches full volume; the hardest replay bank (~817) just clips it.
const BOUNCE_FULL_IMPULSE = 800;
const BOUNCE_MIN_GAIN = 0.15;
// ±4% pitch jitter so repeated bounces don't sound machine-gunned.
const BOUNCE_JITTER = 0.04;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function putt({ power }: VoiceParams['putt']): Voice {
  const gain = 0.3 + 0.7 * clamp(power, PUTT_MIN_POWER, 1);
  return {
    layers: [
      {
        source: { kind: 'noise' },
        filter: { type: 'bandpass', freq: 1800, q: 1.2 },
        gain,
        startMs: 0,
        durationMs: 35,
      },
      { source: { kind: 'sine', freq: 900 }, gain, startMs: 0, durationMs: 10 },
    ],
  };
}

function bounce({ impulse, seed }: VoiceParams['bounce']): Voice {
  const base = Math.min(700, 180 + 0.6 * impulse);
  const u = nextFloat(seedState(seed)).value;
  const freq = base * (1 + BOUNCE_JITTER * (2 * u - 1));
  const gain = clamp(impulse / BOUNCE_FULL_IMPULSE, BOUNCE_MIN_GAIN, 1);
  return { layers: [{ source: { kind: 'triangle', freq }, gain, startMs: 0, durationMs: 80 }] };
}

function cupClick(startMs: number): VoiceLayer {
  return {
    source: { kind: 'noise' },
    filter: { type: 'highpass', freq: 3000, q: 0.7 },
    gain: 0.6,
    startMs,
    durationMs: 25,
  };
}

// Rattle against the cup wall, then the low thunk of landing.
const CUP: Voice = {
  layers: [
    cupClick(0),
    cupClick(35),
    cupClick(70),
    { source: { kind: 'sine', freq: 110 }, gain: 0.9, startMs: 105, durationMs: 180 },
  ],
};

/** The recipe for one sound cue. Pure: same cue and params give a deep-equal voice. */
export function voiceFor<C extends Cue>(cue: C, params: VoiceParams[C]): Voice {
  switch (cue) {
    case 'putt':
      return putt(params as VoiceParams['putt']);
    case 'bounce':
      return bounce(params as VoiceParams['bounce']);
    default:
      return CUP;
  }
}
