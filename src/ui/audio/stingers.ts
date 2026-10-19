import type { Voice, VoiceFilter, VoiceLayer } from './voices.ts';

/**
 * Short musical phrases that say how a hole went. Notes are equal-tempered, rounded to 2 decimals.
 * Names mirror `scoreName` in core scoring, but eagles fold into 'birdie' to keep the set small.
 */

export type StingerName = 'hole-in-one' | 'birdie' | 'par' | 'bogey' | 'double-bogey';

export interface Stinger {
  readonly name: StingerName;
  readonly voice: Voice;
}

// Bright stingers sit at half volume; sawtooth losers are quieter because they sound louder.
const BRIGHT_GAIN = 0.5;
const SAD_GAIN = 0.35;

function tone(
  kind: 'sine' | 'triangle' | 'sawtooth',
  freq: number,
  startMs: number,
  durationMs: number,
  gain: number,
  filter?: VoiceFilter,
): VoiceLayer {
  return {
    source: { kind, freq },
    ...(filter === undefined ? {} : { filter }),
    gain,
    startMs,
    durationMs,
  };
}

// C5-E5-G5-C6 fanfare, the top note held.
const HOLE_IN_ONE: Voice = {
  layers: [
    tone('triangle', 523.25, 0, 90, BRIGHT_GAIN),
    tone('triangle', 659.25, 90, 90, BRIGHT_GAIN),
    tone('triangle', 783.99, 180, 90, BRIGHT_GAIN),
    tone('triangle', 1046.5, 270, 400, BRIGHT_GAIN),
  ],
};

const BIRDIE: Voice = {
  layers: [tone('sine', 783.99, 0, 500, BRIGHT_GAIN), tone('sine', 1046.5, 120, 500, BRIGHT_GAIN)],
};

const PAR: Voice = { layers: [tone('sine', 880, 0, 600, BRIGHT_GAIN)] };

// The lowpass takes the buzz off the sawtooth so it sounds like a muted horn.
const BOGEY_LOWPASS: VoiceFilter = { type: 'lowpass', freq: 900, q: 1 };
const BOGEY: Voice = {
  layers: [
    tone('sawtooth', 311.13, 0, 280, SAD_GAIN, BOGEY_LOWPASS),
    tone('sawtooth', 293.66, 300, 280, SAD_GAIN, BOGEY_LOWPASS),
  ],
};

// Sad trombone: four falling semitones, the last one held.
const TROMBONE_LOWPASS: VoiceFilter = { type: 'lowpass', freq: 1000, q: 1 };
const DOUBLE_BOGEY: Voice = {
  layers: [
    tone('sawtooth', 293.66, 0, 280, SAD_GAIN, TROMBONE_LOWPASS),
    tone('sawtooth', 277.18, 300, 280, SAD_GAIN, TROMBONE_LOWPASS),
    tone('sawtooth', 261.63, 600, 280, SAD_GAIN, TROMBONE_LOWPASS),
    tone('sawtooth', 246.94, 900, 700, SAD_GAIN, TROMBONE_LOWPASS),
  ],
};

/** The stinger for holing out in `strokes` on a hole of `par`. Pure. */
export function stingerFor(strokes: number, par: number): Stinger {
  if (strokes === 1) return { name: 'hole-in-one', voice: HOLE_IN_ONE };
  const diff = strokes - par;
  if (diff <= -1) return { name: 'birdie', voice: BIRDIE };
  if (diff === 0) return { name: 'par', voice: PAR };
  if (diff === 1) return { name: 'bogey', voice: BOGEY };
  return { name: 'double-bogey', voice: DOUBLE_BOGEY };
}
