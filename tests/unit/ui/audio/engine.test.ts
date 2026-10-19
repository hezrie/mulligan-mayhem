import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createAudioEngine } from '../../../../src/ui/audio/engine.ts';
import { voiceFor } from '../../../../src/ui/audio/voices.ts';
import { FakeAudioContext, type FakeGainNode } from '../../../helpers/fake-audio-context.ts';

function setup(init: (ctx: FakeAudioContext) => void = () => undefined) {
  const contexts: FakeAudioContext[] = [];
  const createContext = vi.fn(() => {
    const ctx = new FakeAudioContext();
    init(ctx);
    contexts.push(ctx);
    return ctx;
  });
  const engine = createAudioEngine({ createContext });
  const target = new EventTarget();
  const detach = engine.attachUnlock(target);
  const fire = (type: 'pointerdown' | 'pointerup') => target.dispatchEvent(new Event(type));
  return { engine, createContext, contexts, target, detach, fire };
}

function gains(ctx: FakeAudioContext): FakeGainNode[] {
  return ctx.nodes.flatMap((n): FakeGainNode[] => (n.kind === 'gain' ? [n.node] : []));
}

/** Lets rejected promises settle so an unhandled rejection would surface in this test. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let consoleError: MockInstance;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});

afterEach(() => {
  expect(consoleError).toHaveBeenCalledTimes(0);
  consoleError.mockRestore();
});

describe('createAudioEngine unlock', () => {
  it('creates no context before a pointerdown and exactly one after four', () => {
    const { createContext, fire } = setup();
    expect(createContext).toHaveBeenCalledTimes(0);
    fire('pointerup');
    expect(createContext).toHaveBeenCalledTimes(0);
    for (let i = 0; i < 4; i += 1) fire('pointerdown');
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('listens to pointerdown and pointerup in the capture phase', () => {
    const engine = createAudioEngine({ createContext: () => new FakeAudioContext() });
    const target = new EventTarget();
    const spy = vi.spyOn(target, 'addEventListener');
    engine.attachUnlock(target);
    expect(spy.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['pointerdown', { capture: true }],
      ['pointerup', { capture: true }],
    ]);
  });

  it('detach removes the listeners', () => {
    const { createContext, detach, fire } = setup();
    detach();
    fire('pointerdown');
    expect(createContext).toHaveBeenCalledTimes(0);
  });

  it('builds sfx bus → master → destination with master 0.7 and sfx 1.0', () => {
    const { contexts, fire } = setup();
    fire('pointerdown');
    const ctx = contexts[0];
    if (ctx === undefined) throw new Error('no context');
    const [sfx, master] = gains(ctx);
    expect(gains(ctx)).toHaveLength(2);
    expect(master?.gain.value).toBe(0.7);
    expect(sfx?.gain.value).toBe(1.0);
    expect(master?.connections).toEqual([ctx.destination]);
    expect(sfx?.connections).toEqual([master]);
  });
});

describe('createAudioEngine resume', () => {
  it('does not resume a context that starts running', () => {
    const { contexts, fire } = setup();
    fire('pointerdown');
    fire('pointerup');
    fire('pointerdown');
    expect(contexts[0]?.resumeCalls).toBe(0);
  });

  it('resumes a suspended context once, then once per pointer event while it stays suspended', async () => {
    const { contexts, fire } = setup((ctx) => {
      ctx.state = 'suspended';
      ctx.failResume = true;
    });
    fire('pointerdown');
    const ctx = contexts[0];
    if (ctx === undefined) throw new Error('no context');
    expect(ctx.resumeCalls).toBe(1);
    fire('pointerup');
    expect(ctx.resumeCalls).toBe(2);
    fire('pointerdown');
    expect(ctx.resumeCalls).toBe(3);

    ctx.failResume = false;
    fire('pointerup');
    expect(ctx.resumeCalls).toBe(4);
    expect(ctx.state).toBe('running');
    fire('pointerdown');
    fire('pointerup');
    expect(ctx.resumeCalls).toBe(4);
    await flush();
  });

  it('stops resuming once the first resume succeeds', () => {
    const { contexts, fire } = setup((ctx) => {
      ctx.state = 'suspended';
    });
    fire('pointerdown');
    fire('pointerup');
    fire('pointerdown');
    expect(contexts[0]?.resumeCalls).toBe(1);
  });

  it('swallows a rejected resume without throwing or an unhandled rejection', async () => {
    const { engine, fire } = setup((ctx) => {
      ctx.state = 'suspended';
      ctx.failResume = true;
    });
    expect(() => {
      fire('pointerdown');
      fire('pointerup');
    }).not.toThrow();
    await flush();
    expect(engine.state()).toBe('running');
  });
});

describe('createAudioEngine play', () => {
  it('returns false and creates nothing while locked; now() is 0', () => {
    const { engine, createContext } = setup();
    expect(engine.play(voiceFor('cup', {}))).toBe(false);
    expect(engine.now()).toBe(0);
    expect(createContext).toHaveBeenCalledTimes(0);
  });

  it('routes the voice into the sfx bus at ctx.currentTime after unlock', () => {
    const { engine, contexts, fire } = setup();
    fire('pointerdown');
    const ctx = contexts[0];
    if (ctx === undefined) throw new Error('no context');
    ctx.currentTime = 3.5;
    expect(engine.now()).toBe(3.5);
    const sfx = gains(ctx)[0];

    expect(engine.play(voiceFor('cup', {}))).toBe(true);
    const voiceGains = gains(ctx).slice(2);
    expect(voiceGains.length).toBeGreaterThan(0);
    for (const gain of voiceGains) expect(gain.connections).toEqual([sfx]);
    expect(voiceGains[0]?.gain.calls[0]).toEqual(['setValueAtTime', 0, 3.5]);
  });

  it('schedules at the given time when `at` is passed', () => {
    const { engine, contexts, fire } = setup();
    fire('pointerdown');
    const ctx = contexts[0];
    if (ctx === undefined) throw new Error('no context');
    expect(engine.play(voiceFor('cup', {}), { at: 7 })).toBe(true);
    expect(gains(ctx)[2]?.gain.calls[0]).toEqual(['setValueAtTime', 0, 7]);
  });
});

describe('createAudioEngine state', () => {
  it('is locked before unlock and running after it', () => {
    const { engine, fire } = setup();
    expect(engine.state()).toBe('locked');
    fire('pointerdown');
    expect(engine.state()).toBe('running');
  });

  it('unlock() can be called directly', () => {
    const { engine, createContext } = setup();
    engine.unlock();
    engine.unlock();
    expect(engine.state()).toBe('running');
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when the factory throws, and never retries', () => {
    const createContext = vi.fn((): FakeAudioContext => {
      throw new Error('no Web Audio');
    });
    const engine = createAudioEngine({ createContext });
    const target = new EventTarget();
    engine.attachUnlock(target);
    for (let i = 0; i < 3; i += 1) {
      target.dispatchEvent(new Event('pointerdown'));
      target.dispatchEvent(new Event('pointerup'));
    }
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(engine.state()).toBe('unavailable');
    expect(engine.play(voiceFor('cup', {}))).toBe(false);
    expect(engine.now()).toBe(0);
  });
});
