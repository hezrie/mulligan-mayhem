# Definition of Done

A PR is done when **every** item below holds. The reviewer agent enforces this with a fresh
context, CI enforces what tooling can, and the worker never grades its own work.

## Checklist

- [ ] **Every acceptance criterion has a test** that fails without the change and passes with it.
- [ ] **`npm run check` passes in CI**: typecheck, lint + layer rules, unit/invariant/replay tests
      with coverage gates, integrity, build, and e2e. "Passes on my machine" doesn't count.
- [ ] **No protected files touched** (CI `agent-guard`). The only exceptions are new golden
      replay files, and replay changes on tickets labelled `physics-change`.
- [ ] **No test removed or weakened:** no deleted tests, loosened assertions, widened tolerances,
      skipped/focused tests, or changed test intent. The integrity check catches the mechanical
      cases; the reviewer catches the rest.
- [ ] **Stayed in scope:** nothing beyond the ticket's criteria; the "Out of scope" list is respected;
      the size limit (S ≤ ~150 lines, M ≤ ~400) is respected.
- [ ] **Layers respected:** core stays pure and deterministic; render and UI don't mutate state.
- [ ] **Readable:** clear names, small functions, comments that explain _why_; no dead code or
      debugging leftovers.
- [ ] **UI changes include screenshots** (desktop + mobile) from the e2e run's artifacts, linked
      in the PR body.
- [ ] **The PR body** contains:
  - a table mapping **each acceptance criterion → its test** (file + test name);
  - `Closes #N`;
  - **follow-ups** written as proposed tickets (title + one line each), never done silently;
  - anything the reviewer should look at closely (risks, judgement calls).

## Not done

These outcomes are not done, and they are not failures either. They get escalated with
`status:needs-human`:

- a criterion that can't be met as written;
- work that needs a protected file or a product decision;
- a flaky test.
