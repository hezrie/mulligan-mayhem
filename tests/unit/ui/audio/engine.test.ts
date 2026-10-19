import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createAudioEngine } from '../../../../src/ui/audio/engine.ts';
import { voiceFor } from '../../../../src/ui/audio/voices.ts';
import { FakeAudioContext, type FakeGainNode } from '../../../helpers/fake-audio-context.ts';

function setup(init: (ctx: FakeAudioContext) => void = () => undefined) {
  const ctx = new FakeAudioContext();
  init(ctx);
  const createContext = vi.fn(() => ctx);
  const engine = createAudioEngine({ createContext });
  const target = new EventTarget();
  const detach = engine.attachUnlock(target);
  const fire = (type: 'pointerdown' | 'pointerup') => target.dispatchEvent(new Event(type));
  return { ctx, engine, createContext, target, detach, fire };
}

const gains = (ctx: FakeAudioContext) =>
  ctx.nodes.flatMap((n): FakeGainNode[] => (n.kind === 'gain' ? [n.node] : []));

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
    fire('pointerup');
    expect(createContext).toHaveBeenCalledTimes(0);
    for (let i = 0; i < 4; i += 1) fire('pointerdown');
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('listens in the capture phase, and detach removes the listeners', () => {
    const engine = createAudioEngine({ createContext: vi.fn(() => new FakeAudioContext()) });
    const target = new EventTarget();
    const spy = vi.spyOn(target, 'addEventListener');
    const detach = engine.attachUnlock(target);
    expect(spy.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['pointerdown', { capture: true }],
      ['pointerup', { capture: true }],
    ]);
    detach();
    target.dispatchEvent(new Event('pointerdown'));
    expect(engine.state()).toBe('locked');
  });

  it('builds sfx bus → master → destination with master 0.7 and sfx 1.0', () => {
    const { ctx, fire } = setup();
    fire('pointerdown');
    const [sfx, master, ...rest] = gains(ctx);
    expect(rest).toEqual([]);
    expect(master?.gain.value).toBe(0.7);
    expect(sfx?.gain.value).toBe(1.0);
    expect(master?.connections).toEqual([ctx.destination]);
    expect(sfx?.connections).toEqual([master]);
  });
});

