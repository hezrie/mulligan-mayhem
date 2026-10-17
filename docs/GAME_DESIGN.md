# Game Design — Mulligan Mayhem

## Pitch

**Wordle meets mini-golf, plus party chaos.** One shared **Daily Course** every day, so the family
group chat can compare scores. **Party Mode** is pass-and-play on one phone, where **Chaos Cards**
let you sabotage the leader.

Audience: friends and family, on phones first and desktop second. No accounts, no backend.

## Core feel

- Top-down 2D. Bouncy, readable, quick: a hole takes **20–60 seconds**.
- **Aim like a slingshot:** press on or near the ball and drag _away_ from the direction you want to
  shoot. Drag distance sets power, from 0 to 1, capped at a maximum drag length. An aim line shows
  the direction and the power. Release to shoot; drag back onto the ball to cancel.
- The ball bounces off walls, rolls, slows down and stops. It drops into the cup only if it is
  over the cup **and** moving slowly enough. Too fast and it rolls over.
- One stroke per shot. A hole ends when the ball drops.

## Scoring

| Strokes vs par | Name                 | Share-card emoji |
| -------------- | -------------------- | ---------------- |
| ≤ par − 2      | Eagle (or better)    | 🟦               |
| par − 1        | Birdie               | 🟩               |
| par            | Par                  | ⬜               |
| par + 1        | Bogey                | 🟨               |
| ≥ par + 2      | Double bogey (worse) | 🟥               |

The completion screen reads: **"Hole complete — 3 strokes (Par)"**. Exactly 1 stroke is named
**"Hole in one"** whatever the par. The emoji always follows strokes versus par, so a hole in one on
a par 2 is a birdie (🟩).

## Terrain

| Terrain | Effect                                                     | Status      |
| ------- | ---------------------------------------------------------- | ----------- |
| Fairway | Baseline rolling friction                                  | ✅ skeleton |
| Rough   | More friction than fairway                                 | backlog     |
| Sand    | High friction                                              | backlog     |
| Ice     | Low friction                                               | backlog     |
| Water   | +1 penalty stroke; ball resets to its last resting spot    | backlog     |
| Slope   | Constant force in one direction while on it                | backlog     |
| Walls   | Static line segments; ball bounces with some energy loss   | ✅ skeleton |
| Bumpers | Bouncier obstacles (round or segment)                      | backlog     |
| Moving  | Animated obstacles, e.g. a windmill, deterministic in time | backlog     |

## Daily Course

- 9 holes generated from a **date seed**, identical for everyone on every device and browser.
  The deterministic-math rules in ADR 0001 exist for exactly this.
- Every generated hole must be **provably solvable**: a search bot must sink it within par + 3
  before the hole is accepted.
- Best scores are kept in local storage only.

## Share card

An emoji scorecard copied to the clipboard: one emoji per hole (table above), plus the total
versus par and the date. Example:

```
Mulligan Mayhem — 2026-10-17
🟩⬜⬜🟨⬜🟦⬜🟥⬜  31 (+1)
```

## Party Mode

- 2–6 players pass one device, taking turns hole by hole.
- After each hole, the **leader** is hit by a random **Chaos Card**, drawn with the seeded RNG:
  - **Gust:** wind, a constant force on the ball
  - **Banana Peel:** an ice patch near the cup
  - **Tiny Putter:** −30% max power
  - **Moving Cup:** the cup moves along a path
- **Last place** gets a **Mulligan**.

## Juice

A ball trail, a cup "plunk", confetti for a hole in one, and a small screen shake on big bounces.
Juice is presentation only: it must never change the simulation, so the state hash ignores it.

## Platforms

Touch-first on phones, and it works with a mouse on desktop. Portrait layout. No accounts or
backend, and nothing is sent anywhere.

## Walking skeleton (what exists today)

One handcrafted par-3 hole (`skeleton-01`), fairway only, fully playable:

- aim, shoot, bounce off walls
- the ball slows, stops, and drops into the cup
- a stroke counter
- the "Hole complete — N strokes (Name)" screen, with a restart button

## Open product questions

These are resolved by the owner and recorded here when answered.

1. Daily Course "day": UTC midnight or each player's local midnight? This matters if family
   members are in different timezones.
2. What exactly does a Mulligan do: redo the last stroke, or subtract one stroke?
3. When the lead is tied, who gets the Chaos Card: all tied leaders, or a random one?
