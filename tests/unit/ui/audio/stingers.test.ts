import { describe, expect, it } from 'vitest';
import { stingerFor } from '../../../../src/ui/audio/stingers.ts';
import type { VoiceLayer } from '../../../../src/ui/audio/voices.ts';

function tone(
  kind: 'sine' | 'triangle' | 'sawtooth',
  freq: number,
  startMs: number,
  durationMs: number,
  gain: number,
  filter?: VoiceLayer['filter'],
): VoiceLayer {
  return {
    source: { kind, freq },
    ...(filter === undefined ? {} : { filter }),
    gain,
    startMs,
    durationMs,
  };
}

describe('stingerFor name', () => {
  it.each([
    [1, 3, 'hole-in-one'],
    [1, 1, 'hole-in-one'],
    [2, 4, 'birdie'],
    [2, 3, 'birdie'],
    [3, 3, 'par'],
    [4, 3, 'bogey'],
    [5, 3, 'double-bogey'],
    [9, 3, 'double-bogey'],
  ])('%d strokes on a par %d is %s', (strokes, par, name) => {
    expect(stingerFor(strokes, par).name).toBe(name);
  });
});

describe('stingerFor voice', () => {
  it('hole in one is a rising triangle arpeggio', () => {
    expect(stingerFor(1, 3).voice.layers).toEqual([
      tone('triangle', 523.25, 0, 90, 0.5),
      tone('triangle', 659.25, 90, 90, 0.5),
      tone('triangle', 783.99, 180, 90, 0.5),
      tone('triangle', 1046.5, 270, 400, 0.5),
    ]);
  });

  it('birdie is a two-note sine chime', () => {
    expect(stingerFor(2, 3).voice.layers).toEqual([
      tone('sine', 783.99, 0, 500, 0.5),
      tone('sine', 1046.5, 120, 500, 0.5),
    ]);
  });

  it('par is a single sine ding', () => {
    expect(stingerFor(3, 3).voice.layers).toEqual([tone('sine', 880, 0, 600, 0.5)]);
  });

  it('bogey is a lowpassed sawtooth wah-wah', () => {
    const lowpass = { type: 'lowpass', freq: 900, q: 1 } as const;
    expect(stingerFor(4, 3).voice.layers).toEqual([
      tone('sawtooth', 311.13, 0, 280, 0.35, lowpass),
      tone('sawtooth', 293.66, 300, 280, 0.35, lowpass),
    ]);
  });

  it('double bogey or worse is a falling sad trombone', () => {
    const lowpass = { type: 'lowpass', freq: 1000, q: 1 } as const;
    const expected = [
      tone('sawtooth', 293.66, 0, 280, 0.35, lowpass),
      tone('sawtooth', 277.18, 300, 280, 0.35, lowpass),
      tone('sawtooth', 261.63, 600, 280, 0.35, lowpass),
      tone('sawtooth', 246.94, 900, 700, 0.35, lowpass),
    ];
    expect(stingerFor(5, 3).voice.layers).toEqual(expected);
    expect(stingerFor(9, 3).voice.layers).toEqual(expected);
  });
});
