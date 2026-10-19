import { describe, expect, it, vi } from 'vitest';
import { compileCourse } from '../../../src/core/course/course.ts';
import { getHole } from '../../../src/core/course/holes/index.ts';
import { createGame } from '../../../src/core/game/machine.ts';
import type { GamePhase, GameState } from '../../../src/core/game/state.ts';
import {
  BEST_STARS_KEY,
  createBestStarsRecorder,
  readBestStars,
} from '../../../src/ui/best-stars.ts';

type StarStorage = Pick<Storage, 'getItem' | 'setItem'>;

const hole = getHole('skeleton-01');
const start = createGame(compileCourse(hole), 1);
const at = (phase: GamePhase, strokes: number): GameState => ({ ...start, phase, strokes });

function spyStorage() {
  const map = new Map<string, string>();
  const storage: StarStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
  };
  return { map, storage };
}

describe('createBestStarsRecorder', () => {
  it('skeleton-01 is par 3', () => {
    expect(hole.par).toBe(3);
  });

  it('records once per transition into holed, not on every holed frame', () => {
    const { map, storage } = spyStorage();
    const recorder = createBestStarsRecorder(storage);
    recorder.update(at('aiming', 0), hole);
    recorder.update(at('rolling', 1), hole);
    for (let i = 0; i < 5; i++) recorder.update(at('holed', 3), hole);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(readBestStars(storage)).toEqual({ 'skeleton-01': 3 });
    expect(map.get(BEST_STARS_KEY)).toBe('{"skeleton-01":3}');
  });

  it('a worse finish after a new hole leaves the stored 3', () => {
    const { storage } = spyStorage();
    const recorder = createBestStarsRecorder(storage);
    recorder.update(at('rolling', 3), hole);
    recorder.update(at('holed', 3), hole);
    recorder.update(at('aiming', 0), hole);
    recorder.update(at('holed', 4), hole);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(readBestStars(storage)).toEqual({ 'skeleton-01': 3 });
  });

  it('records a hole that is already holed on the first update', () => {
    const { storage } = spyStorage();
    createBestStarsRecorder(storage).update(at('holed', 4), hole);
    expect(readBestStars(storage)).toEqual({ 'skeleton-01': 2 });
  });
});
