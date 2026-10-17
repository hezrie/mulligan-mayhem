/**
 * Fills in the `expected` block of a golden replay file by actually playing its shots.
 *
 *   npm run replay:record -- tests/replays/<name>.json            # new replay (no expected yet)
 *   npm run replay:record -- tests/replays/<name>.json --update   # re-record (physics-change only)
 *
 * Always review the recorded result before committing: it becomes the regression contract.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getHole } from '../src/core/course/holes/index.ts';
import { playReplay, ReplayFileSchema } from '../src/core/game/replay.ts';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: npm run replay:record -- <replay.json> [--update]');
  process.exit(2);
}

const replay = ReplayFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
if (replay.expected && !flags.includes('--update')) {
  console.error(
    `${file} already has an expected result. Changing a golden replay requires the ` +
      '`physics-change` label; re-run with --update only in that case.',
  );
  process.exit(1);
}

const expected = playReplay(getHole(replay.holeId), replay.seed, replay.shots);
writeFileSync(file, `${JSON.stringify({ ...replay, expected }, null, 2)}\n`);
console.log(`Recorded ${file}:`, expected);
