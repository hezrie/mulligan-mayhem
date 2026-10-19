import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from '../../src/ui/audio/context.ts';

export type ParamCall = readonly [method: string, ...args: number[]];

/** Records every automation call in order; `value` is a plain field. */
export class FakeAudioParam implements AudioParamLike {
  value: number;
  readonly calls: ParamCall[] = [];

  constructor(value: number) {
    this.value = value;
  }

  setValueAtTime(value: number, startTime: number): this {
    this.calls.push(['setValueAtTime', value, startTime]);
    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.calls.push(['linearRampToValueAtTime', value, endTime]);
    return this;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.calls.push(['exponentialRampToValueAtTime', value, endTime]);
    return this;
  }

  cancelScheduledValues(cancelTime: number): this {
    this.calls.push(['cancelScheduledValues', cancelTime]);
    return this;
  }
}

export class FakeAudioNode implements AudioNodeLike {
  readonly connections: AudioNodeLike[] = [];

  connect(target: AudioNodeLike): AudioNodeLike {
    this.connections.push(target);
    return target;
  }
}

/** A node with start/stop; an omitted time records 0, Web Audio's "now". */
class FakeScheduledNode extends FakeAudioNode {
  readonly starts: number[] = [];
  readonly stops: number[] = [];

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(when = 0): void {
    this.stops.push(when);
  }
}

export class FakeGainNode extends FakeAudioNode implements GainNodeLike {
  readonly gain = new FakeAudioParam(1);
}

export class FakeOscillatorNode extends FakeScheduledNode implements OscillatorNodeLike {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam(440);
}

export class FakeBiquadFilterNode extends FakeAudioNode implements BiquadFilterNodeLike {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeAudioParam(350);
  readonly Q = new FakeAudioParam(1);
}

export class FakeAudioBuffer implements AudioBufferLike {
  private readonly channels: Float32Array[];

  constructor(
    numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
}

export class FakeAudioBufferSourceNode
  extends FakeScheduledNode
  implements AudioBufferSourceNodeLike
{
  buffer: AudioBufferLike | null = null;
  loop = false;
}

export type FakeNodeRecord =
  | { readonly kind: 'gain'; readonly node: FakeGainNode }
  | { readonly kind: 'oscillator'; readonly node: FakeOscillatorNode }
  | { readonly kind: 'biquad'; readonly node: FakeBiquadFilterNode }
  | { readonly kind: 'buffer-source'; readonly node: FakeAudioBufferSourceNode };

/** A recording stand-in for AudioContext, so Node tests can assert the exact audio graph built. */
export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly destination = new FakeAudioNode();
  readonly nodes: FakeNodeRecord[] = [];
  bufferCount = 0;
  resumeCalls = 0;
  suspendCalls = 0;
  failResume = false;
  failSuspend = false;

  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.nodes.push({ kind: 'gain', node });
    return node;
  }

  createOscillator(): FakeOscillatorNode {
    const node = new FakeOscillatorNode();
    this.nodes.push({ kind: 'oscillator', node });
    return node;
  }

  createBiquadFilter(): FakeBiquadFilterNode {
    const node = new FakeBiquadFilterNode();
    this.nodes.push({ kind: 'biquad', node });
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    this.bufferCount += 1;
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): FakeAudioBufferSourceNode {
    const node = new FakeAudioBufferSourceNode();
    this.nodes.push({ kind: 'buffer-source', node });
    return node;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.failResume) return Promise.reject(new Error('resume failed'));
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    if (this.failSuspend) return Promise.reject(new Error('suspend failed'));
    this.state = 'suspended';
    return Promise.resolve();
  }
}
