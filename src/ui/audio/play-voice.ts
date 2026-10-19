import { Rng } from '../../core/rng.ts';
import type { AudioBufferLike, AudioContextLike, AudioNodeLike, GainNodeLike } from './context.ts';
import type { Voice, VoiceLayer } from './voices.ts';

// A 2 ms attack ramp avoids the click of a gain jumping from 0.
const ATTACK_S = 0.002;
// Exponential ramps can't reach 0; this is inaudible and avoids a click at stop.
const RELEASE_FLOOR = 0.001;
// Fixed seed so every device and context gets the same noise.
const NOISE_SEED = 1;

const noiseCache = new WeakMap<AudioContextLike, AudioBufferLike>();

/** One second of mono white noise, created once per context and shared by every noise layer. */
export function noiseBuffer(ctx: AudioContextLike): AudioBufferLike {
  const cached = noiseCache.get(ctx);
  if (cached !== undefined) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = new Rng(NOISE_SEED);
  for (let i = 0; i < data.length; i += 1) data[i] = 2 * rng.float() - 1;
  noiseCache.set(ctx, buffer);
  return buffer;
}

function playLayer(ctx: AudioContextLike, out: GainNodeLike, layer: VoiceLayer, at: number): void {
  const t0 = at + layer.startMs / 1000;
  const t1 = at + (layer.startMs + layer.durationMs) / 1000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(layer.gain, t0 + ATTACK_S);
  gain.gain.exponentialRampToValueAtTime(RELEASE_FLOOR, t1);
  gain.connect(out);

  let input: AudioNodeLike = gain;
  if (layer.filter !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = layer.filter.type;
    filter.frequency.value = layer.filter.freq;
    filter.Q.value = layer.filter.q;
    filter.connect(gain);
    input = filter;
  }

  const { source } = layer;
  if (source.kind === 'noise') {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.connect(input);
    noise.start(t0);
    noise.stop(t1);
  } else {
    const osc = ctx.createOscillator();
    osc.type = source.kind;
    osc.frequency.value = source.freq;
    osc.connect(input);
    osc.start(t0);
    osc.stop(t1);
  }
}

/** Schedules every layer of a voice on `ctx` at context time `at` (seconds), routed into `out`. */
export function playVoice(
  ctx: AudioContextLike,
  out: GainNodeLike,
  voice: Voice,
  at: number,
): void {
  for (const layer of voice.layers) playLayer(ctx, out, layer, at);
}
