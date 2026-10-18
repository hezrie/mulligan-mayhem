import { describe, expect, it } from 'vitest';
import { nextFloat, seedState } from '../../../../src/core/rng.ts';
import { voiceFor, type Voice } from '../../../../src/ui/audio/voices.ts';

function expectWellFormed(voice: Voice): void {
  expect(voice.layers.length).toBeGreaterThan(0);
  for (const layer of voice.layers) {
    expect(layer.gain).toBeGreaterThan(0);
    expect(layer.gain).toBeLessThanOrEqual(1);
    expect(layer.startMs).toBeGreaterThanOrEqual(0);
    expect(layer.durationMs).toBeGreaterThan(0);
  }
}

function freqOf(voice: Voice): number {
  const source = voice.layers[0]?.source;
  if (source === undefined || source.kind === 'noise') throw new Error('expected a tone');
  return source.freq;
}

describe('voiceFor: well-formed layers', () => {
  it.each([0, 0.05, 0.5, 1, 1.4])('putt at power %d', (power) => {
    expectWellFormed(voiceFor('putt', { power }));
  });

  it.each([0, 316.9, 400, 817.266, 1000, 5000])('bounce at impulse %d', (impulse) => {
    expectWellFormed(voiceFor('bounce', { impulse, seed: 7 }));
  });

  it('cup', () => {
    expectWellFormed(voiceFor('cup', {}));
  });
});

describe('voiceFor putt', () => {
  it('is a bandpassed noise tick plus a short sine click, both at 0 ms', () => {
    const { layers } = voiceFor('putt', { power: 1 });
    expect(layers).toHaveLength(2);
    expect(layers[0]).toMatchObject({
      source: { kind: 'noise' },
      filter: { type: 'bandpass', freq: 1800, q: 1.2 },
      startMs: 0,
      durationMs: 35,
    });
    expect(layers[1]).toMatchObject({
      source: { kind: 'sine', freq: 900 },
      startMs: 0,
      durationMs: 10,
    });
  });

  it.each([
    [0.05, 0.335],
    [0.5, 0.65],
    [1, 1.0],
    [1.4, 1.0],
    [0, 0.335],
  ])('power %d gives gain %d on both layers', (power, gain) => {
    const { layers } = voiceFor('putt', { power });
    for (const layer of layers) expect(layer.gain).toBeCloseTo(gain, 9);
  });
});

describe('voiceFor bounce', () => {
  it('is one 80 ms triangle layer at 0 ms', () => {
    const { layers } = voiceFor('bounce', { impulse: 400, seed: 1 });
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ source: { kind: 'triangle' }, startMs: 0, durationMs: 80 });
  });

  it.each([
    [0, 0.15],
    [400, 0.5],
    [800, 1],
    [1000, 1],
  ])('impulse %d gives gain %d', (impulse, gain) => {
    expect(voiceFor('bounce', { impulse, seed: 1 }).layers[0]?.gain).toBeCloseTo(gain, 9);
  });

  it.each([
    [0, 180],
    [316.9, 370.14],
    [1000, 700],
  ])('impulse %d jitters around base %d Hz using the core PRNG', (impulse, base) => {
    const seed = 42;
    const u = nextFloat(seedState(seed)).value;
    const expected = base * (1 + 0.04 * (2 * u - 1));
    expect(freqOf(voiceFor('bounce', { impulse, seed }))).toBeCloseTo(expected, 9);
  });

  it('seeds 1–1000 at impulse 400 stay within ±4% of 420 Hz and are varied', () => {
    const freqs = new Set<number>();
    for (let seed = 1; seed <= 1000; seed++) {
      const freq = freqOf(voiceFor('bounce', { impulse: 400, seed }));
      expect(freq).toBeGreaterThanOrEqual(403.2);
      expect(freq).toBeLessThanOrEqual(436.8);
      freqs.add(freq);
    }
    expect(freqs.size).toBeGreaterThanOrEqual(900);
  });

  it('is deterministic per seed and never mutates its params', () => {
    const params = Object.freeze({ impulse: 748.548, seed: 99 });
    const a = voiceFor('bounce', params);
    const b = voiceFor('bounce', params);
    expect(a).toEqual(b);
    expect(params).toEqual({ impulse: 748.548, seed: 99 });
  });
});

describe('voiceFor cup', () => {
  it('is three highpassed noise clicks then a low sine thunk', () => {
    const click = (startMs: number) => ({
      source: { kind: 'noise' },
      filter: { type: 'highpass', freq: 3000, q: 0.7 },
      gain: 0.6,
      startMs,
      durationMs: 25,
    });
    expect(voiceFor('cup', Object.freeze({})).layers).toEqual([
      click(0),
      click(35),
      click(70),
      { source: { kind: 'sine', freq: 110 }, gain: 0.9, startMs: 105, durationMs: 180 },
    ]);
  });
});
