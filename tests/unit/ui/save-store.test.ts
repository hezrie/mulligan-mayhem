import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptySave, hasFlag, mergeBest, setFlag } from '../../../src/core/game/save.ts';
import { createSaveStore } from '../../../src/ui/save-store.ts';
import { SAVE_CORRUPT_KEY, SAVE_KEY, type KeyValueStorage } from '../../../src/ui/storage.ts';

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

describe('save storage keys', () => {
  it('exports the versioned save key and the corrupt backup key', () => {
    expect(SAVE_KEY).toBe('mm.save.v1');
    expect(SAVE_CORRUPT_KEY).toBe('mm.save.corrupt');
  });
});

describe('createSaveStore persistence', () => {
  it('returns the empty save from empty storage without writing', () => {
    const { storage } = fakeStorage();
    expect(createSaveStore(storage).get()).toEqual(emptySave());
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists a best score that a second store reads back', () => {
    const { storage } = fakeStorage();
    const updated = createSaveStore(storage).update((s) =>
      mergeBest(s, { holeId: 'skeleton-01', strokes: 3, stars: 3 }),
    );
    expect(updated.best['skeleton-01']).toEqual({ strokes: 3, stars: 3 });
    expect(storage.setItem).toHaveBeenCalledWith(SAVE_KEY, JSON.stringify(updated));
    expect(createSaveStore(storage).get().best['skeleton-01']).toEqual({ strokes: 3, stars: 3 });
  });

  it('persists a flag that a further store reads back', () => {
    const { storage } = fakeStorage();
    createSaveStore(storage).update((s) => setFlag(s, 'tip.sand'));
    expect(hasFlag(createSaveStore(storage).get(), 'tip.sand')).toBe(true);
  });
});

describe('createSaveStore with a corrupt save', () => {
  it.each(['{not json', '{"version":2}'])('sets %s aside and resets the save', (raw) => {
    const { map, storage } = fakeStorage({ [SAVE_KEY]: raw });
    expect(createSaveStore(storage).get()).toEqual(emptySave());
    expect(map.get(SAVE_CORRUPT_KEY)).toBe(raw);
    expect(map.get(SAVE_KEY)).toBe(JSON.stringify(emptySave()));
  });

  it('overwrites an older corrupt copy', () => {
    const { map, storage } = fakeStorage({ [SAVE_KEY]: '{not json', [SAVE_CORRUPT_KEY]: 'old' });
    createSaveStore(storage);
    expect(map.get(SAVE_CORRUPT_KEY)).toBe('{not json');
  });
});

describe('createSaveStore with broken storage', () => {
  it.each([
    ['throwing', throwingStorage()],
    ['null', null],
  ])('works from memory and stays silent with %s storage', (_name, storage) => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const store = createSaveStore(storage);
    expect(store.get()).toEqual(emptySave());
    const updated = store.update((s) => setFlag(s, 'tip.sand'));
    expect(hasFlag(updated, 'tip.sand')).toBe(true);
    expect(store.get()).toEqual(updated);
    expect(error).toHaveBeenCalledTimes(0);
    expect(warn).toHaveBeenCalledTimes(0);
  });
});
