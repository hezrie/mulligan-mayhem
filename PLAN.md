# Mulligan Mayhem — Foundation Plan

> Living document. Updated and committed at the end of every phase so it always reflects reality.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Recon & plan | ✅ Done, awaiting approval |
| 1 | Scaffold & tooling | ⏳ |
| 2 | Rulebook | ⏳ |
| 3 | Walking skeleton | ⏳ |
| 4 | Guardrails | ⏳ |
| 5 | CI/CD + repo + Pages | ⏳ |
| 6 | Ticket system | ⏳ |
| 7 | Agent workflows | ⏳ (needs secrets from you first) |
| 8 | Seed backlog & dry run | ⏳ |

## Decisions (Phase 0)

| Question | Answer |
| --- | --- |
| Repo owner and CODEOWNER | `@hezrie` → `hezrie/mulligan-mayhem` |
| Visibility | **Public**: free Pages, branch protection, CODEOWNERS enforcement, unlimited Actions minutes |
| Bot identity | **GitHub App** that you create (no admin bypass, no Workflows permission) |
| Commit author | `hezrie <328370658+hezrie@users.noreply.github.com>`, set **repo-locally** only |
| Deploy URL (expected) | `https://hezrie.github.io/mulligan-mayhem/` |

## Environment recon

| Tool | Found | Notes |
| --- | --- | --- |
| node | v24.15.0 | Node 24 is Active LTS today. Pin `24` in `.nvmrc` and `engines: ">=24 <25"`. |
| npm | 11.12.1 | ✓ |
| git | 2.50.1 | No global identity configured. I'll set it repo-locally. |
| gh | 2.98.0 | Two logins: `NextLED` (active) and `hezrie`, both with `repo` + `workflow` scopes. |
| jq | 1.7.1 | ✓ (also preinstalled on GitHub runners) |
| claude CLI | not on PATH | Only needed for **you** to run `claude setup-token` (Phase 7). |

Latest relevant packages: vite 8.3, vitest 5.0 (+ coverage-v8), eslint 10.12, typescript-eslint 8.71, @playwright/test 1.64, prettier 3.9, dependency-cruiser 18.5, tsx 4.23, zod 4.6.

## Deviations from the brief, and why

