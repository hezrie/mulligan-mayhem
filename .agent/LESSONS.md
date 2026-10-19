# Lessons

Read this before every run, right after `CLAUDE.md`. Each lesson pairs a recurring failure with the
rule that prevents it. Agents never edit this file directly. Failed runs draft lessons in the
🤖 Agent Run Log, and the weekly digest proposes additions in a PR that the owner merges.

## Format

```
### L-NNN: <short imperative title>
- Seen in: #<issue>, #<PR> (YYYY-MM-DD)
- What went wrong: <one or two sentences>
- Rule: <what to do instead, stated so it can be followed mechanically>
- Enforced by: <test / lint rule / hook / CI check, or "prose only">
```

Prefer lessons that can become enforced checks. When a lesson gains enforcement, update its
"Enforced by" line.

## Lessons

### L-001: Don't hand-copy library type unions into acceptance criteria

- Seen in: #44 (2026-10-18)
- What went wrong: a criterion pinned `AudioContextLike.state` to `'suspended' | 'running' | 'closed'`, but
  TypeScript's DOM lib also has `'interrupted'`, so the "real AudioContext is assignable" criterion could never pass.
- Rule: refer to the library's own type (`AudioContextState`, `Pick<AudioContext, …>`) instead of copying its
  literal values. If a ticket copies a library union that doesn't match `node_modules/typescript/lib/lib.dom.d.ts`,
  escalate with the exact mismatch.
- Enforced by: prose only (refiner and worker)

### L-002: Plans must follow the product decisions that name the ticket

- Seen in: #10, #303 (2026-10-19)
- What went wrong: the `water-reset` decision (docs/GAME_DESIGN.md → Product decisions) said #10's plan stores the
  reset target in the `TERRAIN` table. The plan and PR hardcoded `'water'` instead, and the review approved it
  (follow-up #306).
- Rule: before planning or implementing, search docs/GAME_DESIGN.md → Product decisions for the ticket number
  and its epic, and follow every decision found. Reviewers check the diff against those decisions.
- Enforced by: prose only (planner, worker and reviewer)

### L-003: Check the ticket's claims about existing code against main before writing tests

- Seen in: #59, #69 (2026-10-19)
- What went wrong: #59 required `TERRAIN_PARTICLES` to equal a literal object keyed by `TerrainKind`, but `water`
  (added in #10) is also a `TerrainKind`. #69 assumed settings already had `sfxOn`/`sfxVolume` and no sound controls
  on the Settings screen, but main has a single `volume` field and a Volume slider. Both were found only after the
  worker started and ended in escalation.
- Rule: before the first test, grep main for every existing symbol, field, union and screen the criteria mention
  and compare it with the ticket's description (e.g. the members of `TERRAIN_KINDS`, the fields of `Settings`). If
  one differs, or a prerequisite ticket isn't merged, escalate with the exact mismatch. The refiner does the same
  check before marking a ticket ready.
- Enforced by: prose only (refiner and worker)
