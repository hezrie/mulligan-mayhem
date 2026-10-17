/**
 * Seeds the first backlog (Phase 8): 12 Definition-of-Ready tickets with dependencies. The
 * first three are `status:ready`; the rest wait as `status:proposed` until the owner promotes
 * them. Idempotent: a ticket whose exact title already exists (open or closed) is reused, so
 * re-running only creates what is missing and resolves "Blocked by" against real numbers.
 *
 *   GITHUB_REPOSITORY=hezrie/mulligan-mayhem npm run setup:backlog
 *
 * PROTECTED.
 */
import { pathToFileURL } from 'node:url';
import { STATUS } from '../agent/labels.ts';
import {
  definitionOfReadyProblems,
  renderTicketBody,
  type TicketSpec,
} from '../agent/ticket-format.ts';
import { execGhClient, repoFromEnv, type GhClient } from '../agent/tracker/gh-client.ts';
import { GitHubTracker } from '../agent/tracker/github.ts';

export interface SeedTicket extends Omit<TicketSpec, 'dependencies'> {
  readonly key: string;
  readonly title: string;
  readonly ready: boolean;
  /** Keys of earlier seed tickets this one is blocked by. */
  readonly blockedBy: readonly string[];
}

const PALETTE_NOTE =
  'TypeScript requires a colour for every terrain kind in `src/render/palette.ts`. That one-line entry is mechanical and does not count as a second area.';

