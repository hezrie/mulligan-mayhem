import { describe, expect, it } from 'vitest';
import { SETTINGS_KEY, getBrowserStorage, type KeyValueStorage } from '../../../src/ui/storage.ts';

describe('SETTINGS_KEY', () => {
  it('is the versioned settings key', () => {
    expect(SETTINGS_KEY).toBe('mm.settings.v1');
  });
});

describe('getBrowserStorage', () => {
  it('returns host.localStorage', () => {
    const localStorage: KeyValueStorage = { getItem: () => null, setItem: () => undefined };
    expect(getBrowserStorage({ localStorage })).toBe(localStorage);
  });

  it('returns null when reading localStorage throws', () => {
    const host = {
      get localStorage(): KeyValueStorage {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(getBrowserStorage(host)).toBeNull();
  });
});