describe('createAudioEngine resume', () => {
  it('does not resume a context that starts running', () => {
    const { ctx, fire } = setup();
    fire('pointerdown');
    fire('pointerup');
    expect(ctx.resumeCalls).toBe(0);
  });

  it('resumes once per gesture while suspended, then stops once running', async () => {
    const { ctx, fire } = setup((c) => {
      c.state = 'suspended';
      c.failResume = true;
    });
    expect(() => fire('pointerdown')).not.toThrow();
    expect(ctx.resumeCalls).toBe(1);
    fire('pointerup');
    fire('pointerdown');
    expect(ctx.resumeCalls).toBe(3);
    ctx.failResume = false;
    fire('pointerup');
    expect(ctx.state).toBe('running');
    fire('pointerdown');
    fire('pointerup');
    expect(ctx.resumeCalls).toBe(4);
    // Let the rejected resumes settle so an unhandled rejection would fail this run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('createAudioEngine play and state', () => {
  it('is locked, plays nothing and reports now() = 0 before unlock', () => {
    const { engine, createContext } = setup();
    expect(engine.state()).toBe('locked');
    expect(engine.play(voiceFor('cup', {}))).toBe(false);
    expect(engine.now()).toBe(0);
    expect(createContext).toHaveBeenCalledTimes(0);
  });

  it('routes voices into the sfx bus at ctx.currentTime, or at `at`', () => {
    const { ctx, engine, fire } = setup();
    fire('pointerdown');
    expect(engine.state()).toBe('running');
    ctx.currentTime = 3.5;
    expect(engine.now()).toBe(3.5);
    const sfx = gains(ctx)[0];

    expect(engine.play(voiceFor('cup', {}))).toBe(true);
    const voiceGains = gains(ctx).slice(2);
    expect(voiceGains.length).toBeGreaterThan(0);
    for (const gain of voiceGains) expect(gain.connections).toEqual([sfx]);
    expect(voiceGains[0]?.gain.calls[0]).toEqual(['setValueAtTime', 0, 3.5]);

    const before = gains(ctx).length;
    expect(engine.play(voiceFor('cup', {}), { at: 7 })).toBe(true);
    expect(gains(ctx)[before]?.gain.calls[0]).toEqual(['setValueAtTime', 0, 7]);
  });

  it('is unavailable when the factory throws, and never calls it again', () => {
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
  });
});

function setupVisibility(init: (ctx: FakeAudioContext) => void = () => undefined) {
  const base = setup(init);
  const source = Object.assign(new EventTarget(), { hidden: false });
  base.engine.attachVisibility(source);
  const setHidden = (hidden: boolean) => {
    source.hidden = hidden;
    source.dispatchEvent(new Event('visibilitychange'));
  };
  return { ...base, source, setHidden };
}

describe('createAudioEngine visibility', () => {
  it('suspends once when hidden and resumes once when shown', () => {
    const { ctx, engine, fire, setHidden } = setupVisibility();
    fire('pointerdown');
    setHidden(true);
    expect(engine.state()).toBe('suspended');
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.resumeCalls).toBe(0);
    setHidden(false);
    expect(engine.state()).toBe('running');
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.suspendCalls).toBe(1);
  });

  it('creates no context and stays locked when visibility changes before unlock', () => {
    const { engine, createContext, setHidden } = setupVisibility();
    setHidden(true);
    expect(engine.state()).toBe('locked');
    setHidden(false);
    expect(engine.state()).toBe('locked');
    expect(createContext).toHaveBeenCalledTimes(0);
  });

  it('does not resume on pointer events while hidden', () => {
    const { ctx, fire, setHidden } = setupVisibility();
    fire('pointerdown');
    setHidden(true);
    expect(ctx.state).toBe('suspended');
    fire('pointerdown');
    fire('pointerup');
    expect(ctx.resumeCalls).toBe(0);
  });

  it('swallows a rejected suspend without throwing or logging', async () => {
    const { ctx, engine, fire, setHidden } = setupVisibility((c) => {
      c.failSuspend = true;
    });
    fire('pointerdown');
    expect(() => {
      setHidden(true);
    }).not.toThrow();
    expect(ctx.suspendCalls).toBe(1);
    expect(engine.state()).toBe('suspended');
    // Let the rejection settle so an unhandled rejection would fail this run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('createAudioEngine volume and mute', () => {
  it.each([
    [70, 0.7],
    [33, 0.3],
    [35, 0.4],
    [140, 1.0],
    [-5, 0],
    [Number.NaN, 0.7],
  ])('setVolume(%s) sets the master target to %s', (volume, expected) => {
    const { engine } = setup();
    engine.setVolume(20);
    engine.setVolume(volume);
    expect(engine.levels().master).toBe(expected);
  });

  it('starts at master 0.7 and sfx 1, and setSfxEnabled toggles the sfx bus 0 / 1', () => {
    const { engine } = setup();
    expect(engine.levels()).toEqual({ master: 0.7, sfx: 1 });
    engine.setSfxEnabled(false);
    expect(engine.levels()).toEqual({ master: 0.7, sfx: 0 });
    engine.setSfxEnabled(true);
    expect(engine.levels()).toEqual({ master: 0.7, sfx: 1 });
  });

  it('reports levels set while locked, and applies them when the context is created', () => {
    const { ctx, engine, createContext, fire } = setup();
    engine.setVolume(35);
    engine.setSfxEnabled(false);
    expect(engine.levels()).toEqual({ master: 0.4, sfx: 0 });
    expect(createContext).toHaveBeenCalledTimes(0);
    fire('pointerdown');
    const [sfx, master] = gains(ctx);
    expect(master?.gain.value).toBe(0.4);
    expect(sfx?.gain.value).toBe(0);
  });

  it('applies changes made after unlock to the live gains', () => {
    const { ctx, engine, fire } = setup();
    fire('pointerdown');
    engine.setVolume(140);
    engine.setSfxEnabled(false);
    const [sfx, master] = gains(ctx);
    expect(master?.gain.value).toBe(1.0);
    expect(sfx?.gain.value).toBe(0);
    expect(engine.levels()).toEqual({ master: 1.0, sfx: 0 });
  });
});