export const BACKLOG: readonly SeedTicket[] = [
  {
    key: 'rough-sand',
    title: 'Rough and sand terrain',
    ready: true,
    blockedBy: [],
    size: 'S',
    priority: 'P1',
    type: 'feature',
    problem:
      'Every hole is plain fairway, so there is nothing to aim around. Rough and sand give players areas to avoid: the ball slows down much faster on them.',
    criteria: [
      '`TERRAIN_KINDS` includes `rough` and `sand`, with `TERRAIN.rough.rollingDecel` = 720 (2× fairway) and `TERRAIN.sand.rollingDecel` = 1080 (3× fairway), labels "Rough" and "Sand" (unit test on `src/core/physics/terrain.ts`).',
      'Given a ball at speed 400 on a test hole whose base terrain is sand, when stepped until rest, then its stopping distance is within 3% of one third of the same roll on fairway (unit test on `step`; fixed steps and the rest threshold make it about 1.5% off the ideal third).',
      'Given the same roll on rough, its stopping distance is within 3% of one half of the fairway roll (unit test on `step`).',
      'A ball rolling from fairway into a sand zone polygon decelerates at the sand rate only while its centre is inside the zone (unit test on `step` with a zone).',
      '`HoleSchema` accepts zones of kind `rough` and `sand` and still rejects an unknown kind (unit test on the schema).',
      'Each new kind has its own colour in `TERRAIN_COLORS`: rough `#3e8e41`, sand `#e6d3a3`, and all terrain colours are distinct (unit test).',
      'All existing golden replays pass unchanged (`tests/replays`).',
    ],
    outOfScope: [
      'Placing rough or sand on any existing hole',
      'Ice, water, slopes or any other terrain',
      'Changing any existing constant in `constants.ts` or the fairway parameters',
      'New or modified golden replays',
    ],
    notes: `Area: \`core/physics\`. ${PALETTE_NOTE}`,
  },
  {
    key: 'share-card',
    title: 'Share-card text builder',
    ready: true,
    blockedBy: [],
    size: 'S',
    priority: 'P1',
    type: 'feature',
    problem:
      'Players will compare Daily Course results in the family group chat. We need a pure function that turns a round into the exact share-card text described in docs/GAME_DESIGN.md → Share card.',
    criteria: [
      '`shareCardText(date, holes)` in `src/core/scoring/share-card.ts` takes a `YYYY-MM-DD` string and a non-empty list of `{ strokes, par }`, and returns exactly two lines: `Mulligan Mayhem — <date>` and `<one emoji per hole>  <total strokes> (<total vs par>)`, with two spaces before the total (unit test).',
      'The emoji for each hole comes from the existing `scoreEmoji(strokes, par)` (unit test with one hole of each of the five emoji).',
      'Total vs par is `+N` when over, `-N` when under (ASCII hyphen) and `E` when even: total 31 on par 30 gives `31 (+1)`, 27 on 27 gives `27 (E)`, 25 on 27 gives `25 (-2)` (unit test).',
      'Strokes `[2,3,4,4,3,2,3,7,3]` on pars `[3,3,4,3,3,4,3,4,3]` for date `2026-10-17` reproduce the GAME_DESIGN.md example exactly: `Mulligan Mayhem — 2026-10-17` then `🟩⬜⬜🟨⬜🟦⬜🟥⬜  31 (+1)` (unit test).',
      'It throws an `Error` with a clear message for an empty hole list, a date not matching `YYYY-MM-DD`, or strokes or par that are not positive integers (unit test).',
    ],
    outOfScope: [
      'Any UI, button or clipboard access',
      'Deciding which date is "today" (an open product question)',
      'Party Mode scoring',
    ],
    notes:
      'Area: `core/scoring`. Writing even par as `E` follows golf convention; the owner can change it later.',
  },
  {
    key: 'ice',
    title: 'Ice terrain',
    ready: true,
    blockedBy: [],
    size: 'S',
    priority: 'P2',
    type: 'feature',
    problem:
      'Ice makes holes trickier: the ball barely slows down, so players have to judge power carefully.',
    criteria: [
      '`TERRAIN_KINDS` includes `ice` with `TERRAIN.ice.rollingDecel` = 90 (one quarter of fairway) and label "Ice" (unit test).',
      'Given a ball at speed 400 on a test hole whose base terrain is ice (with room for about 900 units of straight roll), its stopping distance is within 3% of 4× the same roll on fairway (unit test on `step`).',
      'Invariant: a full-power shot in each of 16 evenly spaced directions on an ice-based test hole comes to rest naturally, before the `MAX_ROLL_STEPS` safety cap (invariant test).',
      'Ice has its own colour `#bfe6ff` in `TERRAIN_COLORS`, distinct from every other terrain colour (unit test).',
      'All existing golden replays pass unchanged (`tests/replays`).',
    ],
    outOfScope: [
      'The Banana Peel Chaos Card',
      'Placing ice on any existing hole',
      'Changing existing constants or terrain parameters',
    ],
    notes: `Area: \`core/physics\`. ${PALETTE_NOTE}`,
  },
  {
    key: 'dogleg',
    title: 'Second hole: dogleg with a sand trap',
    ready: false,
    blockedBy: ['rough-sand'],
    size: 'S',
    priority: 'P2',
    type: 'feature',
    problem:
      'The game has a single hole. A second handcrafted hole exercises the new terrain in real play and gives multi-hole play real content.',
    criteria: [
      'New `src/core/course/holes/dogleg-02.json`: id `dogleg-02`, name "Dogleg", par 3, an L-shaped boundary with the cup out of direct line from the tee, and one sand zone on the inside of the bend. It passes `HoleSchema` validation at load (existing hole-loading test).',
      '`holes/index.ts` registers it, so the hole list is `[skeleton-01, dogleg-02]` in that order (unit test).',
      'A new golden replay `tests/replays/dogleg-02-par.json`, recorded with `npm run replay:record`, sinks the ball in exactly 3 strokes (replay test).',
      'A second new replay `tests/replays/dogleg-02-sand.json` whose first shot stops inside the sand zone; a unit test plays it with `playReplay` and asserts the first rest position lies inside the sand polygon.',
      'The game still starts on `skeleton-01`, and every existing e2e test passes.',
    ],
    outOfScope: [
      'Hole selection UI or course progression',
      'Any change to `skeleton-01` or its replays',
      'New terrain kinds',
    ],
    notes:
      'Area: `core/course`. Adding new replay files is allowed, but CODEOWNERS covers `tests/replays/`, so this PR always needs the owner to merge it.',
  },
  {
    key: 'water',
    title: 'Water hazard with penalty stroke',
    ready: false,
    blockedBy: [],
    size: 'M',
    priority: 'P1',
    type: 'feature',
    problem:
      'Water is the classic mini-golf hazard: rolling into it costs a penalty stroke and the ball goes back to where it last rested (docs/GAME_DESIGN.md → Terrain).',
    criteria: [
      '`TERRAIN_KINDS` includes `water` (colour `#3a7bd5`). `step` reports when the ball centre lies in a water zone at the end of a step (unit test on `step`).',
      'When that happens, the game enters a new `hazard` phase for exactly `HAZARD_PAUSE_STEPS` = 60 steps (0.5 s). Then the ball is placed at `lastRest` with zero velocity, `strokes` goes up by 1 (penalty), and the phase returns to `aiming` (unit test on `tick`).',
      '`shoot` is rejected during `hazard`, as it is during `rolling` (unit test).',
      '`HoleSchema` rejects a hole whose tee or cup lies inside a water zone (unit test).',
      '`hashState` distinguishes `hazard` from `aiming` and `rolling` (unit test).',
      'All existing golden replays pass unchanged (`tests/replays`).',
    ],
    outOfScope: [
      'Splash effects or any other juice',
      'Putting water on any existing hole',
      'Letting the player choose a drop position',
    ],
    notes: `Areas: \`core/physics\` + \`core/game\`. ${PALETTE_NOTE} If the HUD or renderer switch exhaustively on the phase, the one-line \`hazard\` case TypeScript demands is mechanical too. \`lastRest\` already exists in \`GameState\`. Size M: plan first.`,
  },
  {
    key: 'slope',
    title: 'Slope terrain',
    ready: false,
    blockedBy: [],
    size: 'M',
    priority: 'P2',
    type: 'feature',
    problem:
      'Slopes push the ball in one direction while it rolls over them, which makes players aim off-line (docs/GAME_DESIGN.md → Terrain).',
    criteria: [
      '`TERRAIN_KINDS` includes `slope` with fairway friction (360) and colour `#7cc47f`. A slope zone has a `force: { x, y }` in units/s² that is applied to the ball while its centre is inside the zone (unit test on `step`).',
      '`HoleSchema` requires `force` on slope zones, rejects it on every other kind, and rejects a force magnitude above 180, half the fairway deceleration (unit tests).',
      'A ball at rest on a slope stays exactly where it is for 600 steps: its position does not change (unit test).',
      'A roll along the force direction travels farther than the same roll on flat fairway, and a roll against it travels less far (unit test).',
      'A roll across the slope curves toward the force: the ball ends on the force side of its starting line (unit test).',
      'Invariant: 200 seeded random shots on a slope test hole all come to rest naturally, before `MAX_ROLL_STEPS` (invariant test).',
      'All existing golden replays pass unchanged.',
    ],
    outOfScope: [
      'Drawing slope arrows (the colour alone is enough for now)',
      'Placing slopes on existing holes',
      'Moving obstacles',
    ],
    notes: `Areas: \`core/physics\` + \`core/course\` (schema). ${PALETTE_NOTE} Keeping the force below friction means a rolling ball still stops; make sure a resting ball doesn't creep (e.g. apply the force only while the ball moves). Size M: plan first.`,
  },
  {
    key: 'course',
    title: 'Play several holes in a row',
    ready: false,
    blockedBy: ['dogleg'],
    size: 'M',
    priority: 'P1',
    type: 'feature',
    problem:
      'A round should be a course of holes with a scorecard at the end, not one hole on repeat. The Daily Course and best scores build on this.',
    criteria: [
      'A pure course model in `src/core/game/course.ts` has an `id`, the ordered holes, the current hole index and a result per finished hole `{ holeId, strokes, par }`, plus `nextHole` and `isFinished` transitions (unit tests).',
      'The default course has id `classic` and every registered hole in order (unit test).',
      'After holing any hole but the last, the completion screen shows a **Next hole** button that loads the next hole at its tee with 0 strokes (e2e via `window.__MM__`).',
      'After the last hole, a scorecard screen lists each hole with its strokes and par, plus the total vs par as `+N`, `-N` or `E` (unit test on the scorecard model + e2e).',
      'A **Play again** button on the scorecard restarts the course from hole 1 with no results (e2e).',
      '`hashCourse` changes whenever any hole result changes (unit test).',
      'All existing golden replays pass unchanged.',
    ],
    outOfScope: [
      'The Daily Course and its generator',
      'The share-card button',
      'Best scores and local storage',
      'Party Mode',
    ],
    notes:
      'Areas: `core/game` + `ui`. Adding course readouts or a `nextHole` command to `src/testing/api.ts` for e2e is test plumbing, not a third area. Size M: plan first.',
  },
  {
    key: 'copy-card',
    title: 'Copy-result button on the scorecard',
    ready: false,
    blockedBy: ['share-card', 'course'],
    size: 'S',
    priority: 'P2',
    type: 'feature',
    problem:
      'Players should be able to paste their result into a group chat with one tap from the end-of-course scorecard.',
    criteria: [
      "The scorecard has a **Copy result** button that writes `shareCardText(date, results)` to the clipboard. The date is the date of play in the player's local timezone, formatted `YYYY-MM-DD` (e2e in Chromium with clipboard permission, reading the clipboard back).",
      'After a successful copy, the button reads "Copied!" for 2 seconds, then reverts (e2e).',
      'If `navigator.clipboard` is missing or `writeText` rejects, the text appears in a read-only, pre-selected textarea instead, with no console error (e2e with the clipboard stubbed).',
    ],
    outOfScope: [
      'The Web Share API or image share cards',
      'Choosing the Daily Course day boundary (still an open product question)',
    ],
    notes: 'Area: `ui`.',
  },
  {
    key: 'best-score',
    title: 'Remember the best course score',
    ready: false,
    blockedBy: ['course'],
    size: 'S',
    priority: 'P3',
    type: 'feature',
    problem:
      'Players want to know whether they beat their own record. Scores stay on the device: no accounts or backend.',
    criteria: [
      'A pure `updateBest(previous, total)` returns the lower of the two, treating a missing or invalid previous value as no record (unit test).',
      'When a course finishes, the total is saved under the local storage key `mm:best:<courseId>` if it beats the stored value (e2e: finish, reload, see the stored best).',
      'The scorecard shows "Best: N", and "New best!" when the round improved it (e2e).',
      'A corrupt or non-numeric stored value is ignored and overwritten, and a storage that throws (private mode) never breaks the game or logs a console error (unit test with a throwing storage stub).',
    ],
    outOfScope: ['Per-hole bests', 'Daily Course history', 'Any sync or backend'],
    notes: 'Area: `ui`. Storage access stays outside `src/core` (layer rules).',
  },
  {
    key: 'generator',
    title: 'Daily Course: seeded hole generator',
    ready: false,
    blockedBy: ['rough-sand'],
    size: 'M',
    priority: 'P1',
    type: 'feature',
    problem:
      'The Daily Course needs 9 holes generated from a seed, identical on every device and browser (docs/GAME_DESIGN.md → Daily Course, ADR 0001). This ticket covers the generator only; solvability is the next ticket.',
    criteria: [
      '`generateHole(seed, index)` in `src/core/course/generator.ts` is pure: the same inputs give a deep-equal hole and the same hash (unit test).',
      'For seeds 1–500 and indices 0–8, every generated hole passes `HoleSchema` validation (property test).',
      'Across that sample, generated holes use only fairway, rough and sand, have 0–4 interior walls and a par of 2–5 (unit test).',
      '`seedForDate("YYYY-MM-DD")` maps a date string to an unsigned 32-bit seed using FNV-1a. Every day across three years gets a distinct seed (unit test). Which date counts as "today" stays out of scope.',
      'The hole for seed 12345, index 0 has the same hash in Chromium (read through `window.__MM__`) as in Node (e2e).',
    ],
    outOfScope: [
      'Checking that holes are solvable (next ticket)',
      'Any Daily Course UI',
      'Choosing the day boundary (an open product question)',
    ],
    notes:
      'Areas: `core/course` (+ the e2e hash check, which is test plumbing). Randomness only from `core/rng.ts`. Size M: plan first.',
  },
  {
    key: 'solver',
    title: 'Daily Course: solvability bot and par + 3 gate',
    ready: false,
    blockedBy: ['generator'],
    size: 'M',
    priority: 'P1',
    type: 'feature',
    problem:
      'Every generated hole must be provably solvable: a search bot has to sink it within par + 3 before the hole is accepted (docs/GAME_DESIGN.md → Daily Course).',
    criteria: [
      '`solveHole(hole)` in `src/core/course/solver.ts` searches shots on a fixed grid of 72 angles × 8 powers using the real physics `step`, up to `par + 3` strokes, and returns the shot list or `null` (unit test: it solves `skeleton-01`, and replaying the returned shots holes the ball).',
      'A fixture hole whose cup is fully enclosed by walls returns `null` (unit test).',
      'The solver is deterministic (same hole, same shots) and gives up after 2,000,000 simulated physics steps per hole (unit tests).',
      "`generateDailyCourse(seed)` returns 9 holes. A hole the solver can't sink within par + 3 is regenerated from the next sub-seed, up to 20 tries per slot, and then it throws (unit test with a stubbed generator).",
      'For one sample seed, every hole of the generated course is solvable within par + 3, and that test file finishes in under 60 s on CI (unit test).',
    ],
    outOfScope: [
      'Daily Course UI',
      'Difficulty tuning beyond the par + 3 gate',
      "Showing the bot's solution to players",
    ],
    notes: 'Area: `core/course`. Size M: plan first.',
  },
  {
    key: 'trail',
    title: 'Ball trail while rolling',
    ready: false,
    blockedBy: [],
    size: 'S',
    priority: 'P3',
    type: 'feature',
    problem:
      'A short fading trail behind the rolling ball makes shots easier to read and feel juicier (docs/GAME_DESIGN.md → Juice).',
    criteria: [
      'A pure `trailPoints(history)` in `src/render/trail.ts` returns the last 12 ball positions with alpha falling linearly from 0.5 (newest) to 0 (oldest) (unit test).',
      'The renderer draws the trail only while the ball is rolling. The history resets on restart and when a new shot starts (unit test on the trail buffer).',
      'The trail lives in `src/render` only: `GameState` is unchanged and every golden replay passes unchanged.',
      'No console errors during a full e2e play-through (existing zero-console-errors fixture).',
    ],
    outOfScope: ['Confetti, screen shake or sounds', 'Any change to physics or game state'],
    notes: 'Area: `render`.',
  },
];

