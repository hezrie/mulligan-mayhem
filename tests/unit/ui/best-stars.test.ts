import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BEST_STARS_KEY,
  readBestStars,
  readStarTotal,
  recordBestStars,
  safeLocalStorage,
} from '../../../src/ui/best-stars.ts';

type StarStorage = Pick<Storage, 'getItem' | 'setItem'>;

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StarStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  return { map, storage };
}

function throwingStorage(): StarStorage {
  return {
    getItem: () => {
      throw new DOMException('denied', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('best-stars storage', () => {
  it('uses the mm:stars key', () => {
    expect(BEST_STARS_KEY).toBe('mm:stars');
  });

  it('keeps 3 when 2 then 3 are recorded', () => {
    const { map, storage } = memoryStorage();
    recordBestStars(storage, 'skeleton-01', 2);
    recordBestStars(storage, 'skeleton-01', 3);
    expect(readBestStars(storage)).toEqual({ 'skeleton-01': 3 });
    expect(map.get(BEST_STARS_KEY)).toBe('{"skeleton-01":3}');
  });

  it('keeps 3 when 3 then 1 are recorded', () => {
    const { storage } = memoryStorage();
    recordBestStars(storage, 'skeleton-01', 3);
    recordBestStars(storage, 'skeleton-01', 1);
    expect(readBestStars(storage)).toEqual({ 'skeleton-01': 3 });
  });

  it('readStarTotal counts only the listed hole ids', () => {
    const { storage } = memoryStorage();
    recordBestStars(storage, 'skeleton-01', 3);
    recordBestStars(storage, 'dogleg-02', 2);
    expect(readStarTotal(storage, ['skeleton-01', 'dogleg-02'])).toBe(5);
    expect(readStarTotal(storage, ['skeleton-01'])).toBe(3);
  });

  it.each(['not json', '{"skeleton-01":7}', '[3]'])(
    'treats corrupt data %s as empty and overwrites it on the next record',
    (raw) => {
      const { map, storage } = memoryStorage({ [BEST_STARS_KEY]: raw });
      expect(readBestStars(storage)).toEqual({});
      recordBestStars(storage, 'skeleton-01', 2);
      expect(map.get(BEST_STARS_KEY)).toBe('{"skeleton-01":2}');
    },
  );

  it('survives storage that throws on every call, without logging', () => {
    const errorSpy = vi.spyOn(console, 'error');
    const storage = throwingStorage();
    expect(() => {
      recordBestStars(storage, 'skeleton-01', 3);
    }).not.toThrow();
    expect(readBestStars(storage)).toEqual({});
    expect(readStarTotal(storage, ['skeleton-01'])).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('safeLocalStorage', () => {
  it("returns the getter's storage when it does not throw", () => {
    const { storage } = memoryStorage();
    expect(safeLocalStorage(() => storage)).toBe(storage);
  });

  it('falls back to a null-reading, no-op storage when the getter throws', () => {
    const storage = safeLocalStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => {
      storage.setItem(BEST_STARS_KEY, '{"skeleton-01":3}');
    }).not.toThrow();
    expect(storage.getItem(BEST_STARS_KEY)).toBeNull();
    expect(readBestStars(storage)).toEqual({});
  });
});
