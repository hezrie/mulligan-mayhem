import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/core/game/settings.ts';
import { createSettingsStore } from '../../../src/ui/settings-store.ts';
import { SETTINGS_KEY, type KeyValueStorage } from '../../../src/ui/storage.ts';

/** Map-backed storage whose setItem is spied, so tests can count writes. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: vi.fn((key: string, value: string): void => {
      map.set(key, value);
    }),
  } satisfies KeyValueStorage;
  return { map, storage };
}

function throwingStorage(): KeyValueStorage {
  return {
    getItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    },
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSettingsStore persistence', () => {
  it('returns defaults from empty storage without writing', () => {
    const { storage } = fakeStorage();
    expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes updates as JSON and a second store reads them back', () => {
    const { map, storage } = fakeStorage();
    const updated = createSettingsStore(storage).update({ volume: 30 });
    expect(updated.volume).toBe(30);
    expect(storage.setItem).toHaveBeenCalledWith(SETTINGS_KEY, expect.any(String));
    const raw = map.get(SETTINGS_KEY);
    expect(JSON.parse(raw ?? 'null')).toMatchObject({ volume: 30 });
    expect(createSettingsStore(storage).get().volume).toBe(30);
  });
});

describe('createSettingsStore parsing', () => {
  it.each(['{nope', '[]', '42'])('falls back to defaults for stored %s', (raw) => {
    const { storage } = fakeStorage({ [SETTINGS_KEY]: raw });
    expect(createSettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid stored fields and defaults the rest', () => {
    const raw = JSON.stringify({ version: 1, aimMode: 'anywhere' });
    const { storage } = fakeStorage({ [SETTINGS_KEY]: raw });
    expect(createSettingsStore(storage).get()).toEqual({
      ...DEFAULT_SETTINGS,
      aimMode: 'anywhere',
    });
  });
});

describe('createSettingsStore subscribe', () => {
  it('calls the listener once per update until unsubscribed', () => {
    const store = createSettingsStore(fakeStorage().storage);
    const fn = vi.fn();
    const unsubscribe = store.subscribe(fn);
    const updated = store.update({ volume: 30 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(updated);
    expect(updated.volume).toBe(30);
    unsubscribe();
    store.update({ volume: 40 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('createSettingsStore with broken storage', () => {
  it.each([
    ['throwing', throwingStorage()],
    ['null', null],
  ])('works from memory and stays silent with %s storage', (_name, storage) => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const store = createSettingsStore(storage);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.update({ volume: 30 }).volume).toBe(30);
    expect(store.get().volume).toBe(30);
    expect(error).toHaveBeenCalledTimes(0);
    expect(warn).toHaveBeenCalledTimes(0);
  });
});
