import {
  mergeBestStars,
  parseBestStars,
  totalStars,
  type BestStars,
  type Stars,
} from '../core/scoring/stars.ts';

/** Follows the `mm:best:<courseId>` naming of the best-score keys. */
export const BEST_STARS_KEY = 'mm:stars';

type StarStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Storage errors are swallowed silently: e2e fails on console.error, and stars are never worth a crash. */
export function readBestStars(storage: StarStorage): BestStars {
  try {
    const raw = storage.getItem(BEST_STARS_KEY);
    return raw === null ? {} : parseBestStars(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

/** Keeps the better of the stored and new stars, since stars are never spent. */
export function recordBestStars(storage: StarStorage, holeId: string, stars: Stars): void {
  const best = mergeBestStars(readBestStars(storage), holeId, stars);
  try {
    storage.setItem(BEST_STARS_KEY, JSON.stringify(best));
  } catch {
    // Quota or privacy-mode failure: the star is simply not remembered.
  }
}

/** Only the listed holes count, so stale ids of removed holes never inflate the total. */
export function readStarTotal(storage: StarStorage, holeIds: readonly string[]): number {
  const best = readBestStars(storage);
  const listed: Record<string, Stars> = {};
  for (const id of holeIds) {
    const stars = best[id];
    if (stars !== undefined) listed[id] = stars;
  }
  return totalStars(listed);
}

/** Merely reading `localStorage` throws in some sandboxed or privacy-mode pages. */
export function safeLocalStorage(get: () => StarStorage): StarStorage {
  try {
    return get();
  } catch {
    return {
      getItem: () => null,
      setItem: () => undefined,
    };
  }
}