1. **TypeScript is pinned to 6.0.x, not `latest` (7.0).** TS 7 is the native Go port. typescript-eslint's peer range is `>=4.8.4 <6.1.0`, so type-aware linting breaks on 7. A follow-up ticket will upgrade once typescript-eslint supports it.
2. **The LLM never holds write credentials.** Every Claude step runs with a read-only, job-scoped `GITHUB_TOKEN` and a narrow `--allowedTools`. All side effects (push, PR create, labels, comments, reviews, merges) happen in **deterministic workflow steps** backed by unit-tested scripts in `scripts/agent/`. Claude hands its results over through files (`.agent/out/pr-body.md`, `plan.md`, `escalation.md`) or a `--json-schema` structured output (the reviewer's verdict).
   - Why: "permissions over instructions". The agent can't push to `main` or merge because it has no credential that can do so, whatever the prompt says.
   - The brief's `permissions.allow` list (`gh pr create` and the rest) stays in `.claude/settings.json` for local and interactive use. CI narrows it further.
   - Side effect: the **Claude GitHub App is optional**. It's only needed if you also want `@claude` mentions.
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
11. **Cross-engine determinism.** ESLint bans `Math.sin/cos/tan/atan2/asin/acos/exp/log/pow/hypot/cbrt` in `src/core/**`, and `src/core/math/` provides its own implementations built only from IEEE-exact operations (`+ − × ÷ sqrt`).
    - Why: those built-ins legitimately differ between JS engines (Safari vs Chrome). The Daily Course must be identical on every family phone.
    - Bonus: the Chromium e2e test can assert the **same state hash** as the Node golden replay.
12. **Layers are enforced by two tools.** ESLint handles banned globals and properties (`Date`, `Math.random`, `window`, `document`, `performance`, …). dependency-cruiser handles the import graph. Neither tool can do both jobs.
13. **Core's only allowed third-party dependency is `zod`**, used for the hole/course schemas validated at load. dependency-cruiser enforces this allowlist.
14. **The integrity check catches more than the brief lists.** It also flags `.skipIf(`, `.runIf(`, `.fails(`, Playwright `.fixme(`, and `describe.skip`. To compare test counts, it runs `vitest list` + `playwright test --list` against `origin/main` in a temporary git worktree. It skips that comparison, with a notice, when no `main` exists yet.
15. **`rm -rf` is also allowed in other build-output dirs** (`coverage/`, `test-results/`, `playwright-report/`), not just `dist/` and `node_modules/`.
16. **Extra label `physics-change`.** The hooks rule references it, but the label list doesn't include it.
17. **`agent.config.json` gets three extra keys:**
    - `models`: aliases like `opus`/`sonnet`, so you can tune cost per role
    - `trustedSubmitters`: family GitHub handles whose ideas the refiner processes automatically
    - `workflowTimeoutMinutes`
18. **`.agent/LESSONS.md` is protected too.** Only `AGENT_MODE=digest` may edit `CLAUDE.md` and `LESSONS.md`, and it does so only on a PR that you merge.
19. **Refiner trust gate (this is a public repo).** A deterministic first step checks whether the issue author is OWNER/COLLABORATOR or listed in `trustedSubmitters`. If not, it comments "thanks, waiting for maintainer triage" and stops. It runs once you re-apply `status:needs-refinement`. The issue text always goes into the prompt as untrusted data.
20. **Daily cap and attempt counting** use the run-log issue (JSON comments) as the source of truth, so the picker stays deterministic and testable from a snapshot.
21. **gh account.** In Phase 5 I'll run `gh auth switch --user hezrie`. Afterwards you can switch back with `gh auth switch --user NextLED`.

## How the loop is wired (who holds which credential)

```
                      read-only GITHUB_TOKEN            App token (AGENT_BOT_TOKEN)
                      ─────────────────────            ───────────────────────────
refiner  (issues)     Claude reads issue, writes   →   step edits issue/labels/creates split issues
worker   (cron/manual)Claude edits code, runs check→   step pushes agent/<n>-<slug>, opens PR, labels
reviewer (CI done /   Claude returns JSON verdict  →   step: GITHUB_TOKEN submits review (github-actions[bot]);
         plan label)                                    App token adds agent-approved / plan:approved
merger   (called)     no LLM                       →   squash-merge iff CI green ∧ approved ∧ size allowed
                                                        at autonomyLevel ∧ no protected paths; else comment
closer   (issue closed) no LLM                     →   summary comment, strip status labels, arch-review counter
digest   (weekly)     Claude (digest mode)         →   step opens digest issue + rules PR (for you to merge)
```

Every agent workflow starts by exiting early if `vars.AGENT_PAUSED == 'true'`, and every run appends one JSON line to the pinned "🤖 Agent Run Log" issue (role, issue, outcome, attempts, turns, duration, cost, taken from the action's `execution_file`).

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

### Phase 2: Rulebook
- `CLAUDE.md` (≤150 lines). Covers the purpose, layer map, exact commands, conventions, DoR/DoD links, protected paths, escalation rules, and "how to add a hole / a terrain / a test".
- Supporting docs:
  - `docs/GAME_DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/DEFINITION_OF_READY.md`, `docs/DEFINITION_OF_DONE.md`
  - `docs/WORKFLOW.md`, written for you: the loop, labels, autonomy levels, the kill switch, and what to do when something is `needs-human`
  - `docs/decisions/0001-custom-deterministic-physics.md`, covering fixed timestep, swept collisions, IEEE-exact math, and state hashing
  - `.agent/LESSONS.md`: a format header and nothing else yet
- **Exit:** docs cross-link correctly; check green.

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
  - cup capture when the ball is over the cup *and* slower than a capture speed
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

### Phase 7: Agent workflows
- `agent-refine.yml`, `agent-worker.yml`, `agent-review.yml`, `agent-merge.yml`, `agent-close.yml`, `agent-digest.yml`, plus `.agent/prompts/{refiner,worker,worker-fix,planner,reviewer-pr,reviewer-plan,digest}.md` and `agent.config.json`.
- Each workflow: kill-switch check → App token → deterministic pre-steps → Claude (`AGENT_MODE`, `--max-turns` and `--model` from config, narrow `--allowedTools`) → canary check → deterministic post-steps → run-log append.
- Action pinned to `anthropics/claude-code-action@v1`, `allowed_bots` set to the App's bot login.
- **I'll stop here and ask you for the secrets** (checklist below), then run `actionlint` on all workflows.
- **Exit:** workflows lint-clean; check green; secrets confirmed present (names only).

### Phase 8: Seed backlog & dry run
- Create 10–12 DoR-compliant tickets with dependencies, splitting the Daily Course generator into "seeded generator + schema" and "solvability bot + par+3 gate". Tickets 1–3 get `status:ready`; the rest get `status:proposed`.
- Set `AGENT_PAUSED=false`, `workflow_dispatch` the worker on ticket 1 at level 1, and watch: pickup → PR → CI → review → "Ready for human merge". Fix plumbing as needed.
- Final report (URLs, what's built, how to run, pause and raise autonomy, remaining to-dos, risks, Level 1→2→3 criteria).

## Things only you can do

**Now**
- [ ] Review and approve this plan. Approving also OKs:
  - the Phase 1 downloads
  - creating the public repo
  - `gh auth switch --user hezrie`
  - the API-applied repo settings
  - creating labels and issues

**Before Phase 7 (I'll stop and walk you through it)**
- [ ] **Create the GitHub App** (Settings → Developer settings → GitHub Apps → New):
  - Name: `mulligan-mayhem-agent`
  - Homepage: the repo URL
  - Webhook: off
  - Repository permissions: **Contents RW, Issues RW, Pull requests RW, Metadata R, Actions R**, and **Workflows: none**
  - Install it on `hezrie/mulligan-mayhem` only
- [ ] Add the secrets yourself. I won't handle secret values.
  - `gh secret set AGENT_APP_ID` and `gh secret set AGENT_APP_PRIVATE_KEY < key.pem`
- [ ] **Claude auth**, pick one:
  - install the Claude CLI, run `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. This uses your subscription's limits.
  - or `gh secret set ANTHROPIC_API_KEY`. This is pay-per-token, with exact cost in the digest.
- [ ] *(Optional)* Install the Claude GitHub App (https://github.com/apps/claude). It's only needed for `@claude` mentions; the loop doesn't use it.

**Ongoing**
- Merge PRs at Level 1, promote tickets to `status:ready`, answer `status:needs-human` questions, and merge digest PRs.
- Family members need a GitHub account to submit ideas. Send me their handles for `trustedSubmitters`.

## Product questions that will come up later (not blocking)
- Daily Course "day": UTC midnight or each player's local midnight? This matters if family spans timezones.
- What a Mulligan does exactly: redo the last stroke, or subtract one stroke?
- Chaos Card when the lead is tied: who gets hit?

## Known risks (tracked; mitigations in place or planned)
- **Prompt injection via public issues.** Mitigated by the trust gate, read-only LLM credentials, narrow tools, and treating issue text as untrusted data.
- **Hook regexes are best-effort.** The real walls are `agent-guard`, CODEOWNERS and the App's missing Workflows permission.
- **Hooks silently not loading in CI.** Mitigated by the canary, which fails the run.
- **Runaway cost.** Capped by `--max-turns`, job timeouts, concurrency 1, the daily cap and the kill switch.
- **GitHub cron fires late** under load (often 5–30 min), and public-repo schedules are disabled after 60 days of no activity.
- **Node 26 becomes LTS later this month.** It goes into the backlog as a chore.

## Changelog
- 2026-10-08: Phase 0 complete. Plan written, awaiting approval.
