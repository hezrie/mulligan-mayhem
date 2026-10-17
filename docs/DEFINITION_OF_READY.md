# Definition of Ready

A ticket may move to `status:ready` (the worker queue) only if **every** item below holds. The
refiner enforces this. A ticket that can't meet it gets 1–3 specific questions and
`status:needs-human`. Only the owner, or the refiner for the owner's and trusted family members'
ideas, moves tickets to `status:ready`. Agent-originated tickets start as `status:proposed`.

## Checklist

- [ ] **Problem / goal** is stated in one or two sentences, from the player's point of view where possible.
- [ ] **Acceptance criteria** are a checklist of observable, checkable statements. **Each one maps to
      a test someone could write**: a unit test, an invariant, a golden replay, or an e2e step.
      Write "Given / when / then" or a precise equivalent with numbers.
  - ✅ "A ball on sand decelerates at 3× the fairway rate (unit test on `step`)."
  - ❌ "Sand feels heavier."
- [ ] **Size** is `size:S` or `size:M`. **L-sized work must be split** into linked S/M tickets.
  - **S:** ≤ ~150 changed lines (excluding JSON data and lockfiles), one area (e.g. physics only).
  - **M:** ≤ ~400 changed lines, at most two areas (e.g. core + ui).
- [ ] **Priority** is set: `priority:P0` (broken/blocking) to `priority:P3` (nice to have).
- [ ] **Type** is set: `type:feature | bug | chore | refactor | test`.
- [ ] **Out of scope** lists what must _not_ be done in this ticket, to prevent scope creep.
- [ ] **Dependencies** are linked as `Blocked by #N` (one per line), or "None".
- [ ] **No unresolved product questions.** Every design decision the work needs is written into
      the ticket or `docs/GAME_DESIGN.md`. If one is missing, ask, don't guess.
- [ ] **Protected paths:** if the work needs a protected file changed (e.g. a new dependency or a
      golden replay change), the ticket says so explicitly and carries the right label
      (`physics-change` for replay changes). Otherwise it's a human task.

## Extra rules for size M

- The worker posts a **plan** first (approach, files, tests to add, risks) and labels the ticket
  `plan:proposed`. Code starts only after the reviewer, or the owner, adds `plan:approved`.

## Areas (for sizing)

`core/physics`, `core/course` (incl. hole data), `core/game` + `scoring`, `input`, `render`, `ui`,
`testing` + `e2e`, `docs`. A ticket touching three or more areas is L by definition: split it.
