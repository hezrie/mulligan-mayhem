# ADR 0001: Custom deterministic physics with IEEE-exact math

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** @hezrie (owner), founding engineer

## Context

Mulligan Mayhem needs:

1. **Identical results on every device.** The Daily Course is "the same 9 holes for everyone", so
   course generation and the solvability check must produce bit-identical output in Chrome, Safari,
   Firefox and Node.
2. **Headless, exact tests.** An agent loop builds this game, and CI is the judge. Golden replays
   and invariant tests need simulations that reproduce exactly, so a one-ulp drift shows up as a
   failure and not as a mysterious flake.
3. **Very little physics.** One ball (a circle) against static line segments, plus later simple
   moving obstacles, terrain friction zones and constant forces (slopes, wind).

General-purpose engines (Matter.js, Planck.js, Box2D/Rapier via WASM) solve a much larger
problem. Their JS builds make no cross-engine determinism guarantee, the WASM builds that do add
weight and a build step, and none of them give us an easy, exact, inspectable state hash.

## Decision

Write a small custom physics module in `src/core/physics` with these rules:

- **Fixed timestep `DT = 1/120 s`.** The render loop converts real time into whole steps with an
  accumulator. The simulation never reads a clock.
- **Ball vs segments only.** Circle-vs-segment collision with push-out and restitution. Movement is
  split into substeps of at most half the ball's radius, so the ball can't tunnel through walls.
- **Constant rolling deceleration per terrain.** This gives a provable bound on time-to-rest
  (`speed / decel`), plus a safety cap.
- **IEEE-exact arithmetic only** in `src/core`: `+ − × ÷`, `Math.sqrt`, integer/bit ops,
  `Math.floor/ceil/round/trunc/abs/min/max/sign/imul`.
  - ECMAScript specifies these exactly. It lets engines approximate `Math.sin/cos/tan/atan2/exp/log/pow/hypot/cbrt` and `**`, so those can differ between engines.
  - ESLint bans them in core, and `src/core/math/trig.ts` provides deterministic `sin`/`cos` built from polynomials with Cody–Waite range reduction.
  - JavaScript never fuses multiply-add, so results are reproducible.
- **Seeded randomness only.** `src/core/rng.ts` (mulberry32: integer ops) is the only source of
  randomness, and its state lives inside `GameState`.
- **State hashing on exact bits.** `src/core/hash.ts` hashes the IEEE-754 bit patterns of every
  float in `GameState` with FNV-1a, so any change in behaviour changes the hash.

## Consequences

**Good**

- Same inputs give the same hash in Node and Chromium, and e2e asserts it.
- Golden replays (`tests/replays/*.json`) catch any silent physics regression.
- The code is small and readable enough for an agent to change safely with tests.
- Course generation (backlog) can rely on the same guarantees.

**Costs and risks**

- We own collision correctness. Mitigated by unit tests, invariant sweeps (no escape from bounds,
  no energy gain, guaranteed rest) and golden replays.
- Deterministic trig is slightly slower than native. That's irrelevant for one ball at 120 Hz.
- Any intentional physics change alters golden hashes. That's deliberate: it needs the
  `physics-change` label and human review, then replays are re-recorded with
  `npm run replay:record`.
- Hashes are compared exactly, so tests must not tolerate "close enough". Use tolerances only
  for properties such as rest time and bounds, never for hashes.

## Alternatives considered

| Option                      | Why not                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| Matter.js / Planck.js       | No cross-engine determinism guarantee; far more surface than we need |
| Rapier (deterministic WASM) | Deterministic, but heavy, adds WASM tooling, and is opaque to agents |
| Variable timestep           | Frame-rate dependent; can't be replayed                              |
| Native `Math.sin` etc.      | Engine-dependent results would break "same course for everyone"      |
