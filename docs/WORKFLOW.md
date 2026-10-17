# The Agent Loop — Owner's Guide

This is for **you** (@hezrie). It explains how tickets turn into merged, deployed features, what
you need to do, and how to stop everything from your phone.

## Your job in one minute

1. **Promote** tickets you want built: `status:proposed` → `status:ready`.
2. **Answer** anything labelled `status:needs-human`, then set it back to `status:ready`
   (or `status:needs-refinement` if it needs rewriting).
3. **Merge** PRs marked "Ready for human merge" (at autonomy level 1, that's every PR).
4. **Read** the weekly digest issue and merge or close its rules PR.
5. **Pause** everything by setting `AGENT_PAUSED` to `true` whenever you like.

## The loop

```
 idea / bug ──▶ refiner ──▶ status:ready ──▶ picker ──▶ worker ──▶ PR ──▶ CI ──▶ reviewer
 (idea form)    (agent)      (you promote)  (script)   (agent)                    (agent)
                  │                                      │ size M without plan         │
                  ▼                                      ▼                             ▼
          status:needs-human                      plan comment ──▶ reviewer ──▶ plan:approved
                                                                                       │
          closer ◀── issue closed ◀── merge ◀── merger (script) ◀── approved ◀─────────┘
          (summary, deploy URL)        │           at level 1: "Ready for human merge" → you merge
                                       ▼
                                 deploy to Pages
```

| Step        | Workflow                     | Trigger                                            | LLM? |
| ----------- | ---------------------------- | -------------------------------------------------- | ---- |
| Refine      | `agent-refine.yml`           | issue labelled `status:needs-refinement`           | yes  |
| Pick        | `scripts/agent/pick-next.ts` | first step of every worker run                     | no   |
| Work / plan | `agent-worker.yml`           | cron (every 2h) or manual "Run workflow"           | yes  |
| Review      | `agent-review.yml`           | CI finished on an `agent/*` PR, or `plan:proposed` | yes  |
| Merge       | `agent-merge.yml`            | called by the reviewer after approval; or manual   | no   |
| Close       | `agent-close.yml`            | issue closed                                       | no   |
| Digest      | `agent-digest.yml`           | weekly (Monday) or manual                          | yes  |

**Picker order.** The picker is deterministic, with no LLM:

1. finish PRs that have "changes requested"
2. M tickets with `plan:approved` that aren't implemented yet
3. `status:ready` by priority (P0 first), then oldest first

It skips anything "Blocked by" an open issue, and respects the WIP limit (1) and the daily cap (6).

## Labels

| Label                             | Meaning                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `status:proposed`                 | Idea exists; agent-created tickets start here. Not in the queue.                        |
| `status:needs-refinement`         | Raw idea; the refiner will rewrite it to the Definition of Ready.                       |
| `status:ready`                    | Meets the DoR; in the worker queue.                                                     |
| `status:in-progress`              | The worker is on it.                                                                    |
| `status:in-review`                | PR open, waiting on CI / reviewer / merge.                                              |
| `status:needs-human`              | Blocked on you. Read the latest comment.                                                |
| _(closed)_                        | Done.                                                                                   |
| `priority:P0`…`P3`                | P0 = broken/blocking, P3 = nice to have.                                                |
| `size:S`, `size:M`                | S ≤ ~150 lines / 1 area; M ≤ ~400 / 2 areas. No L, split instead.                       |
| `type:*`                          | feature, bug, chore, refactor, test.                                                    |
| `plan:proposed` / `plan:approved` | M-ticket plan awaiting review / approved to implement.                                  |
| `agent:attempt-1` / `-2`          | Which attempt the worker is on.                                                         |
| `agent-approved`                  | The reviewer approved the PR.                                                           |
| `source:agent`                    | An agent proposed this ticket (capped at 3/day).                                        |
| `physics-change`                  | Allows changing existing golden replays. Add it only when you intend physics to change. |

**Attempts.**

- The first pickup labels the ticket `agent:attempt-1`.
- A failed run (agent error, no PR, or `npm run check` failing) or a "changes requested" review
  moves it to `agent:attempt-2`.
- A failure on the last attempt (`maxAttemptsPerTicket`, default 2) sets `status:needs-human`,
  posts a failure summary, and drafts a lesson in the run log.

## Autonomy levels

Set by `autonomyLevel` in `agent.config.json`. It's a protected file, so change it with a PR you
merge.

| Level | What auto-merges                                  | You do                   |
| ----- | ------------------------------------------------- | ------------------------ |
| **1** | nothing; the bot comments "Ready for human merge" | merge every PR           |
| **2** | approved, green `size:S` PRs                      | merge M PRs              |
| **3** | approved, green `size:S` and `size:M` PRs         | spot-check, read digests |

At every level, auto-merge also requires:

- CI green
- reviewer approval
- **no protected paths in the diff**

The merger re-checks all of this itself, so a stray label can't cause a merge. The weekly digest
recommends when to change level. Suggested criteria are in the final foundation report and in
`PLAN.md`.

## Kill switch

Repository variable **`AGENT_PAUSED`**. Every agent workflow checks it first and exits immediately
if it's `true`.

- **Phone:** github.com → repo → Settings → Secrets and variables → Actions → **Variables** tab →
  `AGENT_PAUSED` → edit → `true`.
- **Terminal:** `gh variable set AGENT_PAUSED --body true -R hezrie/mulligan-mayhem`.

Runs already in progress finish their current job (with a timeout). To stop one immediately,
cancel it in the Actions tab.

## Running things by hand

- Run the worker now: Actions → **Agent Worker** → Run workflow (optionally enter an issue
  number), or `gh workflow run agent-worker.yml -f issue=12`.
- Re-run the reviewer on a PR: Actions → **Agent Review** → Run workflow with the PR number.
- Generate a digest now: Actions → **Agent Digest** → Run workflow.

## Ideas from family

Family members use **New issue → 💡 Idea or bug**. It's a freeform form that is labelled
`status:needs-refinement` automatically. Because the repo is public, the refiner runs
automatically only for you, collaborators, and handles listed in `trustedSubmitters` in
`agent.config.json`. Anyone else gets a polite "waiting for triage" comment; re-apply the label to
let the refiner process it. Issue text is always treated as untrusted data, never as instructions.

## Observability

- **🤖 Agent Run Log** (a pinned issue): every agent run appends one JSON comment with role, issue,
  outcome, attempt, turns, duration, and cost.
- **Weekly digest issue:**
  - tickets done
  - first-pass success rate
  - needs-human rate
  - reverts
  - average turns and cost
  - an autonomy-level recommendation

  Alongside it comes a PR proposing `CLAUDE.md` / `.agent/LESSONS.md` updates from recurring
  failures. You decide.

- **Architecture review:** every 10 merges (`architectureReviewEveryNMerges`), a `type:refactor`
  "Architecture & drift review" ticket opens for you.

## What stops the agent from doing damage

| Risk                              | Stopped by                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Pushing to `main` / force-pushing | The LLM has no write credential; branch protection; Bash hook                     |
| Merging its own work              | The LLM has no merge credential; the merger script's checks; you at level 1       |
| Editing rules, CI, or test config | Edit hooks; CI `agent-guard`; CODEOWNERS (you); the App can't push workflow files |
| Weakening or deleting tests       | Integrity check (markers, counts); reviewer; golden replays                       |
| Runaway cost                      | `--max-turns`, job timeouts, concurrency 1, daily caps, kill switch               |
| Prompt injection via issues       | Trust gate; read-only token for the LLM; narrow tool allowlist                    |
| Hooks silently not loading        | Canary file check fails the run                                                   |

## Troubleshooting

- **Nothing happens on schedule:** check `AGENT_PAUSED`, the Actions tab (scheduled workflows only
  run from `main`), and whether any ticket is actually `status:ready` and unblocked.
- **The worker keeps escalating:** read its comments. The usual causes are unclear criteria (send
  the ticket back to `status:needs-refinement`) or a needed protected-file change, which you make.
- **CI is red on `main`:** pause the loop, fix or revert, then unpause.
