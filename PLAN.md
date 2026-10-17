# Mulligan Mayhem — Foundation Plan

> Living document. Updated and committed at the end of every phase so it always reflects reality.

## Status

| Phase | Scope                  | Status                            |
| ----- | ---------------------- | --------------------------------- |
| 0     | Recon & plan           | ✅ Approved 2026-10-17            |
| 1     | Scaffold & tooling     | ✅ Done                           |
| 2     | Rulebook               | ✅ Done                           |
| 3     | Walking skeleton       | ✅ Done                           |
| 4     | Guardrails             | ✅ Done                           |
| 5     | CI/CD + repo + Pages   | ✅ Done                           |
| 6     | Ticket system          | ✅ Done                           |
| 7     | Agent workflows        | ✅ Done (after a security review) |
| 8     | Seed backlog & dry run | ⏳                                |

## Decisions (Phase 0)

| Question                 | Answer                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Repo owner and CODEOWNER | `@hezrie` → `hezrie/mulligan-mayhem`                                                         |
| Visibility               | **Public**: free Pages, branch protection, CODEOWNERS enforcement, unlimited Actions minutes |
| Bot identity             | **GitHub App** that you create (no admin bypass, no Workflows permission)                    |
| Commit author            | `hezrie <328370658+hezrie@users.noreply.github.com>`, set **repo-locally** only              |
| Deploy URL (expected)    | `https://hezrie.github.io/mulligan-mayhem/`                                                  |

## Environment recon

| Tool       | Found       | Notes                                                                              |
| ---------- | ----------- | ---------------------------------------------------------------------------------- |
| node       | v24.15.0    | Node 24 is Active LTS today. Pin `24` in `.nvmrc` and `engines: ">=24 <25"`.       |
| npm        | 11.12.1     | ✓                                                                                  |
| git        | 2.50.1      | No global identity configured. I'll set it repo-locally.                           |
| gh         | 2.98.0      | Two logins: `NextLED` (active) and `hezrie`, both with `repo` + `workflow` scopes. |
| jq         | 1.7.1       | ✓ (also preinstalled on GitHub runners)                                            |
| claude CLI | not on PATH | Only needed for **you** to run `claude setup-token` (Phase 7).                     |

Latest relevant packages: vite 8.3, vitest 5.0 (+ coverage-v8), eslint 10.12, typescript-eslint 8.71, @playwright/test 1.64, prettier 3.9, dependency-cruiser 18.5, tsx 4.23, zod 4.6.

## Deviations from the brief, and why

