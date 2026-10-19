import { emptySave, parseSave, type Save } from '../core/game/save.ts';
import { SAVE_CORRUPT_KEY, SAVE_KEY, type KeyValueStorage } from './storage.ts';

export interface SaveStore {
  get(): Readonly<Save>;
  /** Applies fn to the current save, keeps the result in memory and persists it. */
  update(fn: (save: Save) => Save): Readonly<Save>;
}

/**
 * Reads storage once and keeps the save in memory, so the game still works when storage is
 * full, disabled or throws. Storage errors are swallowed silently: e2e fails on console.error.
 * Create exactly one store per page; two would each cache and overwrite the other's writes.
 */
export function createSaveStore(storage: KeyValueStorage | null): SaveStore {
  let current = load(storage);

  return {
    get: () => current,
    update(fn) {
      current = fn(current);
      write(storage, SAVE_KEY, JSON.stringify(current));
      return current;
    },
  };
}

/** A corrupt save is copied aside before the reset, so progress never vanishes without a trace. */
function load(storage: KeyValueStorage | null): Save {
  const raw = read(storage);
  if (raw === null) return emptySave();
  const { save, corrupt } = parseSave(parseJson(raw));
  if (corrupt) {
    write(storage, SAVE_CORRUPT_KEY, raw);
    write(storage, SAVE_KEY, JSON.stringify(save));
  }
  return save;
}

function read(storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(SAVE_KEY) ?? null;
  } catch {
    return null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // undefined fails the schema, so parseSave marks it corrupt.
    return undefined;
  }
}

function write(storage: KeyValueStorage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Quota or privacy-mode failure: the in-memory save still holds for this session.
  }
}
