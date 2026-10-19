# Architecture

Mulligan Mayhem is a TypeScript + Vite single-page app that draws to an HTML canvas, with no game
engine. The design has one goal: **the game's behaviour is a pure, deterministic function that can be
tested headlessly**, so CI, not an agent's opinion, decides whether a change works.

## Layers

```
            ┌──────────────┐  Shot   ┌──────────────────────────────┐
 pointer ──▶│  src/input   │────────▶│                              │
            └──────────────┘         │          src/core            │
            ┌──────────────┐ reads   │  pure, deterministic, no DOM │
 canvas  ◀──│  src/render  │◀────────│  math · rng · physics ·      │
            └──────────────┘         │  course · game · scoring ·   │
            ┌──────────────┐ reads   │  hash                        │
 DOM HUD ◀──│   src/ui     │◀────────│                              │
            └──────────────┘         └──────────────────────────────┘
            ┌──────────────┐ drives        ▲
 Playwright▶│ src/testing  │───────────────┘   (dev/test/e2e builds only)
            └──────────────┘
     src/app/ (composition root) creates the layers, connects them and runs the frame loop;
     src/main.ts only boots src/app and, in dev/test builds, src/testing
```

| Rule                                                            | Enforced by                                   |
| --------------------------------------------------------------- | --------------------------------------------- |
| core imports only core (+ `zod`)                                | dependency-cruiser `core-is-pure`             |
| input / render / ui / testing import only core                  | dependency-cruiser `*-depends-only-on-core`   |
| only `main.ts` loads `src/testing`; nothing imports `main.ts`   | dependency-cruiser                            |
| `src/app` imports core/input/render/ui; only `main.ts` loads it | dependency-cruiser `only-main-loads-app`      |
| no circular imports; no devDependencies in shipped code         | dependency-cruiser                            |
| core: no DOM, timers, `Date`, `console`, `globalThis`           | ESLint `no-restricted-globals`                |
| core: no `Math.random`; no engine-dependent `Math.*` or `**`    | ESLint `no-restricted-properties` / `-syntax` |
| render/ui don't mutate state                                    | `Readonly` types (TypeScript)                 |
| `main.ts` stays a boot file; `src/app` files stay small         | ESLint `max-lines` (40 / 200 per file)        |
| `window.__MM__` absent from production                          | `__TEST_API__` define + `prod-smoke` e2e      |

## Core modules

| Module                      | Responsibility                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| `core/math/vec2.ts`         | Immutable 2D vectors                                                                     |
| `core/math/geometry.ts`     | Closest point on segment, point-in-polygon                                               |
| `core/math/trig.ts`         | Deterministic `sin`/`cos` from `+ − × ÷` only (ADR 0001)                                 |
| `core/rng.ts`               | mulberry32 seeded PRNG; state lives in `GameState` so it is hashed                       |
| `core/physics/constants.ts` | Every tuning constant, named and commented                                               |
| `core/physics/terrain.ts`   | `TERRAIN_KINDS` and the `TERRAIN` parameter table                                        |
| `core/physics/collision.ts` | Circle-vs-segment detection and response                                                 |
| `core/physics/step.ts`      | One fixed step of ball physics                                                           |
| `core/physics/timestep.ts`  | Real-time accumulator → number of fixed steps                                            |
| `core/course/schema.ts`     | zod `HoleSchema`; the `Hole` type is inferred from it                                    |
| `core/course/holes/*.json`  | Hole data; `holes/index.ts` validates every hole at load                                 |
| `core/course/generator.ts`  | Daily Course: `generateHole(seed, index)` (integer layout) and `seedForDate` (FNV-1a)    |
| `core/game/shot.ts`         | `Shot { angle, power }`                                                                  |
| `core/game/state.ts`        | `GameState` and `GamePhase`                                                              |
| `core/game/machine.ts`      | Pure transitions: `createGame`, `shoot`, `tick`                                          |
| `core/game/session.ts`      | `GameSession`: a small mutable wrapper used by main, tests, replays                      |
| `core/game/replay.ts`       | `ReplayFileSchema` + `playReplay`: the one way replays are played (tests, recorder, e2e) |
| `core/scoring/score.ts`     | Score names and share-card emoji from strokes and par                                    |
| `core/hash.ts`              | Stable hash of `GameState` (and `hashHole`) from exact float64 bits                      |