1. **TypeScript is pinned to 6.0.x, not `latest` (7.0).** TS 7 is the native Go port. typescript-eslint's peer range is `>=4.8.4 <6.1.0`, so type-aware linting breaks on 7. A follow-up ticket will upgrade once typescript-eslint supports it.
2. **The LLM never holds write credentials.** Every Claude step runs with a read-only, job-scoped `GITHUB_TOKEN` and a narrow `--allowedTools`. All side effects (push, PR create, labels, comments, reviews, merges) happen in **deterministic workflow steps** backed by unit-tested scripts in `scripts/agent/`. Claude hands its results over through files (`.agent/out/pr-body.md`, `plan.md`, `escalation.md`) or a `--json-schema` structured output (the reviewer's verdict).
   - Why: "permissions over instructions". The agent can't push to `main` or merge because it has no credential that can do so, whatever the prompt says.
   - The brief's `permissions.allow` list (`gh pr create` and the rest) stays in `.claude/settings.json` for local and interactive use. CI narrows it further.
   - Side effect: the **Claude GitHub App is optional**. It's only needed if you also want `@claude` mentions.
   - **Hardened in Phase 7: the LLM runs in its own job.** On GitHub-hosted runners every step of a job can read all of that job's secrets, so a "deterministic step" in the _same_ job as Claude isn't a boundary. Each agent workflow is split into _trusted job → LLM job → trusted job_. The LLM job never holds the App token, and its output reaches the next job only as data: a `git bundle`, `result.json` and a few text files. See Phase 7.
3. **GitHub App instead of a PAT for the `AGENT_BOT_TOKEN` role.** Secrets are `AGENT_APP_ID` + `AGENT_APP_PRIVATE_KEY`. Each job mints a short-lived token with `actions/create-github-app-token` and exposes it as `AGENT_BOT_TOKEN`, so the brief's terminology still holds. The App gets no Workflows permission, so **GitHub itself rejects any bot push that touches `.github/workflows/`**.
4. **Approvals come from `github-actions[bot]`.** GitHub forbids approving your own PR, and PRs are authored by the App, so the reviewer submits its review with `GITHUB_TOKEN`. That needs the repo setting "Allow GitHub Actions to create and approve pull requests", which I'll enable via the API.
5. **The merger is a reusable workflow (`workflow_call`).** The reviewer job invokes it after approving, and it can also be run manually (`workflow_dispatch`). Why: events created with `GITHUB_TOKEN` don't trigger workflows, and `workflow_run` chains are capped at 3 levels.
6. **The PR reviewer triggers on CI completion** (`workflow_run` of CI for `agent/*` branches), so CI results exist when it reviews. Plan reviews trigger on `issues: labeled plan:proposed`.
7. **The worker cron is a literal in the YAML.** GitHub can't read cron from JSON at runtime. A **config-sync check** (part of `check:integrity`) fails if the YAML cron ≠ `agent.config.json` `workerCron`. The same check also confirms that `ci.yml` steps match the order of `npm run check`.
8. **New required CI job, `agent-guard`.** On `agent/*` PRs it fails if the diff touches protected paths, or touches `tests/replays/**` without the `physics-change` label. Hooks are the first line of defence, but shell tricks can get around them. This job, plus CODEOWNERS and the App's permissions, is the line they can't cross.
9. **Hook canary.** A `SessionStart` hook writes a marker file, and agent workflows **fail if it's missing**. That proves the guardrails actually loaded in CI. I also pass `settings: .claude/settings.json` to the action explicitly.
10. **How the Stop hook works:**
    - a `PostToolUse` hook on `Edit|Write` stamps `.agent/.state/last-edit`
    - `npm run check` stamps `.agent/.state/last-check-pass` as its final step
    - `scripts/agent/escalate.ts` stamps `.agent/.state/escalated`
    - the hook blocks stopping unless check-pass is newer than last-edit, or the worker escalated
    - _Superseded in Phase 4 by a content fingerprint, which catches edits made through Bash too. See Phase 4 → As built._
11. **Cross-engine determinism.** ESLint bans `Math.sin/cos/tan/atan2/asin/acos/exp/log/pow/hypot/cbrt` in `src/core/**`, and `src/core/math/` provides its own implementations built only from IEEE-exact operations (`+ − × ÷ sqrt`).
    - Why: those built-ins legitimately differ between JS engines (Safari vs Chrome). The Daily Course must be identical on every family phone.
    - Bonus: the Chromium e2e test can assert the **same state hash** as the Node golden replay.
12. **Layers are enforced by two tools.** ESLint handles banned globals and properties (`Date`, `Math.random`, `window`, `document`, `performance`, …). dependency-cruiser handles the import graph. Neither tool can do both jobs.
13. **Core's only allowed third-party dependency is `zod`**, used for the hole/course schemas validated at load. dependency-cruiser enforces this allowlist.
14. **The integrity check catches more than the brief lists, and compares counts per suite.** It also flags `.skipIf`, `.runIf`, `.fails`, Playwright `.fixme`, and `describe.skip`. Counts are compared **separately** for Vitest and Playwright, which is stricter than a combined total: you can't delete e2e tests and pad the count with unit tests. The comparison base is the merge-base with `origin/main`, or `HEAD^` when HEAD is main; it's checked out in a temporary git worktree. Vitest is counted from a real `vitest run --reporter=json` (`numTotalTests`), _not_ `vitest list`, because the list collapses each `it.each` table into one entry. Locally with no base, the count check is skipped with a warning; in CI it fails.
15. **`rm -rf` is allowed only in build-output dirs** (`dist/`, `dist-e2e/`, `coverage/`, `test-results/`, `playwright-report/`, `blob-report/`). The brief also allowed `node_modules/`, but that was removed in Phase 7: an agent that can delete and rebuild `node_modules` can swap the code `npm run check` executes, and `npm install` is blocked anyway.
16. **Extra label `physics-change`.** The hooks rule references it, but the label list doesn't include it.
17. **`agent.config.json` gets three extra keys:**
    - `models`: aliases like `opus`/`sonnet`, so you can tune cost per role
    - `trustedSubmitters`: family GitHub handles whose ideas the refiner processes automatically
    - `workflowTimeoutMinutes`
18. **`.agent/LESSONS.md` is protected too.** Only `AGENT_MODE=digest` may edit `CLAUDE.md` and `LESSONS.md`, and it does so only on a PR that you merge.
19. **Refiner trust gate (this is a public repo).** A deterministic first step checks whether the issue author is OWNER/COLLABORATOR or listed in `trustedSubmitters`. If not, it comments "thanks, waiting for maintainer triage" and stops. It runs once you re-apply `status:needs-refinement`. The issue text always goes into the prompt as untrusted data.
20. **Daily cap and attempt counting** use the run-log issue (JSON comments) as the source of truth, so the picker stays deterministic and testable from a snapshot.
21. **gh account.** In Phase 5 I'll run `gh auth switch --user hezrie`. Afterwards you can switch back with `gh auth switch --user NextLED`.
22. **Protected paths go beyond the brief's list, from a single source of truth** (`protectedPaths` in `agent.config.json`). On top of the brief's list:
    - `package.json`, `package-lock.json`, `.nvmrc` (new dependencies are a supply-chain decision, and an agent could otherwise rewrite the `check` script)
    - `tsconfig*.json`, `vite.config.ts` (it controls `__TEST_API__`), `playwright.config.ts`, Prettier config
    - `e2e/fixtures.ts` (the zero-console-errors gate)
    - `docs/DEFINITION_OF_*.md`, `docs/decisions/`, `PLAN.md`

    Hooks (via `jq`), `agent-guard` and the CODEOWNERS sync test all read the same list.

23. **Golden replays: new files are allowed, edits are not.** Agents may **add** new replay files (needed for "add a hole", and they can't hide a regression). Modifying or deleting an existing replay requires `physics-change`. The hook blocks Edit/overwrite only; `agent-guard` checks git status M/D/R.
24. **Rulebook is tested.** `tests/docs/rulebook.test.ts` enforces CLAUDE.md ≤ 150 lines, checks that CLAUDE.md links every core doc, and checks that no doc has a broken relative link.

## How the loop is wired (who holds which credential)

Each workflow is split into separate jobs, each on a fresh runner. Jobs that run Claude hold only a read-only `GITHUB_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, never the App token.

```
            trusted job (App token)            LLM job (read-only)                  trusted job (fresh App token)
            ───────────────────────            ───────────────────                  ─────────────────────────────
refiner     trust gate, export issue      →    Claude rewrites ticket → files  →    edit issue, labels, split children
worker      pick, label in-progress,      →    Claude edits code, runs check   →    fetch bundle as objects only,
            export ticket/plan/feedback         → git bundle + result.json          agent-guard, push, PR, labels, run log
reviewer    (CI finished on agent/* PR)        Claude → JSON verdict           →    review via GITHUB_TOKEN (github-actions[bot]);
                                                                                     App token labels agent-approved
plan review                                    Claude → JSON verdict           →    plan:approved + approval marker
merger      no LLM: squash-merge iff CI green ∧ reviewer approved this SHA ∧ size allowed at autonomyLevel
            ∧ no protected/golden paths; otherwise one "Ready for human merge" comment per SHA. Hourly sweep.
closer      no LLM: summary comment, strip status labels, architecture-review counter
digest      metrics + digest issue        →    Claude edits CLAUDE.md/LESSONS  →    copy only those 2 files, open rules PR
```

Every agent job honours `vars.AGENT_PAUSED != 'true'`, and every run appends one JSON comment to the pinned "🤖 Agent Run Log" issue #2 (role, issue, outcome, attempts, turns, duration, cost, taken from the action's `execution_file`).

## Phase plan

Every phase ends with `npm run check` green, a conventional commit (`chore(foundation): phase N — …`), and a 3-line status for you.

### Phase 1: Scaffold & tooling

- Vite 8 + TS 6.0 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `base: '/mulligan-mayhem/'`.
- ESLint 10 flat config + typescript-eslint (type-aware) with the core purity rules; dependency-cruiser layer graph; Prettier.
- Vitest 5 + coverage-v8, with thresholds on `src/core/**` (90% lines / 85% branches). Playwright 1.64 on Chromium, Desktop and Pixel 7 projects.
- npm scripts: `dev build preview typecheck lint format format:check test test:coverage test:e2e check:integrity check`.
- `.nvmrc`, `engines`, `.editorconfig`, `.gitignore`, `package-lock.json`.
- **Downloads you're approving:** `npm install` (dev deps only, ~300 packages) and `npx playwright install chromium` (~170 MB from Microsoft's Playwright CDN).
- **Exit:** `npm run check` passes on an empty-but-wired app, including a trivial e2e test.
- **As built:**
  - `test:e2e` builds two bundles: `dist/` (prod) and `dist-e2e/` (`--mode e2e`, with `window.__MM__`).
  - Playwright runs `desktop` + `mobile` (Pixel 7) against `dist-e2e`, and a `prod-smoke` project against the real `dist` that asserts no `__MM__` at runtime _or_ in the bundle.
  - A shared fixture fails any test that logs a console error.
  - Playwright retries are 0, so flakiness surfaces instead of being hidden.
  - Every gate was verified with throwaway probes:
    - ESLint purity rules
    - every depcruise layer rule
    - the coverage threshold (fails at 60%)
    - the integrity scan (fails on a planted focus marker)

### Phase 2: Rulebook

- `CLAUDE.md` (≤150 lines). Covers the purpose, layer map, exact commands, conventions, DoR/DoD links, protected paths, escalation rules, and "how to add a hole / a terrain / a test".
- Supporting docs:
  - `docs/GAME_DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/DEFINITION_OF_READY.md`, `docs/DEFINITION_OF_DONE.md`
  - `docs/WORKFLOW.md`, written for you: the loop, labels, autonomy levels, the kill switch, and what to do when something is `needs-human`
  - `docs/decisions/0001-custom-deterministic-physics.md`, covering fixed timestep, swept collisions, IEEE-exact math, and state hashing
  - `.agent/LESSONS.md`: a format header and nothing else yet
- **Exit:** docs cross-link correctly; check green.

- **As built:** CLAUDE.md is 126 lines. The docs commit Phase 3 to some specific names, which must exist when Phase 3 ends:
  - `npm run replay:record`
  - `TERRAIN_KINDS` / `TERRAIN` in `core/physics/terrain.ts`, and terrain `zones` in the schema
  - `src/render/palette.ts`
  - `tests/unit/core/course/holes.test.ts`
  - `GameSession`
  - `scripts/agent/escalate.ts`, which arrives with Phase 4/7

### Phase 3: Walking skeleton (test-first)

**Core**

- `math/` (vec2, deterministic trig)
- `rng.ts` (mulberry32)
- `physics/`:
  - fixed `dt = 1/120`
  - circle-vs-segment collisions with **substepping**, so displacement per substep ≤ r/2 and there's no tunnelling
  - per-terrain constant rolling deceleration, which guarantees rest within `v_max / decel` seconds
  - restitution on walls
  - rest detection by speed threshold
  - cup capture when the ball is over the cup _and_ slower than a capture speed
- `course/`: zod schemas, plus `holes/skeleton-01.json`, a par 3 with a dog-leg wall so it needs a bank shot or 2–3 putts
- `game/`: a state machine running aiming → rolling → resting | holed
- `scoring/`: strokes, par, and the score name
- `hash.ts`: FNV-1a over the exact float64 bits of the state

**Shell**

- `input/`: pointer and touch drag-back → `Shot {angle, power 0..1}`, with an aim line and power feedback
- `render/`: canvas, read-only
- `ui/`: stroke HUD, the "Hole complete — N strokes (Par)" screen, restart
- `testing/`: `window.__MM__`, dev/test builds only, guarded by `import.meta.env` so it's tree-shaken from prod. A test asserts that `dist/` doesn't contain it.
- `main.ts`: accumulator loop and nothing else

**Tests**

- unit tests
- invariant tests:
  - the ball stays in bounds
  - no speed gain without a force
  - rest within N seconds, using property-style sweeps over seeded random shots
  - determinism
- golden replays: hole-in-one, par, wall-bank
- e2e on desktop and mobile: play via `__MM__`, assert the completion screen, the stroke count, zero console errors, and **the same final state hash as the Node replay**; take screenshots

**Exit:** you can play it with `npm run dev`; check green.

- **As built:**
  - **Hole.** `skeleton-01` "The Dog-Leg" (par 3). An interior wall blocks the direct line, so you lay up through the left gap, or bank a hole in one off the left wall.
  - **Physics.** Max shot speed 800 u/s, fairway deceleration 360 u/s², cup capture ≤ 280 u/s, wall restitution 0.8.
  - **Golden replays (3).** A hole in one (bank shot), a par, and a wall-bank bogey whose first shot rebounds off the interior wall. Shots were found by a solver that runs the real core.
  - **Invariants.**
    - 600 random shots across two holes, including a concave "pinball" fixture, plus 80 multi-shot games.
    - Measured: 581 wall bounces.
    - Worst penetration 1e-14 (gate: 1e-9).
    - Slowest roll 223 steps (bound: 268).
    - Speed never increased.
  - **E2E (19).**
    - par and hole-in-one replays in Chromium produce **the same hash as Node**
    - completion screen
    - Play again
    - a real mouse drag shoots the opposite way
    - a release on the ball cancels
    - the real-time rAF loop plays a shot out
    - the course fits the viewport
    - prod has no test API
  - **Coverage.** 193 unit tests; core 100% lines / 96.9% branches.
  - **Bug found and fixed:** the canvas measured itself before the HUD was inserted, so the course overflowed the viewport. Fixed with a `minmax(0, 1fr)` grid row and a `ResizeObserver`; an e2e test now guards it.
  - **Extras beyond the brief:**
    - `__MM__.getBallClientPosition()`, for real-input tests
    - `npm run replay:record`, which refuses to overwrite without `--update`
    - a test that every registered hole has a replay proving it solvable within par + 3
    - `.claude/launch.json` for a one-click dev preview
  - **Note:** the desktop app's browser pane throttles rAF to 1 fps when it isn't on screen, and the per-frame clamp then makes the game run at ¼ speed there. Real devices run rAF at 60–120 Hz.

### Phase 4: Guardrails

- `.claude/settings.json`: allow/deny lists plus hooks. The hooks only enforce when `AGENT_MODE ∈ {worker, reviewer, refiner, digest}`.
- `.claude/hooks/*.sh` (jq-based):
  - **PreToolUse `Edit|Write|MultiEdit|NotebookEdit`:** protected paths, with the `AGENT_ALLOW_GOLDEN` exception for replays
  - **PreToolUse `Bash`:** force-push, any push to main, `gh pr merge`, `rm -rf` outside build dirs, `npm publish`, `git config`, `curl`/`wget`, plus best-effort detection of shell writes into protected paths (`>`, `tee`, `sed -i`, `mv`, `cp`)
  - **PostToolUse:** the edit stamp
  - **Stop (worker only):** the check-passed rule
  - **SessionStart:** the canary
- Hook tests: Vitest spawns each hook with sample JSON and asserts allow/block (exit 2 + stderr reason). They count toward the test total.
- `scripts/check-test-integrity.ts` (incl. config sync), `CODEOWNERS` (`@hezrie` on every protected path), and the PR template (criterion → test table, `Closes #N`, screenshots, follow-ups).
- **Exit:** the hook test matrix is green; check green.

- **As built:**
  - `agent.config.json` was created now rather than in Phase 7, because the hooks need `protectedPaths`. A zod loader lives in `scripts/agent/config.ts`.
  - **Hooks** (`.claude/hooks/*.sh`, `jq`, bash 3.2 compatible):
    - `protect-paths`: resolves `..` and symlinks, blocks writes outside the project (temp dirs are allowed), and enforces the golden-replay rule that new files are OK but edits aren't
    - `guard-bash`: works per simple command, so it splits on `; && || | $( )` and backticks
    - `session-start`: the canary, which also records the starting fingerprint
    - `require-check`: the Stop hook
    - `stamp-check`: called by `npm run check`
  - **Fail-closed by construction.** Every hook runs inside `run_guarded`, which maps _any_ non-zero exit to 2, with `set -E` and an ERR trap. The test matrix proved why this matters: a bash-3.2 parser bug made a hook exit 1, which Claude Code treats as _allow_.
  - **Test matrix.** `tests/guardrails/hooks.test.ts` has 77 cases. It includes a check that the bash/jq matcher and the TypeScript matcher used by CI agree on every path. `tests/guardrails/protected-paths.test.ts` keeps CODEOWNERS and CLAUDE.md in sync with the config.
  - `.github/CODEOWNERS` (@hezrie on every protected and golden path), the PR template, and `scripts/agent/escalate.ts`.
- **Deviations (all stricter than the brief):**
  - **All** `git push` is blocked for agents, not just force/main, because pushes are a workflow step.
  - `npm install/add/update` is blocked (package.json is protected), as are `gh api|secret|variable|workflow|auth|repo`, writes outside the project, and `.env`/`secrets/` in shell commands.
  - The Stop hook compares a **content fingerprint** of all non-ignored files with the fingerprint `npm run check` passed on, instead of "time since last Edit". That catches edits made through Bash or scripts, and commits don't fool it.
  - A command that is exactly `npx tsx scripts/agent/escalate.ts "<plain text>"` is always allowed, so escalating can never be blocked by a reason that mentions "cp" or ">".

### Phase 5: CI/CD

- `ci.yml` (PRs + `main`): the steps of `npm run check` in order, plus `agent-guard`, an npm + Playwright browser cache, and Playwright screenshots/report as artifacts.
- `deploy.yml`: Pages via `actions/deploy-pages` on push to `main`.
- **Repo setup (with your OK, given by approving this plan):**
  - create **public** `hezrie/mulligan-mayhem` and push
  - merge settings: squash only, delete branches on merge
  - branch protection on `main`:
    - PR required
    - required checks `check` and `agent-guard`
    - code-owner review on protected paths
    - linear history, no force pushes, no deletions
    - `enforce_admins: false`, so you can merge your own protected-path PRs. GitHub won't let you approve your own PR.
  - Pages source: Actions
  - Actions setting: allow Actions to approve PRs
  - variable `AGENT_PAUSED=true` (paused until Phase 8)
- **Exit:** a green CI run on GitHub, a successful deploy, and the URL loads and plays.

- **As built:**
  - The repo was created and **configured before the first push**: squash-only merges with PR title/body, branches deleted on merge, Actions tokens read-only by default but allowed to approve PRs, Pages from Actions, `AGENT_PAUSED=true`.
  - **First CI run on GitHub was green** (`check` + `actionlint`). The deploy fired from CI completion, and the live URL loads with no console errors and no `__MM__`. A real drag on the live build registers a stroke.
  - **Branch protection on `main`:**
    - required checks `check` + `agent-guard`
    - PR required, with code-owner review and stale reviews dismissed
    - linear history, no force pushes, no deletions
    - `strict: false`, because WIP=1 makes "branch must be up to date" unnecessary friction
    - `enforce_admins: false`, so you can merge your own protected-path PRs
  - git pushes use a **repo-local** credential helper (`gh auth git-credential`), which bypasses the macOS keychain's NextLED credentials. Your global config is untouched. `gh` is now active as `hezrie`; `gh auth switch --user NextLED` switches back.
- **Deviations:**
  - **Deploy runs after CI succeeds on main** (`workflow_run`) rather than on every push, so a red main never ships.
  - **`agent-guard` runs from a trusted base checkout** with plain `node` and no PR dependencies.
  - **`actionlint` runs as an extra CI job.** It isn't required yet.
  - **The config-sync check** keeps `ci.yml` in step with `npm run check`, and covers the worker cron from Phase 7.

### Phase 6: Ticket system

- `scripts/setup/labels.ts`: idempotent; creates or updates names, colours and descriptions.
- `.github/ISSUE_TEMPLATE/ticket.yml` (the full DoR form), `idea.yml` (freeform, auto-labelled `status:needs-refinement`), and `config.yml`.
- `scripts/agent/tracker/`: a `Tracker` interface plus a `github` adapter built on an injectable `gh api` client, so a Jira adapter can be added later as a ticket.
- `scripts/agent/pick-next.ts`: a pure function over a snapshot, plus a thin CLI. Unit tests cover:
  - finish-before-start
  - approved M plans next
  - priority, then age
  - blocked-by
  - the WIP limit
  - the daily cap
  - empty output
- Create and pin the "🤖 Agent Run Log" issue.
- **Exit:** labels exist on GitHub; picker tests green; check green.

- **As built:**
  - **Labels.** `scripts/agent/labels.ts` holds every label as a constant. `npm run setup:labels` created all 26 on GitHub, and a second run changed nothing.
  - **Issue forms.**
    - `ticket.yml`: the full DoR form. Its field labels _are_ the canonical ticket sections, and the size dropdown has no L.
    - `idea.yml`: one required field.
    - Both apply `status:needs-refinement`, and blank issues are disabled.
    - A test parses the forms and checks them against the ticket format and the label set.
  - **Ticket format.** `scripts/agent/ticket-format.ts` renders and parses the canonical body, and runs a deterministic **structural DoR check**: sections present, size S/M, P0–P3, deps "None" or "Blocked by #N". Whether criteria are testable is still the LLM's call.
  - **Tracker.** `Tracker` interface plus a `GitHubTracker` adapter built on an injectable `GhClient` that wraps `gh api` (REST + GraphQL, for review decisions and "Closes #N" links). `TRACKER=jira` has an obvious plug-in point.
  - **Picker.** `pickNext` is a pure function over a snapshot (20 tests), with a CLI that was smoke-tested live.
  - **Run log.** `scripts/agent/run-log.ts` defines a zod-validated JSON-per-comment format. **Run log issue #2** is pinned.
- **Findings, both fixed:**
  1. **Branch protection didn't actually require reviews.** PR #1 merged without one, because a required-approval count of 0 doesn't enforce code-owner review. It's now **1 required approval**: the reviewer agent's approval satisfies it for agent PRs, protected paths additionally need @hezrie, and your own foundation PRs merge via an explicit `--admin` bypass.
  2. **The run-log setup created a duplicate (#3).** GitHub's label search lags issue creation. The script now checks pinned issues first, and all consumers pick the _lowest-numbered_ log. #3 is closed and unpinned.
- **Deviations:**
  - The picker outputs JSON (`{issue, mode, pr, reason}`) rather than a bare number, so the worker knows plan/implement/fix and why.
  - Extra `meta:run-log` / `meta:digest` labels.

### Phase 7: Agent workflows

- `agent-refine.yml`, `agent-worker.yml`, `agent-review.yml`, `agent-merge.yml`, `agent-close.yml`, `agent-digest.yml`, plus `.agent/prompts/{refiner,worker,worker-fix,planner,reviewer-pr,reviewer-plan,digest}.md` and `agent.config.json`.
- Each workflow: kill-switch check → App token → deterministic pre-steps → Claude (`AGENT_MODE`, `--max-turns` and `--model` from config, narrow `--allowedTools`) → canary check → deterministic post-steps → run-log append.
- Action pinned to `anthropics/claude-code-action@v1`, `allowed_bots` set to the App's bot login.
- **I'll stop here and ask you for the secrets** (checklist below), then run `actionlint` on all workflows.
- **Exit:** workflows lint-clean; check green; secrets confirmed present (names only).

- **As built:**
  - **Workflows.** `agent-refine`, `agent-worker`, `agent-review` (PR review + plan review), `agent-merge` (reusable, plus a manual run and an hourly sweep), `agent-close`, `agent-digest`, and `preflight.yml`. Preflight is a by-hand check that the App key, the App's permissions, the run log, the Claude token and the hook canary all work, and it changes nothing.
  - **Scripts.** All side effects go through `scripts/agent/cli.ts`, one subcommand per workflow step (`pick`, `worker-start`, `work-result`, `worker-finish`, `review-context`, `review-finish`, `merge`, `merge-sweep`, `refine-gate`, `refine-finish`, `digest-report`, `digest-pr`, …). The logic sits behind a `Ctx` with fake trackers in `tests/agent/cli.test.ts`.
  - **Prompts.** `.agent/prompts/*.md` for every role. A test checks that each one names `CLAUDE.md` and `.agent/LESSONS.md`.
  - **Workflow invariants are tests** (`tests/guardrails/workflows.test.ts`):
    - no LLM job holds the App token or any write permission
    - Claude authenticates with the subscription token only
    - every job honours the kill switch
    - checkouts never persist credentials
    - every Claude step runs under `AGENT_MODE` and is followed by a canary check for that mode
    - turns and model come from config, and `gh`, network and web tools are denied
    - only allow-listed actions are used
    - only the review submit job (no LLM) may write PRs
- **Security review.** Before merging, an adversarial multi-agent review of the first version found **35 issues**. All are fixed or documented:
  - **Critical: the job split.** In v1, Claude and the App-token steps shared a job, and any step can read a job's secrets. Now each workflow is _trusted job → LLM job → trusted job_:
    - The worker's commits travel as a `git bundle` artifact. The finish job fetches it into `refs/agent/work` as objects only and never checks it out or runs it.
    - Every git call there runs with hooks and global/system config disabled.
    - `agent-guard` re-checks the diff before the push. The token is passed as an `http.extraheader`.
    - The digest job copies back only `CLAUDE.md` and `.agent/LESSONS.md`.
  - **Integrity of inputs:**
    - Plans and review feedback count only when the bot wrote them (an `mm:approved-plan:<id>` binding).
    - The run log trusts only bot-authored comments.
    - Review runs only for same-repo PRs authored by the bot, and its verdict is pinned to the reviewed SHA (`--sha`). Superseded and duplicate reviews are skipped.
  - **Robustness:**
    - orphaned `in-progress` tickets are recovered
    - `worker-finish` is wrapped so any crash ends in `status:needs-human`
    - retries use unique branches (`-r<run id>`)
    - fix passes merge `main` first
    - resumable refiner splits
    - concurrency groups on every workflow
    - `waitForChecks` before review and merge
    - labels are applied before the approval
    - "Ready for human merge" is commented once per SHA
    - an hourly merge sweep
  - **Failure accounting:** a new `infra-failure` outcome, a circuit breaker after 3 in a row, turn-limit runs classified as `failed`, the picker failing closed when the run log is missing, and a stricter first-pass window for the autonomy metrics.
  - **Guardrails:**
    - `find -exec/-delete` is blocked
    - `.git/**`, `node_modules/**` and `.agent/.state/**` are protected for agents
    - `node_modules` is out of the `rm -rf` allowance
    - writes through `$PWD`/`~` paths are resolved
    - any golden-replay change, even a new file, needs you, because CODEOWNERS covers `tests/replays/`
  - **Owner safety:** every hook command in `.claude/settings.json` is gated on `AGENT_MODE`, so a broken hook can never block your own sessions. This happened once during this phase: a syntax error locked out my local Bash until it was fixed. A test now pins the gating.
- **Second review.** A second adversarial pass over the fixed version confirmed **40 more issues** (3 high, 10 medium, 27 low; 6 other reports were refuted). All are fixed, each with a test:
  - **High:**
    - `checkPassed` was always false once the agent had commits: the result was written into the checkout before it was fingerprinted. That would have broken the very first dry run.
    - Package-manager config (`.npmrc`) and nested `node_modules/` were not protected, yet every trusted job runs `npx`. Both are protected now, and so are nested `CLAUDE.md` and `.claude/` folders.
    - The PR reviewer ran repo tooling from the PR's own tree. Its workspace is now `main`, and the PR is unpacked under `pr/` as plain files.
  - **Credentials:** a failed push could have posted the App token, base64-encoded in git's command line, in a public comment. Git config now travels in the environment, and every error bound for a comment or the run log is redacted.
  - **Hooks:**
    - a missing hook script now blocks (`|| exit 2`)
    - the ERR trap really fires inside hooks
    - a broken config list blocks
    - an escalate line can't smuggle a second line past the guard
    - switching or checking out other commits is blocked
    - the Stop hook requires everything to be committed
  - **The loop never wedges:**
    - in-review tickets whose PR was closed go to you
    - a ready ticket with an open PR goes to review
    - an hourly review sweep catches dropped review events
    - one bad `Blocked by #N` no longer stops the picker
    - open PRs are paginated
  - **Trust:**
    - agent PRs are only the bot's own PRs from this repo
    - the ticket comes from the branch name, never the LLM-written PR body
    - other closing keywords in the PR body are neutralized, so merging can't close the run log
    - the "Ready for human merge" dedupe only counts the bot's comments
  - **Your reviews count:** "Request changes" from you (or the reviewer agent) starts a fix pass that works from your review and its line comments.
  - **Accounting:**
    - CI-red notices don't block a real review after a green re-run, and the attempt isn't charged twice
    - attempt bumps survive a crash
    - finish-step crashes count toward the daily cap
    - the fix-mode merge commit isn't counted as agent work
    - reverts are detected in any style
    - re-closed tickets count once
    - autonomy metrics only trust PRs whose authors were checked
  - **Runtime:**
    - fix passes skip merging `main` when main changed workflow files, which the App couldn't push
    - check runs are judged by their newest run
    - LLM jobs re-check the kill switch, and a paused run re-queues without counting anything
- **Third pass.** A final check of those fixes confirmed **22 more** (1 high, 4 medium, 17 low). Several were problems the second round itself introduced. All are fixed, each with a test:
  - **High:** a nested `package.json` (Node's package self-reference) or a symlinked `scripts/node_modules` could still swap the code trusted jobs run. Now `**/package.json`, the bare names `**/node_modules`, `**/.claude` and `.gitattributes` are protected, and agent PRs may not contain symlinks or submodules: `agent-guard` and the finish job read file modes.
  - **The review sweep is now a trusted job with a bound.** It records each retry. After 2 retries for a commit or plan, the ticket goes to you. It skips heads whose CI is still red, and keeps scanning past stuck PRs.
  - **Simpler attempt accounting:** the attempt is counted before a change request is submitted, so a crash can only bring a ticket to you sooner. The marker-based reconciliation, which could undo your "fresh budget" reset, is gone.
  - **Hooks:**
    - routine commands (`2>&1`, `$?`, Claude Code's heredoc commits) are no longer falsely blocked
    - commands over 12 KB are refused (large pipes could make a check read as "no match")
    - unreadable directories no longer trip the error trap
  - **Smaller fixes:**
    - reviews of the PR use its exact commit (its `.gitattributes` can't hide or rewrite files)
    - auto-merges use an explicit squash message, not the agent's commit messages
    - a later plain comment doesn't hide a maintainer's "request changes"
    - a fix pass whose only change is merging main still ships
    - a fix pass whose branch predates a workflow change on main comes to you
    - LLM text can't plant `<!-- mm:… -->` control markers
    - the PR-body regex is linear
- **Deviations:**
  - **Claude auth is the subscription token only** (your choice). Workflows pass `claude_code_oauth_token` and never `anthropic_api_key`. A test enforces this. The `ANTHROPIC_API_KEY` secret is unused and can be deleted.
  - **The App slug is a repo variable**, `AGENT_APP_SLUG`. It feeds `allowed_bots` and the trusted-author checks.
  - **Residual risk, accepted and documented in `docs/WORKFLOW.md`:** the Claude OAuth token is present in the LLM job, because Claude needs it. A malicious ticket could at worst spend your subscription quota until the run's turn and time limits hit. It can't push, merge or label.

### Phase 8: Seed backlog & dry run

- Create 10–12 DoR-compliant tickets with dependencies, splitting the Daily Course generator into "seeded generator + schema" and "solvability bot + par+3 gate". Tickets 1–3 get `status:ready`; the rest get `status:proposed`.
- Set `AGENT_PAUSED=false`, `workflow_dispatch` the worker on ticket 1 at level 1, and watch: pickup → PR → CI → review → "Ready for human merge". Fix plumbing as needed.
- Final report (URLs, what's built, how to run, pause and raise autonomy, remaining to-dos, risks, Level 1→2→3 criteria).

## Things only you can do

**Now**

- [x] Review and approve this plan. Approving also OKs:
  - the Phase 1 downloads
  - creating the public repo
  - `gh auth switch --user hezrie`
  - the API-applied repo settings
  - creating labels and issues

**Before Phase 7 (I'll stop and walk you through it)**

- [x] **Create the GitHub App** (Settings → Developer settings → GitHub Apps → New):
  - Name: `mulligan-mayhem-agent`
  - Homepage: the repo URL
  - Webhook: off
  - Repository permissions: **Contents RW, Issues RW, Pull requests RW, Metadata R, Actions R**, and **Workflows: none**
  - Install it on `hezrie/mulligan-mayhem` only
- [x] Add the secrets yourself. I won't handle secret values.
  - `gh secret set AGENT_APP_ID` and `gh secret set AGENT_APP_PRIVATE_KEY < key.pem`
- [x] **Claude auth**, pick one. Chosen: the subscription token.
  - install the Claude CLI, run `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. This uses your subscription's limits.
  - or `gh secret set ANTHROPIC_API_KEY`. This is pay-per-token, with exact cost in the digest.
- [ ] **Rotate the App private key.** Its contents were shared in chat. Generate a new key on the App page and `gh secret set AGENT_APP_PRIVATE_KEY` from it. Then delete the old keys there, delete the `.pem` files in `~/Downloads`, and optionally run `gh secret delete ANTHROPIC_API_KEY`.
- [ ] _(Optional)_ Install the Claude GitHub App (https://github.com/apps/claude). It's only needed for `@claude` mentions; the loop doesn't use it.

**Ongoing**

- Merge PRs at Level 1, promote tickets to `status:ready`, answer `status:needs-human` questions, and merge digest PRs.
- Family members need a GitHub account to submit ideas. Send me their handles for `trustedSubmitters`.

## Product questions that will come up later (not blocking)

- Daily Course "day": UTC midnight or each player's local midnight? This matters if family spans timezones.
- What a Mulligan does exactly: redo the last stroke, or subtract one stroke?
- Chaos Card when the lead is tied: who gets hit?

## Known risks (tracked; mitigations in place or planned)

- **Prompt injection via public issues.** Mitigated by the trust gate, read-only LLM credentials, narrow tools, and treating issue text as untrusted data.
- **The Claude OAuth token sits in the LLM job.** It's unavoidable, because Claude needs it. The worst case is spent subscription quota, bounded by turns, timeouts, the daily cap and the kill switch. The App token is never there.
- **Hook regexes are best-effort.** The real walls are `agent-guard`, CODEOWNERS and the App's missing Workflows permission.
- **Hooks silently not loading in CI.** Mitigated by the canary, which fails the run.
- **Runaway cost.** Capped by `--max-turns`, job timeouts, concurrency 1, the daily cap and the kill switch.
- **GitHub cron fires late** under load (often 5–30 min), and public-repo schedules are disabled after 60 days of no activity.
- **Node 26 becomes LTS later this month.** It goes into the backlog as a chore.

## Changelog

- 2026-10-08: Phase 0 complete. Plan written, awaiting approval.
- 2026-10-17: Plan approved. Phase 1 complete: tooling wired, `npm run check` green (24 unit + 5 e2e tests).
- 2026-10-17: Phase 2 complete: rulebook + 6 docs + ADR 0001 + lessons file; doc tests added.
- 2026-10-17: Phase 3 complete: playable par-3 walking skeleton, 193 unit/invariant/replay tests, 19 e2e tests; Node and Chromium hashes match.
- 2026-10-17: Phase 4 complete: hooks + settings + config + CODEOWNERS + PR template; 320 unit tests (77 hook cases).
- 2026-10-17: Phase 5 complete: repo live and public, CI green on GitHub, Pages deployed, branch protection applied.
- 2026-10-17: Phase 6 complete: labels live, issue forms, Tracker + GitHub adapter, picker, run log #2; protection tightened to 1 approval.
- 2026-10-17: Phase 7 complete: six agent workflows + preflight; three adversarial passes (35 + 40 + 22 findings) led to the trusted/LLM job split, the main-only reviewer workspace and a bounded review sweep; subscription-only Claude auth; 659 unit tests.
