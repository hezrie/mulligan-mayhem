import { describe, expect, it } from 'vitest';
import type { AudioContextLike } from '../../../../src/ui/audio/context.ts';
import { FakeAudioContext } from '../../../helpers/fake-audio-context.ts';

// Type-level proof, checked by `npm run typecheck`: the DOM AudioContext satisfies the subset.
// Never called, because Node has no AudioContext; only the type checker evaluates the body.
declare const real: AudioContext;
export function domContextAsSubset(): AudioContextLike {
  const view: AudioContextLike = real;
  return view;
}

describe('FakeAudioContext', () => {
  it('starts with the documented defaults', () => {
    const ctx = new FakeAudioContext();
    expect(ctx.currentTime).toBe(0);
    expect(ctx.sampleRate).toBe(48000);
    expect(ctx.state).toBe('running');
    expect(ctx.nodes).toEqual([]);
    expect(ctx.bufferCount).toBe(0);
  });

  it('records connections, param automation and start/stop times', () => {
    const ctx = new FakeAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, 1);
    gain.gain.linearRampToValueAtTime(0.5, 1.002);
    osc.start(1);
    osc.stop(2);

    expect(ctx.nodes.map((n) => n.kind)).toEqual(['oscillator', 'gain']);
    expect(osc.connections).toEqual([gain]);
    expect(gain.connections).toEqual([ctx.destination]);
    expect(gain.gain.calls).toEqual([
      ['setValueAtTime', 0, 1],
      ['linearRampToValueAtTime', 0.5, 1.002],
    ]);
    expect(osc.starts).toEqual([1]);
    expect(osc.stops).toEqual([2]);
  });

  it('records biquad and buffer-source nodes in creation order', () => {
    const ctx = new FakeAudioContext();
    const filter = ctx.createBiquadFilter();
    const source = ctx.createBufferSource();
    filter.Q.exponentialRampToValueAtTime(2, 0.5);
    filter.frequency.cancelScheduledValues(0);
    expect(ctx.nodes).toEqual([
      { kind: 'biquad', node: filter },
      { kind: 'buffer-source', node: source },
    ]);
    expect(filter.Q.calls).toEqual([['exponentialRampToValueAtTime', 2, 0.5]]);
    expect(filter.frequency.calls).toEqual([['cancelScheduledValues', 0]]);
  });

  it('creates buffers of the requested length and counts them', () => {
    const ctx = new FakeAudioContext();
    const buffer = ctx.createBuffer(1, 48000, 48000);
    expect(buffer.getChannelData(0).length).toBe(48000);
    expect(buffer.length).toBe(48000);
    expect(buffer.sampleRate).toBe(48000);
    expect(ctx.bufferCount).toBe(1);
  });

  it('resume and suspend count calls and update state', async () => {
    const ctx = new FakeAudioContext();
    await ctx.suspend();
    expect(ctx.state).toBe('suspended');
    await ctx.resume();
    expect(ctx.state).toBe('running');
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
  });

  it('rejects resume when failResume is set', async () => {
    const ctx = new FakeAudioContext();
    ctx.failResume = true;
    await expect(ctx.resume()).rejects.toThrow();
    expect(ctx.resumeCalls).toBe(1);
  });

  it('rejects suspend when failSuspend is set', async () => {
    const ctx = new FakeAudioContext();
    ctx.failSuspend = true;
    await expect(ctx.suspend()).rejects.toThrow();
    expect(ctx.suspendCalls).toBe(1);
  });
});