## Shell modules

| Module                     | Responsibility                                                         |
| -------------------------- | ---------------------------------------------------------------------- |
| `input/drag-to-shot.ts`    | Pure slingshot maths: grab radius, drag → `Shot`, cancel threshold     |
| `input/pointer.ts`         | Pointer events (mouse, touch, pen) → aim preview and shots             |
| `render/view.ts`           | Fit the hole into the canvas; world ↔ screen transforms                |
| `render/palette.ts`        | Colours; one per terrain kind (TypeScript forces new kinds to add one) |
| `render/renderer.ts`       | Draws a frame; keeps the backing store matched to CSS size × dpr       |
| `ui/hud.ts`                | Hole name, par, strokes, restart button                                |
| `ui/complete-screen.ts`    | "Hole complete — N strokes (Label)" dialog with Play again             |
| `testing/api.ts`           | `window.__MM__` (dev/test/e2e builds only)                             |
| `scripts/record-replay.ts` | `npm run replay:record`: fills a new replay's `expected` block         |

## Simulation

**Fixed timestep.** Physics always advances in steps of `DT = 1/120 s`. The render loop
(`requestAnimationFrame`) feeds real elapsed time into an accumulator (`core/physics/timestep.ts`)
and runs as many whole steps as have elapsed. Frame time is clamped, so a background tab can't
trigger a spiral of catch-up. The simulation never reads a clock, which makes it frame-rate
independent and replayable.

**Ball model.** A ball is a circle with position and velocity in world units, where y points down.
Each step:

1. **Rolling friction.** The terrain under the ball's centre (the base terrain, or the last zone
   polygon that contains it) reduces speed by a constant deceleration × DT, clamped at zero. It
   never reverses direction. Constant deceleration guarantees the ball stops within
   `speed / decel` seconds.
2. **Move with substeps.** Movement is split into `n = ceil(distance / (radius / 2))` substeps, so the
   ball never moves more than half its radius at a time and can't tunnel through a wall.
3. **Collide.** For each wall segment (boundary edges + interior walls), find the closest point on
   the segment. If it is closer than the radius, push the ball out along the contact normal and
   reflect the normal velocity component with restitution `e < 1`, keeping the tangential
   component. Segment end-points behave like round corners.
4. **Cup.** If the ball's centre is within the cup radius **and** speed ≤ `CUP_CAPTURE_SPEED`, the
   ball is holed. A faster ball rolls over.
5. **Rest.** If speed < `REST_SPEED`, velocity becomes zero and the ball is at rest. A safety cap
   (`MAX_ROLL_SECONDS`) forces rest so that no run can loop forever. Invariant tests prove that
   natural rest comes well before the cap.

**Determinism.** Core uses only operations that IEEE 754 defines exactly (`+ − × ÷ Math.sqrt`,
integer ops, `Math.floor/abs/min/max`), so the same inputs give **bit-identical** results in Node,
Chrome, Safari and Firefox. See [ADR 0001](decisions/0001-custom-deterministic-physics.md).

## Game state machine

```
            shoot(shot)                 ball at rest (not in cup)
  aiming ───────────────▶ rolling ───────────────────────────────▶ aiming
                             │  │
                             │  │ ball centre in water        HAZARD_PAUSE_STEPS later:
                             │  └──────────────────▶ hazard ──▶ aiming (ball at lastRest, +1 stroke)
                             │ ball captured by cup
                             ▼
                           holed ──(restart)──▶ aiming (strokes = 0)
```

- `shoot` is accepted only while `aiming` and only with `power > 0`. Each accepted shot adds 1
  stroke and sets velocity `= power × MAX_SHOT_SPEED` in direction `angle`.
- When rolling ends, `lastRest` records where the ball stopped.
- If the ball's centre ends a step over water, the ball freezes there and the phase becomes
  `hazard` for `HAZARD_PAUSE_STEPS` (0.5 s, counted in `rollSteps`). Then the ball goes back to
  `lastRest` at zero velocity with a 1-stroke penalty. Holes may not put the tee or cup in water.
- Future phases slot in here: `next` (course progression).

`GameState` is a plain, serializable object: `holeId`, `phase`, `ball { pos, vel }`, `strokes`,
`lastRest`, `step`, `rollSteps`, `rngState`. `hashState(state)` folds every field, using exact float
bits, into a 16-hex-digit FNV-1a hash.

