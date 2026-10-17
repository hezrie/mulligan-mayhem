/**
 * Golden-replay runner. PROTECTED: it and every existing replay file are the physics regression
 * contract. New replay files may be added freely; changing existing ones needs `physics-change`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getHole, listHoleIds } from '../../src/core/course/holes/index.ts';
import { playReplay, ReplayFileSchema, type ReplayFile } from '../../src/core/game/replay.ts';

const DIR = import.meta.dirname;
const replays: [string, ReplayFile][] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, ReplayFileSchema.parse(JSON.parse(readFileSync(join(DIR, f), 'utf8')))]);

describe('golden replays', () => {
  it('exist', () => {
    expect(replays.length).toBeGreaterThanOrEqual(3);
  });

  it.each(replays)('%s reproduces its recorded result exactly', (_file, replay) => {
    expect(replay.expected, 'run `npm run replay:record -- <file>` to record it').toBeDefined();
    const result = playReplay(getHole(replay.holeId), replay.seed, replay.shots);
    expect(result).toEqual(replay.expected);
  });

  it.each(listHoleIds())('hole %s is proven solvable within par + 3 by a replay', (holeId) => {
    const par = getHole(holeId).par;
    const proofs = replays.filter(
      ([, r]) => r.holeId === holeId && r.expected?.holed && r.expected.strokes <= par + 3,
    );
    expect(proofs.length, `add a golden replay that sinks ${holeId}`).toBeGreaterThan(0);
  });
});
