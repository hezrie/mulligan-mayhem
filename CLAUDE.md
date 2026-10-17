# Mulligan Mayhem — Rulebook

Browser mini-golf party game: "Wordle meets mini-golf, plus party chaos". Top-down 2D, drag back to
aim, one shared Daily Course per day, pass-and-play Party Mode with Chaos Cards. Built by an agent
loop under human oversight. **Read this file and `.agent/LESSONS.md` before doing anything.**

## Commands

| Command                 | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `npm run dev`           | Play locally at http://localhost:5173/mulligan-mayhem/               |
| `npm test`              | Unit + invariant + golden-replay tests (fast; run constantly)        |
| `npx vitest run <path>` | Run a subset, e.g. `npx vitest run tests/unit/core/physics`          |
| `npm run test:coverage` | Same as `npm test` plus coverage gates (core: 90% lines, 85% branch) |
| `npm run test:e2e`      | Builds, then Playwright on desktop + Pixel 7 + prod smoke            |
| `npm run typecheck`     | `tsc -b`, strict                                                     |
| `npm run lint`          | ESLint + layer rules (dependency-cruiser) + Prettier check           |
| `npm run format`        | Prettier write                                                       |
| `npm run replay:record` | Create a new golden replay file from shots (see "How to")            |
| **`npm run check`**     | **Everything CI runs, in CI order. Must pass before you stop.**      |

## Layer map (enforced by ESLint + dependency-cruiser — violations fail CI)

```
src/core/     pure TS, deterministic. Imports only src/core and zod. No DOM, Date, Math.random,
              timers, console, or engine-dependent Math (sin/cos/atan2/pow/exp/log/hypot/**).
  math/       vec2, geometry, deterministic trig
  rng.ts      seeded PRNG — the ONLY source of randomness
  physics/    fixed-step simulation (dt = 1/120 s), collisions, terrain friction, rest detection
  course/     hole schemas (zod) + holes as JSON data
  game/       state machine (aiming → rolling → aiming | holed) + GameSession
  scoring/    strokes, par, score names
  hash.ts     stable state hash (replays + determinism tests)
src/input/    pointer/touch → Shot { angle, power 0..1 }      (may import core only)
src/render/   canvas renderer; reads state, never mutates it  (may import core only)
src/ui/       DOM HUD, menus, hole-complete screen            (may import core only)
src/testing/  window.__MM__ test API, dev/test builds only    (may import core only)
src/main.ts   wiring only (≤120 lines, enforced)
```

Details, data flow and the hole schema: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Why custom
physics and IEEE-exact math: [docs/decisions/0001-custom-deterministic-physics.md](docs/decisions/0001-custom-deterministic-physics.md).

## Non-negotiables

1. **Tests are the contract.** Done means `npm run check` passes in CI, not that you say so.
2. **Test first.** Write failing tests from the acceptance criteria, then implement.
3. **Never weaken a test** to make it pass: no deleting, skipping, loosening assertions, or
   changing a test's intent. Focus/skip/todo markers and dropping test counts fail CI.
4. **Stay in scope.** Do only what the ticket asks. Follow-ups go in the PR body as proposed tickets.
5. **Determinism.** Same hole + seed + shots ⇒ identical state hash, on every engine. Core uses
   only `+ − × ÷ Math.sqrt`, integer ops and the helpers in `src/core/math`.
6. **Holes are data** (JSON validated by zod at load), never code.
7. **Render and UI never mutate game state.** They receive `Readonly` views.

## Coding conventions

- TypeScript strict; no `any`, no `@ts-ignore`, no non-null `!` in `src/`.
- Pure functions and immutable data in core; state transitions return new objects.
- Named exports only. File names in kebab-case. Imports use explicit `.ts` extensions.
- Units: world units (1 unit = 1 CSS px at scale 1), seconds, radians. Screen y points down;
  angle 0 = +x, π/2 = +y (down the screen). Shot power is normalized 0..1.
- Tuning constants live in one place (`src/core/physics/constants.ts`), named and commented.
- Comments explain _why_, not _what_. Keep functions small; prefer clarity over cleverness.
- Conventional commits: `feat(physics): add sand friction (#12)`. Branch: `agent/<issue>-<slug>`.

