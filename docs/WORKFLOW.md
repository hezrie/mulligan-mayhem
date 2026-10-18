# The Agent Loop: Owner's Guide

This is for **you** (@hezrie). It explains how tickets turn into merged, deployed features, what
you need to do, and how to stop everything from your phone.

## Your job in one minute

1. **Promote** tickets you want built: `status:proposed` → `status:ready`. Ideas from you,
   collaborators and `trustedSubmitters` are refined straight into `status:ready`.
2. **Answer** anything labelled `status:needs-human`, then set it back to `status:ready`
   (or `status:needs-refinement` if it should be rewritten).
3. **Merge** PRs marked "✅ Ready for human merge". At autonomy level 1, that's every PR. To have
   the agent change something first, use **Request changes** with comments: the next worker run
   makes a fix pass from your review. To reject a PR outright, close it; its ticket comes back to
   you as `status:needs-human`.
4. **Read** the weekly digest issue and merge or close its rules PR.
5. **Pause** everything by setting `AGENT_PAUSED` to `true` whenever you like.

## The loop

```
 idea / bug ──▶ refiner ──▶ status:ready ──▶ worker ──▶ PR ──▶ CI ──▶ reviewer ──▶ merge gate
 (idea form)                                  │ size M                          │
                                              ▼                                 ▼
                                     plan ──▶ plan review ──▶ plan:approved   level 1: "Ready for
                                                                              human merge" → you merge
 closer ◀── issue closed ◀── squash merge ──▶ deploy to Pages
```

| Step      | Workflow           | Trigger                                                                                          | LLM? |
| --------- | ------------------ | ------------------------------------------------------------------------------------------------ | ---- |
| Refine    | `agent-refine.yml` | issue labelled `status:needs-refinement`                                                         | yes  |
| Work      | `agent-worker.yml` | cron (hourly) or **Run workflow** (optional issue number)                                        | yes  |
| Review    | `agent-review.yml` | CI finished on an internal `agent/*` PR, `plan:proposed`, or the hourly sweep for missed reviews | yes  |
| Merge     | `agent-merge.yml`  | called after an approval; hourly sweep; or by hand                                               | no   |
| Close     | `agent-close.yml`  | issue closed                                                                                     | no   |
| Digest    | `agent-digest.yml` | Mondays 07:00 UTC, or by hand                                                                    | yes  |
| Preflight | `preflight.yml`    | by hand: checks credentials and guardrails, touches nothing                                      | yes  |

### How a workflow keeps the AI away from the keys

On GitHub's runners, any code running in a job can read every secret of that job. So each agent
workflow is split into separate jobs, each on a fresh machine:

- **Trusted job** (bot App token): reads the ticket, labels and comments.
- **LLM job** (no App token, read-only GitHub token): Claude works under the guardrail hooks. Its
  output, a `git bundle` of its commits plus a few text files, is handed on as **data**.
- **Trusted job**: on a clean checkout, it fetches the bundle as git objects only, never checking
  it out or running it. It re-checks the protected-path rules, then pushes, opens the PR and
  labels.

This means the AI never holds a credential that can push, merge or label, whatever a ticket says.
Only committed work is shipped (the bundle), so the worker must commit everything before it stops.

The PR reviewer works the same way, but its workspace is `main` itself: the PR's files are unpacked
under `pr/` as plain data. No code from the PR runs in the review job, and only main's rules
(`CLAUDE.md`, hooks, prompts) apply.

### Picker order

The picker (`scripts/agent/pick-next.ts`) is deterministic, with no LLM.

0. **Repair stuck states.**
   - A ticket still `status:in-progress` was left behind by a run that died. It is re-queued once
     without counting an attempt. The second time it goes to `status:needs-human`.
   - A `status:ready` ticket that already has an open agent PR goes to `status:in-review`, so that
     PR gets reviewed instead of a duplicate being opened.
   - A `status:in-review` ticket with no open agent PR (it was closed without merging) goes to
     `status:needs-human`, so it doesn't hold the WIP slot.
1. **Finish before starting.** An agent PR with "changes requested" from the reviewer agent or a
   maintainer gets a fix pass, working from that review and its line comments. This happens even at
   the WIP limit, but only once per review: fixes that are already pushed wait for re-review.
   Agent PRs are those the bot opened from this repository; a branch name alone means nothing.
2. **Order of work:**
   - M tickets with `plan:approved` first
   - then `status:ready` by priority (P0 first)
   - then oldest first
3. **WIP limit** (`wipLimit`, currently 2). Tickets `in-progress` or `in-review` count toward it;
   `needs-human` tickets don't.
4. **Daily cap** (`maxTicketsStartedPerDay`, currently 12 plan or implement runs per UTC day). It is counted from the run log,
   from entries written by the bot only. Fix passes don't count.
5. **Skips.** The picker skips anything that is:
   - blocked by an open issue
   - missing a size
   - waiting on a plan review
