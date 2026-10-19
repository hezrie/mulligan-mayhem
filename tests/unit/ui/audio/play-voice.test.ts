import { describe, expect, it } from 'vitest';
import { Rng } from '../../../../src/core/rng.ts';
import { noiseBuffer, playVoice } from '../../../../src/ui/audio/play-voice.ts';
import { voiceFor } from '../../../../src/ui/audio/voices.ts';
import {
  FakeAudioContext,
  type FakeAudioBufferSourceNode,
  type FakeBiquadFilterNode,
  type FakeGainNode,
  type FakeOscillatorNode,
} from '../../../helpers/fake-audio-context.ts';

function nodesOf(ctx: FakeAudioContext) {
  return {
    gains: ctx.nodes.flatMap((n): FakeGainNode[] => (n.kind === 'gain' ? [n.node] : [])),
    oscillators: ctx.nodes.flatMap((n): FakeOscillatorNode[] =>
      n.kind === 'oscillator' ? [n.node] : [],
    ),
    filters: ctx.nodes.flatMap((n): FakeBiquadFilterNode[] =>
      n.kind === 'biquad' ? [n.node] : [],
    ),
    buffers: ctx.nodes.flatMap((n): FakeAudioBufferSourceNode[] =>
      n.kind === 'buffer-source' ? [n.node] : [],
    ),
  };
}

function sources(ctx: FakeAudioContext): (FakeOscillatorNode | FakeAudioBufferSourceNode)[] {
  return ctx.nodes.flatMap((n) =>
    n.kind === 'oscillator' || n.kind === 'buffer-source' ? [n.node] : [],
  );
}

describe('playVoice', () => {
  it('builds one source, an optional filter and one gain per layer of a full putt', () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    ctx.nodes.length = 0;
    playVoice(ctx, out, voiceFor('putt', { power: 1 }), 0);

    const { gains, oscillators, filters, buffers } = nodesOf(ctx);
    expect(buffers).toHaveLength(1);
    expect(buffers[0]?.buffer).toBe(noiseBuffer(ctx));
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0]?.type).toBe('sine');
    expect(oscillators[0]?.frequency.value).toBe(900);
    expect(filters).toHaveLength(1);
    expect(filters[0]?.type).toBe('bandpass');
    expect(filters[0]?.frequency.value).toBe(1800);
    expect(filters[0]?.Q.value).toBe(1.2);
    expect(gains).toHaveLength(2);
    for (const gain of gains) expect(gain.connections).toEqual([out]);

    // Noise → filter → gain; oscillator → gain.
    expect(buffers[0]?.connections).toEqual([filters[0]]);
    expect(filters[0]?.connections).toEqual([gains[0]]);
    expect(oscillators[0]?.connections).toEqual([gains[1]]);
  });

  it('starts and stops each source at its layer offset', () => {
    const ctx = new FakeAudioContext();
    playVoice(ctx, ctx.createGain(), voiceFor('cup', {}), 2);

    const all = sources(ctx);
    expect(all).toHaveLength(4);
    const starts = all.map((s) => s.starts);
    for (const [i, want] of [2.0, 2.035, 2.07, 2.105].entries()) {
      expect(starts[i]).toHaveLength(1);
      expect(starts[i]?.[0]).toBeCloseTo(want, 6);
    }
    const last = all[3];
    expect(last?.stops).toHaveLength(1);
    expect(last?.stops[0]).toBeCloseTo(2.285, 6);
  });

  it('gives every layer a click-free attack and exponential release', () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const voice = voiceFor('cup', {});
    playVoice(ctx, out, voice, 2);

    const gains = nodesOf(ctx).gains.filter((g) => g !== out);
    expect(gains).toHaveLength(voice.layers.length);
    for (const [i, layer] of voice.layers.entries()) {
      const t0 = 2 + layer.startMs / 1000;
      const t1 = 2 + (layer.startMs + layer.durationMs) / 1000;
      expect(gains[i]?.gain.calls).toEqual([
        ['setValueAtTime', 0, t0],
        ['linearRampToValueAtTime', layer.gain, t0 + 0.002],
        ['exponentialRampToValueAtTime', 0.001, t1],
      ]);
    }
  });
});

describe('noiseBuffer', () => {
  it('creates one 1-second mono buffer per context and reuses it', () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    playVoice(ctx, out, voiceFor('putt', { power: 0.5 }), 0);
    playVoice(ctx, out, voiceFor('putt', { power: 1 }), 1);

    expect(ctx.bufferCount).toBe(1);
    const buffer = noiseBuffer(ctx);
    expect(noiseBuffer(ctx)).toBe(buffer);
    expect(buffer.length).toBe(ctx.sampleRate);
    expect(buffer.sampleRate).toBe(ctx.sampleRate);
    expect(() => buffer.getChannelData(1)).toThrow();
  });

  it('fills samples from Rng(1) in [-1, 1), identically across contexts', () => {
    const a = noiseBuffer(new FakeAudioContext()).getChannelData(0);
    const b = noiseBuffer(new FakeAudioContext()).getChannelData(0);

    const rng = new Rng(1);
    const want = Float32Array.from({ length: a.length }, () => 2 * rng.float() - 1);
    expect(a).toEqual(want);
    expect(b).toEqual(a);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...a)).toBeLessThan(1);
  });
});