## Hole schema (`core/course/schema.ts`)

Holes are JSON data, validated by zod when the module loads. An invalid hole fails the test suite.
On top of field types, validation enforces several layout rules:

- unknown fields are rejected, which catches typos
- all geometry lies within `size`
- tee and cup are inside `boundary`
- the tee is more than a ball radius from every wall
- the cup is clear of every wall, so the ball can reach it
- walls have non-zero length

| Field      | Type                                   | Notes                                         |
| ---------- | -------------------------------------- | --------------------------------------------- |
| `id`       | kebab-case string                      | unique; also the file name                    |
| `name`     | string                                 | shown in the HUD                              |
| `par`      | integer 1–6                            |                                               |
| `size`     | `{ width, height }`                    | world units; the renderer fits this to screen |
| `boundary` | `Vec2[]` (≥ 3, closed polygon)         | outer walls; the ball must stay inside        |
| `walls`    | `{ a: Vec2, b: Vec2 }[]`               | interior wall segments (default `[]`)         |
| `tee`      | `Vec2`                                 | ball start, inside `boundary`                 |
| `cup`      | `{ x, y, radius? }`                    | radius defaults to `CUP_RADIUS`               |
| `terrain`  | `{ base, zones: { kind, polygon }[] }` | `kind` ∈ `TERRAIN_KINDS`; the last zone wins  |

## Input → Shot

`src/input` turns a press-drag-release into a `Shot`:

- The drag vector runs from the ball to the pointer, in world coordinates.
- The shot direction is the **opposite** of the drag (slingshot), and power is
  `min(dragLength / MAX_DRAG, 1)`.
- A release with power below a small threshold is a cancel, not a stroke.

`src/app` passes in the render layer's screen↔world transform, so input never imports render.

## Test API (`window.__MM__`, dev/test/e2e builds only)

| Method                              | Behaviour                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `ready`                             | `true` once installed                                                           |
| `loadHole(id, seed = 1)`            | Loads a hole and switches to a **manual clock** (real-time loop stops stepping) |
| `shoot(angle, power)`               | Same as a player shot; throws unless the phase is `aiming`                      |
| `fastForward(ms \| 'untilRest')`    | Runs fixed steps synchronously; returns the number of steps run                 |
| `getState()`                        | A copy of `GameState`                                                           |
| `getStateHash()`                    | `hashState(state)`: equal to the Node golden replay for the same shots          |
| `getGeneratedHoleHash(seed, index)` | `hashHole(generateHole(seed, index))`: equal to Node for the same inputs        |
| `getBallClientPosition()`           | The ball's position in client pixels, for real pointer-input tests              |

`__TEST_API__` is `false` in production builds, so the bundler removes the code entirely. The
`prod-smoke` e2e project checks both the runtime and the shipped bundle.

## Test layers

| Layer         | Where                             | Proves                                                                                                                                                        |
| ------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | `tests/unit/**`                   | Each core function; coverage gate on `src/core/**` (90% / 85%)                                                                                                |
| Invariant     | `tests/invariants/**`             | Over many seeded random shots: the ball stays in bounds, speed never increases without a force, the ball rests within N s, the same inputs give the same hash |
| Golden replay | `tests/replays/*.json`            | Recorded shots still produce the exact strokes, outcome and final hash                                                                                        |
| E2E           | `e2e/*.spec.ts`                   | The real build plays the hole via `__MM__`, with the same hash as Node; no console errors; desktop + mobile screenshots                                       |
| Integrity     | `scripts/check-test-integrity.ts` | No focus/skip/todo markers; test counts never drop                                                                                                            |
| Guardrails    | `tests/guardrails/**`             | Hooks block what they must; protected paths and config stay in sync                                                                                           |

## Build modes

| Mode          | Command             | `__TEST_API__` | Used for                        |
| ------------- | ------------------- | -------------- | ------------------------------- |
| `development` | `npm run dev`       | true           | local play and debugging        |
| `test`        | Vitest              | true           | unit tests                      |
| `e2e`         | `npm run build:e2e` | true           | Playwright gameplay specs       |
| `production`  | `npm run build`     | **false**      | GitHub Pages deploy, prod smoke |
