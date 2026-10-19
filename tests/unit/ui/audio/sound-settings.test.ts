import { describe, expect, it } from 'vitest';
import {
  bindSoundSettings,
  type SoundSettings,
  type SoundSettingsSource,
} from '../../../../src/ui/audio/sound-settings.ts';

function fakeSource(initial: SoundSettings) {
  let current = initial;
  const listeners = new Set<(s: SoundSettings) => void>();
  const source: SoundSettingsSource = {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: SoundSettings) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { source, set, listeners };
}

function fakeEngine() {
  const calls: (readonly [string, number | boolean])[] = [];
  return {
    calls,
    engine: {
      setVolume: (v: number) => calls.push(['setVolume', v]),
      setSfxEnabled: (on: boolean) => calls.push(['setSfxEnabled', on]),
    },
  };
}

describe('bindSoundSettings', () => {
  it('applies the current settings immediately', () => {
    const { source } = fakeSource({ sfxOn: true, sfxVolume: 70 });
    const { engine, calls } = fakeEngine();
    bindSoundSettings(source, { engine });
    expect(calls).toEqual([
      ['setVolume', 70],
      ['setSfxEnabled', true],
    ]);
  });

  it('applies every change', () => {
    const { source, set } = fakeSource({ sfxOn: true, sfxVolume: 70 });
    const { engine, calls } = fakeEngine();
    bindSoundSettings(source, { engine });
    calls.length = 0;
    set({ sfxOn: false, sfxVolume: 30 });
    set({ sfxOn: true, sfxVolume: 100 });
    expect(calls).toEqual([
      ['setVolume', 30],
      ['setSfxEnabled', false],
      ['setVolume', 100],
      ['setSfxEnabled', true],
    ]);
  });

  it('stops applying changes after unsubscribe', () => {
    const { source, set, listeners } = fakeSource({ sfxOn: true, sfxVolume: 70 });
    const { engine, calls } = fakeEngine();
    const unsubscribe = bindSoundSettings(source, { engine });
    unsubscribe();
    calls.length = 0;
    set({ sfxOn: false, sfxVolume: 10 });
    expect(calls).toEqual([]);
    expect(listeners.size).toBe(0);
  });
});