6. **Safety stops.**
   - **Circuit breaker:** after 3 infrastructure failures in a row (credentials, hooks not
     loading, runs dying), it stops picking. Fix the cause, then run the worker by hand **with a
     ticket number** to resume (a run without one is still stopped by the breaker).
   - **Missing run log:** if the run log issue is missing, it picks nothing.

A manual run with an issue number ignores the order, the WIP limit, the cap and the circuit
breaker, but still refuses blocked or not-ready tickets.

## Labels

| Label                             | Meaning                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `status:proposed`                 | Idea exists; agent-created tickets start here. Not in the queue.  |
| `status:needs-refinement`         | Raw idea; the refiner will rewrite it to the Definition of Ready. |
| `status:ready`                    | Meets the DoR; in the worker queue.                               |
| `status:in-progress`              | The worker is on it.                                              |
| `status:in-review`                | PR open: CI, reviewer, then merge.                                |
| `status:needs-human`              | Blocked on you. Read the latest comment.                          |
| _(closed)_                        | Done.                                                             |
| `priority:P0`…`P3`                | P0 = broken/blocking, P3 = nice to have.                          |
| `size:S`, `size:M`                | S ≤ ~150 lines / 1 area; M ≤ ~400 / 2 areas. No L, split instead. |
| `type:*`                          | feature, bug, chore, refactor, test.                              |
| `plan:proposed` / `plan:approved` | M-ticket plan awaiting review / approved to implement.            |
| `agent:attempt-1` / `-2`          | Which attempt the worker is on.                                   |
| `agent-approved`                  | The reviewer approved the PR's current commit.                    |
| `source:agent`                    | An agent proposed this ticket (capped at 3/day).                  |
| `physics-change`                  | Allows changing existing golden replays. **Only you add this.**   |
| `meta:run-log` / `meta:digest`    | The pinned 🤖 Agent Run Log issue (#2) / weekly digest issues.    |

## Attempts

Each ticket gets `maxAttemptsPerTicket` attempts (default 2).

**These use up an attempt:**

- a failed worker run, meaning any of:
  - no commits
  - `npm run check` not passing
  - Claude hitting its turn limit or erroring
  - a change to a protected path
- a "changes requested" review by the reviewer agent, including the automatic one when CI is red
  (counted once per commit: if a re-run turns CI green, that commit still gets a real review, but
  no second attempt is charged)
- a rejected plan

**These don't:**

- infrastructure failures (credentials, hooks not loading, cancelled or timed-out runs)
- escalations, which go straight to `status:needs-human`
- your own "changes requested" reviews (each one gets a fix pass)
- runs stopped by the kill switch before the agent started

**When attempts run out**, the ticket goes to `status:needs-human` with a summary, and a lesson
draft is written to the run log.

**Re-queuing keeps the count.** To give a ticket a fresh budget after clarifying it, remove its
`agent:attempt-*` label before setting it back to `status:ready`.

## Autonomy levels

Set by `autonomyLevel` in `agent.config.json`. It's a protected file, so change it with a PR you
merge. The hourly merge sweep then re-evaluates PRs that are already approved.

| Level | What auto-merges                                  | You do                       |
| ----- | ------------------------------------------------- | ---------------------------- |
| **1** | nothing; the bot comments "Ready for human merge" | merge every PR               |
| **2** | approved, green `size:S` PRs                      | merge M PRs                  |
| **3** | approved, green `size:S` and `size:M` PRs         | spot-check, read the digests |

At every level, auto-merge also requires:

- CI green (the gate waits for pending checks)
- the reviewer's approval **of the current commit**
- no protected paths and no golden replays in the diff

New replays included, since CODEOWNERS makes them yours. Note that at level 2 and above, the
reviewer agent is the only review an auto-merged PR gets. The weekly digest recommends when to
change level, using the rules in `scripts/agent/digest.ts`:

- **Raise 1 → 2:** 8 of the last 10 S tickets first-pass with no human edits, no reverts in 14 days,
  needs-human ≤ 20%.
- **Raise 2 → 3:** additionally 15 clean S tickets, and 5 of the last 6 M tickets first-pass.
- **Lower one level:** any revert in 14 days, or needs-human > 40%.

## Kill switch

Repository variable **`AGENT_PAUSED`**. Every agent workflow checks it first and exits if it's
`true`, and every job that runs Claude checks it again, so pulling it mid-run stops the AI from
starting. A worker run stopped that way re-queues its ticket without counting anything. The one
exception is the closer: it runs no AI and only records tickets you close or merge, so it keeps
working while paused.

- **Phone:** github.com → repo → Settings → Secrets and variables → Actions → **Variables** tab →
  `AGENT_PAUSED` → edit → `true`.
- **Terminal:** `gh variable set AGENT_PAUSED --body true -R hezrie/mulligan-mayhem`.

A Claude job that has already started finishes. To stop one immediately, cancel it in the Actions
tab; the next worker run recovers any ticket the cancellation left `in-progress`. After unpausing,
the hourly review sweep picks up PRs and plans whose review was skipped (at most 2 automatic retries
per commit or plan; after that the ticket comes to you). An idea whose refinement
was skipped needs its `status:needs-refinement` label re-applied.

## Running things by hand

| What                                                  | How                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Check credentials and guardrails (no tickets touched) | Actions → **Preflight** → Run workflow                                                                               |
| Run the worker now                                    | Actions → **Agent Worker** → Run workflow (optional issue number), or `gh workflow run agent-worker.yml -f issue=12` |
| Re-review a PR or a plan                              | Actions → **Agent Review** → Run workflow with the PR or issue number (the hourly sweep also catches missed reviews) |
| Re-evaluate approved PRs for merge                    | Actions → **Agent Merge** → Run workflow (empty PR = all)                                                            |
| Generate the digest now                               | Actions → **Agent Digest** → Run workflow                                                                            |

## One-time setup scripts

Both are idempotent and safe to re-run:

- `GITHUB_REPOSITORY=hezrie/mulligan-mayhem npm run setup:labels` creates or updates every label in
  `scripts/agent/labels.ts`.
- `GITHUB_REPOSITORY=hezrie/mulligan-mayhem npm run setup:run-log` creates and pins the run log
  issue.

## Ideas from family

Family members use **New issue → 💡 Idea or bug**. It's a freeform form, labelled
`status:needs-refinement` automatically.

The repo is public, so the refiner runs automatically only for you, collaborators, and handles
listed in `trustedSubmitters` in `agent.config.json`. Anyone else gets a polite "waiting for
triage" comment. Re-apply the label to let the refiner process their idea. Issue text is always
treated as data, never as instructions.

## Observability

- **🤖 Agent Run Log** (pinned issue #2): every agent run appends one JSON comment with role,
  issue, outcome, attempt, turns, duration and cost. Only entries written by the bot are counted.
- **Weekly digest issue:**
  - tickets done
  - first-pass success rate
  - needs-human rate
  - reverts
  - average turns and cost
  - an autonomy recommendation

  When failures recurred, a PR also follows, proposing `CLAUDE.md` / `.agent/LESSONS.md` updates.
  You decide.

- **Architecture review:** every 10 agent merges (`architectureReviewEveryNMerges`), a
  `type:refactor` "Architecture & drift review" ticket opens for you.

## What stops the agent from doing damage

| Risk                                     | Stopped by                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pushing to `main` / force-pushing        | The AI holds no write credential; branch protection; trusted steps only push `agent/*` branches (and the digest's `digest/*` rules branch)             |
| Merging its own work                     | Reviews come from a separate identity; the merge gate's checks; branch protection (1 approval); you at level 1                                         |
| Editing rules, CI or test config         | Edit hooks; the protected-path guard in the trusted push step **and** in CI (`agent-guard`); CODEOWNERS (you); the App can't push workflow files       |
| Weakening or deleting tests              | Integrity check (markers, per-suite counts); the reviewer; golden replays                                                                              |
| Stealing the bot's token                 | The token is never present in a job that runs AI-written code                                                                                          |
| Runaway cost                             | `--max-turns`, job timeouts, one worker at a time, the daily cap, the circuit breaker, the kill switch                                                 |
| Prompt injection via issues and comments | The trust gate; plans, review feedback and run-log entries are accepted from the bot only; read-only tools for the refiner and reviewer                |
| Hooks silently not loading               | The canary: a run without it pushes nothing and approves nothing. The worker run fails; other runs flag it in the run summary and drop the AI's output |

**Known residual risk.** The Claude subscription token has to be present in the LLM job, so code
the AI writes and tests could in principle read it. Tickets come only from trusted people, and the
token can be revoked at any time with `claude setup-token` (then update the secret).

## Troubleshooting

- **Nothing happens on schedule:**
  - Check `AGENT_PAUSED`.
  - Look at the latest **Agent Worker** summary, which shows the picker's reason, e.g. the WIP
    limit, the daily cap or the circuit breaker.
  - Scheduled workflows only run from `main`.
- **A worker run you started by hand shows as cancelled:** GitHub keeps only one waiting run per
  workflow, so a scheduled run that queued up behind a running worker replaced yours. Run it
  again once the current run has finished.
- **"Circuit breaker" in the picker summary:** three runs in a row failed for infrastructure
  reasons. Run **Preflight**, fix what it reports, then run the worker by hand once **with a ticket
  number**.
- **The worker keeps escalating:** read its comments. The usual causes are unclear criteria (send
  the ticket back to `status:needs-refinement`) or a protected-file change you need to make
  yourself.
- **CI is red on `main`:** pause the loop, fix or revert, then unpause.