## Definition of Ready / Done

- A ticket is workable only if it meets [docs/DEFINITION_OF_READY.md](docs/DEFINITION_OF_READY.md).
- A PR is mergeable only if it meets [docs/DEFINITION_OF_DONE.md](docs/DEFINITION_OF_DONE.md).
- The PR body maps **every acceptance criterion → the test that proves it**, and says `Closes #N`.
- UI changes attach screenshots (the e2e run uploads them as CI artifacts).

## Protected paths (hooks block edits; CI `agent-guard` fails the PR; CODEOWNERS = @hezrie)

The canonical list is `protectedPaths` in `agent.config.json`. In short: `.github/`, `.claude/`,
`.agent/prompts/`, `.agent/LESSONS.md`, `.gitignore`, `CLAUDE.md`, `PLAN.md`, `agent.config.json`,
`scripts/agent/`, `scripts/setup/`, `scripts/check-test-integrity.ts`, `package.json`,
`package-lock.json`, `.nvmrc`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`,
`playwright.config.ts`, `eslint.config.js`, `.dependency-cruiser.cjs`, Prettier config,
`e2e/fixtures.ts`, `docs/DEFINITION_OF_*.md`, `docs/decisions/`, and tool config that Claude Code
or git would execute: `.mcp.json`, `.claude.json`, `CLAUDE.local.md`, `.husky/`, `.gitmodules`, `.ripgreprc`.

**Golden replays** (`tests/replays/`): you may **add** new replay files. Changing or deleting an
existing one requires the ticket label `physics-change` (the worker then runs with
`AGENT_ALLOW_GOLDEN=1`). Needing a new npm dependency means changing `package.json`: escalate.

## Escalation — stop, explain, and label the ticket `status:needs-human` when:

- an acceptance criterion cannot be met as written;
- the change would exceed the ticket's scope or size (S ≤ ~150 lines, M ≤ ~400);
- a protected file needs changing (including adding a dependency);
- a product or design decision is not specified;
- a test is flaky (passes and fails without code changes);
- your attempts are exhausted.

To escalate: `npx tsx scripts/agent/escalate.ts "<one-paragraph reason>"`, then stop.
**Never "make it pass" by changing a test's intent.** An honest escalation is a good outcome.

## How to…

**Add a hole.** Create `src/core/course/holes/<id>.json` matching `HoleSchema`
(`src/core/course/schema.ts`; fields documented in ARCHITECTURE.md), register it in
`src/core/course/holes/index.ts`, then add a golden replay that sinks it at or under par + 3
(`npm run replay:record -- tests/replays/<id>-<name>.json` after writing the shots). Schema
errors fail `tests/unit/core/course/holes.test.ts`.

**Add a terrain.** Add the kind to `TERRAIN_KINDS` and its parameters to the `TERRAIN` table in
`src/core/physics/terrain.ts` (the zod schema derives from it), give it a colour in
`src/render/palette.ts`, add unit tests for its friction/effect, make sure the invariant sweep in
`tests/invariants/` covers it, and add a fixture hole under `tests/fixtures/holes/` exercising it.

**Add a test.**

- Unit: `tests/unit/<mirror of src path>.test.ts`. Core tests must not touch the DOM.
- Invariant (properties that must hold for many seeded random shots): `tests/invariants/`.
- Golden replay: write `{ description, holeId, seed, shots }` in a **new** file under
  `tests/replays/`, run `npm run replay:record -- <file>` to fill `expected`, review it, commit.
- E2E: `e2e/<name>.spec.ts`; import `test`/`expect` from `./fixtures.ts` (fails on console
  errors); drive the game through `window.__MM__` (`loadHole`, `shoot`, `fastForward`,
  `getState`, `getStateHash`); save screenshots under `test-results/screenshots/`.

## More

- Product vision and rules: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)
- The agent loop, labels and autonomy levels: [docs/WORKFLOW.md](docs/WORKFLOW.md)
- Past failures and the rules they produced: [.agent/LESSONS.md](.agent/LESSONS.md)
