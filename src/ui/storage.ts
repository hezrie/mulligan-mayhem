/** The slice of Web Storage the stores use, so tests can inject a plain fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned so a future settings v2 can migrate from v1 instead of misreading it. */
export const SETTINGS_KEY = 'mm.settings.v1';
export const SAVE_KEY = 'mm.save.v1';
/** Holds the last unreadable save verbatim, so lost progress can still be recovered by hand. */
export const SAVE_CORRUPT_KEY = 'mm.save.corrupt';

/**
 * Returns the host's localStorage, or null when merely reading the property throws
 * (some browsers do that when storage is disabled or the page is sandboxed).
 */
export function getBrowserStorage(host: {
  readonly localStorage: KeyValueStorage;
}): KeyValueStorage | null {
  try {
    return host.localStorage;
  } catch {
    return null;
  }
}