/** Problems with the backlog itself: DoR, dependency order and the ready set. Empty means OK. */
export function backlogProblems(backlog: readonly SeedTicket[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of backlog) {
    if (seen.has(t.key)) problems.push(`duplicate key ${t.key}`);
    for (const dep of t.blockedBy)
      if (!seen.has(dep)) problems.push(`${t.key}: "${dep}" must be an earlier ticket`);
    if (t.ready && t.blockedBy.length > 0)
      problems.push(`${t.key}: a ready ticket can't be blocked`);
    for (const p of definitionOfReadyProblems(renderSeed(t, () => 1)))
      problems.push(`${t.key}: ${p}`);
    seen.add(t.key);
  }
  return problems;
}

export function renderSeed(t: SeedTicket, numberOf: (key: string) => number): string {
  return renderTicketBody({ ...t, dependencies: t.blockedBy.map(numberOf) });
}

export function seedLabels(t: SeedTicket): string[] {
  return [
    t.ready ? STATUS.ready : STATUS.proposed,
    `size:${t.size}`,
    `priority:${t.priority}`,
    `type:${t.type}`,
  ];
}

interface RestIssue {
  number: number;
  title: string;
  pull_request?: unknown;
}

export async function seedBacklog(
  gh: GhClient,
  repo: string,
  backlog: readonly SeedTicket[] = BACKLOG,
): Promise<{ key: string; number: number; created: boolean }[]> {
  const problems = backlogProblems(backlog);
  if (problems.length) throw new Error(`backlog is not ready:\n${problems.join('\n')}`);
  const existing = new Map(
    (await gh.restAll<RestIssue>(`repos/${repo}/issues?state=all&per_page=100`))
      .filter((i) => i.pull_request === undefined)
      .map((i) => [i.title, i.number]),
  );
  const tracker = new GitHubTracker(gh, repo);
  const numbers = new Map<string, number>();
  const numberOf = (key: string): number => {
    const n = numbers.get(key);
    if (n === undefined) throw new Error(`no issue number for ${key}`);
    return n;
  };
  const results: { key: string; number: number; created: boolean }[] = [];
  for (const t of backlog) {
    const found = existing.get(t.title);
    const number =
      found ??
      (await tracker.createTicket({
        title: t.title,
        body: renderSeed(t, numberOf),
        labels: seedLabels(t),
      }));
    numbers.set(t.key, number);
    results.push({ key: t.key, number, created: found === undefined });
  }
  return results;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  seedBacklog(execGhClient(), repoFromEnv())
    .then((results) => {
      for (const r of results)
        console.log(`${r.created ? 'created' : 'exists '} #${String(r.number)} ${r.key}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
