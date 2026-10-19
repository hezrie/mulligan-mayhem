import { parseSettings, type Settings } from '../core/game/settings.ts';
import { SETTINGS_KEY, type KeyValueStorage } from './storage.ts';

export interface SettingsStore {
  get(): Readonly<Settings>;
  /** Merges the patch, re-validates it (invalid fields fall back to defaults) and saves. */
  update(patch: Partial<Settings>): Readonly<Settings>;
  /** Calls fn after every update; the returned function unsubscribes. */
  subscribe(fn: (settings: Readonly<Settings>) => void): () => void;
}

/**
 * Reads storage once and keeps settings in memory, so the game still works when storage is
 * full, disabled or throws. Storage errors are swallowed silently: e2e fails on console.error.
 * Create exactly one store per page; two would each cache and overwrite the other's writes.
 */
export function createSettingsStore(storage: KeyValueStorage | null): SettingsStore {
  let current = parseSettings(readJson(storage));
  const listeners = new Set<(settings: Readonly<Settings>) => void>();

  return {
    get: () => current,
    update(patch) {
      current = parseSettings({ ...current, ...patch });
      write(storage, JSON.stringify(current));
      for (const fn of listeners) fn(current);
      return current;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

function readJson(storage: KeyValueStorage | null): unknown {
  try {
    const raw = storage?.getItem(SETTINGS_KEY) ?? null;
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function write(storage: KeyValueStorage | null, value: string): void {
  try {
    storage?.setItem(SETTINGS_KEY, value);
  } catch {
    // Quota or privacy-mode failure: the in-memory value still holds for this session.
  }
}
