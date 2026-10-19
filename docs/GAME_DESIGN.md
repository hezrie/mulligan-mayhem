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
| Rough   | More friction than fairway                                 | ✅ shipped  |
| Sand    | High friction                                              | ✅ shipped  |
| Ice     | Low friction                                               | ✅ shipped  |
| Water   | +1 penalty stroke; ball resets to its last resting spot    | ✅ shipped  |
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

## Roadmap

Agreed with the owner on 2026-10-17. The backlog is organised into epics, and each ticket carries an `epic:<key>` label.

### Vision

Over the next few months, Mulligan Mayhem grows from one tidy hole into two things: the family group chat's daily sport, and the phone that gets passed around on game night.

- **Every morning: Today's Nine.** A fresh nine-hole course that the solver bot has proven can be sunk. Everyone plays it exactly once, then argues about it through a numbered, Wordle-style share card.
- **Game night: Party Mode.** The couch becomes a tournament, with 'Pass to MAYA' screens, a live leaderboard strip, mulligans, house rules and a Chaos Deck. The deck drops banana peels on the leader's green, reverses their putter or fogs their screen, and last place picks the punishment.
- **In between: wilder courses.** Mud, slopes, water, peg fields, portals and a moving cup, spread across a World Tour of themed worlds with star gates, boss holes and trophies.
- **Then the group chat becomes the multiplayer server.** Ghost races against a friend's real shots, 'Beat my 27' challenge links, and homemade holes shared as links that carry proof they can be beaten.
- **Last: wild modes.** A roguelike Mulligan Run, an Endless Gauntlet and table-top Face-Off.

Three things hold it together:

1. **Every putt feels great.** Elastic aim, synthesized sound, haptics, a cup plunk worth replaying and slow motion near the cup. All of it is presentation and never touches the simulation.
2. **It stays honest and light.** No servers, no accounts, nothing sent anywhere. It installs to the home screen and plays offline on a hand-me-down phone.
3. **Determinism is the superpower.** The same engine that proves each daily hole can be sunk also powers ghosts, verified scores, exact party re-runs and player-made holes with built-in proof.

It is built the way the loop builds best: about 150 tickets in 13 epics, mostly small S tickets that auto-merge. New mechanics are optional hole data that does nothing when it is absent. Most fresh variety comes from content that needs no golden replay. Physics changes, hole packs and M tickets are batched into the owner's merge windows.

### Pillars

- Every putt feels great: elastic aim, impact, plunk, sound and haptics give juicy, readable feedback on every shot. Presentation never changes the simulation or the state hash.
- One course, one day, one group chat: the Daily Course is the heartbeat, and every social feature compares the same deterministic course.
- Chaos keeps the table close: party sabotage targets the leader and gives last place a say, so the final hole always matters.
- Rivalry without servers: links and codes carry everything, and replaying the shots on the receiver's own phone turns them into ghosts, challenges and verified scores.
- Variety from data, not code: new mechanics are optional fields that do nothing when absent. Most fresh content (daily holes, chaos and relic transforms, player-made holes) needs no golden replay.
- Built for the whole family: playable from 7-year-olds to grandparents, one-handed, readable for colour-blind players, respects reduced motion, works offline on cheap phones.

### Phases

| Phase | Name                         | What players notice                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Feels Like a Real Game       | The single hole becomes a polished toy you want to replay. - Elastic slingshot aim with a power ring, a ball trail, impact shake and sparks. - A cup plunk with a score stamp and confetti, slow motion and 'LIP OUT!' callouts near the cup. - Synthesized putt, tonk and plunk sounds, score stingers and phone buzzes. - A title, pause and settings shell, a ghost-hand tutorial with tips, and drag-anywhere aiming. - Reduced-motion support, and progress saved on the device. |
| 2     | The Daily Habit              | First, a 9-hole Classic course with a scorecard, stars, best scores and Copy result. Then Today's Nine: - A fresh course every day, proven sinkable by the solver bot. - One counted attempt, streaks and a Wordle-style stats panel. - A numbered share card for the group chat and a countdown to tomorrow. - Installable to the home screen and playable offline.                                                                                                                  |
| 3     | Party Night                  | 2-6 players pass one phone: - Setup with colours and emoji, 'Pass to MAYA' screens and a live party strip. - A standings sheet and podium, with mulligans and shareable house rules. - After each hole, the leader gets a Chaos Card revealed with a flip and a buzz. About 20 cards: banana peels, mirrored holes, Reverse Gear, Fog of War, Stroke Tax, Robin Hood and more. - Last place can choose the punishment.                                                                |
| 4     | Crazy Courses and World Tour | Holes gain mud, slopes, water hazards, peg fields, portals and a moving cup. A World Tour map of Meadow, Dune and Glacier worlds adds themed art, colour-blind-safe palettes, star gates, boss holes and a Trophy Case of achievements.                                                                                                                                                                                                                                               |
| 5     | Share by Link                | The group chat becomes the multiplayer server: - Ghost races against a friend's real shots, and a personal-best ghost. - 'Beat my 27' challenge links with match-play verdicts. - Verified score chips that can't be faked. - An in-browser hole editor whose holes travel as links with a Creator-Verified badge.                                                                                                                                                                    |
| 6     | Wild Modes                   | Three highly replayable modes: - Mulligan Run, a roguelike with relic drafting and a shareable seed. - Endless Gauntlet, generated holes that keep getting harder. - Table-top Face-Off for two players racing on one phone.                                                                                                                                                                                                                                                          |

### Epics

| Epic              | Phase | Goal                                                                                                                                                                                                                                       |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `epic:foundation` | 1     | Foundations and test harness: Land the invisible plumbing: event stream, moments, effects clock, test API, shared codec and determinism checks. This keeps the roughly 140 tickets after it S-sized, testable and safe for the state hash. |
| `epic:front-door` | 1     | Front door: shell, settings, save and onboarding: Give the game a front door: a screen router, title, pause, settings and a local save profile, plus onboarding that teaches the slingshot in seconds.                                     |
| `epic:juice`      | 1     | Juice and game feel: Make every aim, bounce and drop feel satisfying and readable, without ever changing the simulation or the state hash.                                                                                                 |
| `epic:soundscape` | 1     | Synth soundscape and haptics: Give the game a voice: synthesized sound effects, adaptive rolling audio, score stingers, haptics and an optional Song of the Day, with zero audio files.                                                    |
| `epic:daily`      | 2     | Daily Course: Today's Nine: Ship Today's Nine: one generated course per day that the bot has proven solvable, one counted attempt, streaks and stats, a numbered share card, installable and playable offline.                             |
| `epic:rounds`     | 2     | Classic course, stars and the content pipeline: Turn one hole into a 9-hole Classic course with a scorecard, stars and best scores, and set up a hole-content pipeline that works around the golden-replay bottleneck.                     |
| `epic:chaos`      | 3     | The Chaos Deck: Ship the Chaos Deck: about 20 cards that sabotage the leader through hole, shot, view and score transforms, revealed with ceremony, with an option for last place to choose.                                               |
| `epic:party`      | 3     | Party Mode: pass-and-play: Make pass-and-play Party Mode for 2-6 players a polished ritual: setup, pass screens, live standings, podium, mulligans and house rules.                                                                        |
| `epic:mechanics`  | 4     | Mechanics lab, wave 1: Double hole variety with mud, slopes, water, posts, portals and a moving cup, added as optional data that leaves every existing hole and replay untouched.                                                          |
| `epic:world-tour` | 4     | World Tour: themes, star gates and trophies: Give players a long-term journey: themed worlds on a campaign map, star gates, boss holes and a Trophy Case.                                                                                  |
| `epic:rivals`     | 5     | Rivals by link: ghosts, challenges and verified scores: Turn the group chat into async multiplayer: ghost races, challenge links with match-play verdicts, and scores verified by replaying the shots.                                     |
| `epic:workshop`   | 5     | Course Workshop: build and share holes: Let anyone build a hole on their phone and share it as a link that proves the author could sink it.                                                                                                |
| `epic:wild`       | 6     | Wild modes: Mulligan Run, Gauntlet and Face-Off: Add three highly replayable modes built from existing parts: the Mulligan Run roguelike, the Endless Gauntlet and table-top Face-Off.                                                     |

## Product decisions

These are binding for tickets and agents. To change one, the owner edits it here; tickets that relied on the old default list it under "Design decisions assumed".

- **daily-day-boundary**: When does a new Daily Course start: UTC midnight or each player's local midnight?  
  **Decision:** Local midnight. The date key and day number come from the player's local calendar date. The share card shows both the day number and the date, so families in different timezones can see when they are on different puzzles.
- **mulligan-rule**: What exactly does a Mulligan do, how many do players get, and where is it allowed?  
  **Decision:** Redo: the ball returns to where it was before the last stroke, and that stroke is erased. - Each Party player starts with 1. After each hole, last place earns +1, holding at most 3. - Minus-one (the hole's final score drops by 1, minimum 1) is available as a House Rule. - Never available in the Daily, in challenges or in ghosts.
- **chaos-tie-rule**: When the lead is tied, who gets the Chaos Card?  
  **Decision:** All tied leaders get the same card, drawn once. Core keeps a tieRule parameter ('all' | 'random'), so House Rules can switch to one seeded-random leader.
- **hole-content-pipeline**: How do handcrafted holes ship, given that every registered hole needs a golden replay and every PR touching tests/replays/ needs the owner's merge?  
  **Decision:** Registered holes ship only in packs of 3-4 holes per ticket, scheduled into the owner's merge window. Each pack includes: - replays at par and within par+3 - a clean lintHole pass - the hole-report output in the PR body Day-to-day variety comes from unregistered content that needs no replay files: the Daily generator gated by the solver, chaos and relic transforms, and player hole codes with embedded proof. Owner action requested: amend CODEOWNERS so a PR that only adds new files under tests/replays/ (no edits or deletions) can auto-merge once the replay suite passes.
- **owner-merge-cadence**: How should M tickets and replay-bearing PRs be scheduled so they don't stall the WIP-limit-1 queue?  
  **Decision:** The owner holds two fixed merge windows a week, for example Tuesday and Friday evening. The planner starts M and replay-bearing tickets so their PRs are ready just before a window, and keeps S tickets flowing in between. Owner action requested: consider WIP 2 with one lane reserved for auto-merging S tickets (agent.config.json).
- **landing-screen**: Should opening the game land on the new title screen instead of going straight into play?  
  **Decision:** Not yet. The root URL keeps booting into play, so the two existing specs that drag immediately keep their intent. The title lives at #/menu and behind the ☰ button. When the Daily ships, the owner approves flipping the landing to the title and updates those two specs, as an owner-made test change.
- **shot-quantization**: Should every live shot be rounded in the input layer so share codes are compact and replay exactly?  
  **Decision:** Yes, in every mode. When input creates a Shot, the angle is rounded to the nearest 1e-4 rad and power to the nearest 1e-3 (minimum 0.05). Core never rounds. Golden replays and **MM**.shoot bypass input and use the lossless float64 fallback.
- **version-mismatch-policy**: What happens to old links after the physics or the Daily generator changes?  
  **Decision:** Every code embeds PHYSICS_VERSION and GENERATOR_VERSION. On a mismatch, scores still show, but ghosts and verification are disabled with the message 'This link is from an older version'. Versions bump only with an owner-approved physics or generator change.
- **pick-up-rule**: Is there a stroke cap per hole, and how is a picked-up hole scored?  
  **Decision:** Yes, in every mode. After stroke par+4 comes to rest unholed, the hole ends and records par+5, which is always a red square on the share card. Party House Rules can change the cap to par+3 or remove it; Daily and Classic always use par+4.
- **daily-attempt-rules**: What counts as your Daily score, and which assists are allowed in it?  
  **Decision:** One counted attempt per date. - Restart is hidden during the counted attempt. Leaving mid-round resumes at the same hole and stroke, because state is saved after every rest. - Replays are labelled PRACTICE and never overwrite the result. Archive plays never affect streaks. - No Mulligans, chaos cards or trajectory previews in the Daily or in challenges. - Hard Mode, when it ships later, only adds an asterisk.
- **daily-epoch-and-card**: How is the Daily numbered, and what does its share card look like?  
  **Decision:** Daily #1 is 2026-11-01. The card has three lines: 1. 'Mulligan Mayhem #42 · 2026-12-12' 2. the nine emoji, then the total and vs-par, e.g. '31 (+1)' 3. optional: '🔥 12-day streak' Without the extras, the existing #7 output stays byte-identical.
- **star-thresholds**: How many stars does a hole award?  
  **Decision:** 3 stars at or under par, 2 stars at par+1 or par+2, 1 star for any finish. The best stars per hole are kept, and stars are never spent.
- **unlock-economy**: What drives progression and unlocks?  
  **Decision:** Stars are the only progression currency, and they are never spent. World gates use cumulative stars: World 2 at 10, World 3 at 24, World 4 at 40, World 5 at 58, World 6 at 78 (out of 108). Trophies unlock cosmetics later. No coins, shop, energy timers or ads.
- **force-mechanics-rule**: How do slopes and other external forces work, and does the S-sized slope design replace #11?  
  **Decision:** Yes, it replaces #11. Slopes are 8 fixed-direction terrain kinds with fairway friction plus SLOPE_ACCEL of 150 units/s². Every future force (wind, magnets) follows the same rules: - it acts only while speed is above REST_SPEED - it is strictly smaller than the local rolling deceleration (at most 0.8 times it) - it gets its own invariant file
- **water-reset**: Where does the ball go after a water hazard, and how are future hazards defined?  
  **Decision:** +1 stroke, and the ball returns to its last resting spot (the tee if it never came to rest), as GAME_DESIGN says. #10's plan stores the reset target as data in the TERRAIN table ('lastRest' | 'tee'), so lava and pits later become table entries.
- **moving-obstacle-clock**: Which clock drives the moving cup, and later the windmills?  
  **Decision:** Time since the current shot. The cup sits at home while you aim and starts moving when you shoot, as a pure function of how many steps the roll has run. No new state, no waitSteps in replays, and the solver, ghosts and pass-and-play all work unchanged.
- **chaos-defaults**: What are Party Mode's default chaos settings?  
  **Decision:** Intensity 'Spicy': all shipped cards, 1 per hole. - A blind draw after every hole except the last. - An effect lasts only the target's next hole. - At most 2 effects on one player per hole. - Saboteur's Choice and 'Mild' (view and score cards only) are available as House Rules.
- **new-mode-rules**: What are the scoring numbers for the new solo and duel modes?  
  **Decision:** - Mulligan Run: Nerve starts at 5, −1 per stroke over par, +1 for birdie or better, maximum 9, and the run ends at 0. - Endless Gauntlet: the run ends when the total goes past +6 over par. - Face-Off: the first ball holed (the lower step count) wins the point, the same step is a draw, best of 5.
- **cross-browser-gate**: Must determinism be proven on WebKit before the Daily and ghost links go public?  
  **Decision:** Yes. Agents write e2e/determinism.spec.ts, checking that the browser hash equals the Node hash for every replay and for 5 fixed Daily dates. Before the Daily tile appears at the root URL, the owner adds WebKit and Firefox Playwright projects and CI jobs, which are protected files.
- **generator-mechanics-policy**: Which mechanics may the Daily generator use, and when do new ones enter it?  
  **Decision:** Generator v1 uses only fairway, rough, sand, ice and walls. A mechanic joins the generator only after it has shipped in handcrafted holes, and each addition bumps GENERATOR_VERSION. Weekday modifiers (such as Mirror Monday) and the 18-hole Sunday Major wait until the Daily has run for 4 weeks.
- **settings-defaults**: What are the default settings?  
  **Decision:** - Sound effects on at volume 70 - Music off - Haptics on - Motion follows the system setting - Colours: Classic - Aim mode: 'Grab the ball' - Handedness: right - Power % hidden - Text size 100%
- **ugc-and-names-policy**: How are player-entered names and player-made holes handled?  
  **Decision:** - Names for players and profiles are at most 12 characters; hole names at most 32 bytes. All are rendered with textContent only, with no profanity filter. - Player holes travel only through links people choose to share. No community pool or GitHub submission flow for now. - A shared hole gets the Creator-Verified badge only if its author sank it at or under par+3. Unverified links still load, marked 'Unverified'.

### Not planned (for now)

- Online multiplayer, global leaderboards, accounts, server-checked scores and push reminders. These need a backend, which the product rules forbid. Async links and scores verified by replaying the shots cover the social need.
- Labyrinth tilt toy. It needs input on every physics step, which breaks the one-shot-per-stroke model behind determinism, replays and scoring, and real tilt can't be tested in Chromium e2e.
- True simultaneous multi-ball physics and ball-vs-ball collisions. GameState holds one ball, and the rewrite isn't worth it now; Split Shot could later fake it with parallel sessions.
- Elevation or 3D, and a scrolling camera for holes taller than one screen. Both are large render and design rewrites; for now every hole stays within one phone screen.
- Jumps, ramps and chip shots; curve shots with a spin dial. These are XL chains that need new hashed state slots. Revisit once mechanics wave 1 has proven the optional-field pattern.
- Windmills and sliding walls (collisions with moving walls). XL work that adds energy to the ball; deferred to mechanics wave 2, after the moving cup proves the clock rule.
- Mechanics wave 2: wall materials and rubber bumpers, one-way gates, switches and doors, boost pads, magnets and gravity wells, wind, lava and pits, breakable crates, and fast-green terrain. Wave 1 (mud, slopes, water, posts, portals, moving cup) already doubles hole variety, and each of these is an M ticket the owner must merge.
- Caddy line / Crystal Ball trajectory preview. It conflicts with Daily fairness and makes aiming trivial; revisit as a practice and editor tool after the workshop ships.
- Video clip export with MediaRecorder. Encoder support differs between browsers and tests can only check file size and type; emoji cards and links travel better.
- Instant replay and the hole-in-one kill-cam. Deferred to a later juice wave: it needs a replay controller on top of the router and effects clock, and the phase 1 juice budget goes to live feel first.
- Hand-written QR encoder. It takes 5 tickets plus reference fixtures the owner would have to supply, and links already reach everyone at the table through the group chat.
- Community Hole of the Day via GitHub issues. It needs protected .github changes, moderation, and a privacy decision about linking out to GitHub.
- Caddie Rank XP and titles. A third progression track next to stars and trophies would confuse a family audience.
- Tap-swing power meter and fine-aim mode. Drag aim plus drag-anywhere covers the need, and a second control scheme is one more thing to teach.
- Relay leaderboard in a link, and importing scores pasted from the group chat. Deferred until head-to-head challenges prove the link format; the URL length budget and merge rules add complexity.
- Daily wave 2: weekly league card, Streak Freeze, Pin of the Day, 'How the bot did it' reveal, names and difficulty stars for generated holes, Hard Mode, image share card and tomorrow's teaser. Deferred until the Daily has run for about 4 weeks.
- Party wave 2: Skins, Match Play, Stableford and Elimination formats, closest-to-the-pin playoff, tournament brackets, awards and Shot of the Night, rematch and the Rivalry Book, handicaps, household-vs-household challenge link. Deferred until the core party loop ships.
- Chaos wave 2: Chaos Draft, sabotage placement, boon cards (including Crystal Ball and Gimme Zone), the Codex, Shot Clock, Hot Potato, Three Strikes, Gust and the Architect card. Wave 1 ships about 20 cards, enough for many party nights.
- Bot rivals with personalities. They need the solver's best-shot search and a party seat model; later.
- Party minigames (Curling, Bank-Shot Bingo, Limbo), Bonus Rounds (Skee-Ball, Plinko cups, Dartboard) and Split Shot multi-ball. Fun, but each needs its own mode screens; revisit after party wave 2.
- Creator wave 2: Text Holes, Doodle Walls, Prefab Stamps, My Holes Library, remix with lineage, Course Packs, Family Club, Seed Explorer, Daily Build Prompt, score receipts, Bot Par, the Shot Sweep heatmap and Party Build-Off. Deferred until the editor and Clear Check ship.
- World Tour wave 2: Locker cosmetics, crowns and bonus objectives, golden-tee collectibles, chili difficulty ratings, and the Haunted, Candy and Cosmic worlds.
- Night Golf lighting, seasonal events and Haunted fog. Cheap and render-only, but Spooky Week (Oct 24) can't land in time; schedule them for the winter season once World Tour themes exist.
- Accessibility and performance wave 2: screen-reader announcer, audio aim sonar, keyboard aim, a bottom thumb bar, the adaptive quality governor and a JS bundle-size budget. The essentials land earlier: reduced motion, contrast outlines and drag-anywhere in phase 1; colour-blind palettes and a static-layer cache in World Tour.
- Trick Shot Challenges (one-stroke puzzles). Content-heavy and every puzzle needs a golden replay; deferred behind the World Tour packs.
- Mechanics enablers for hashed state slots and replay waitSteps. Not needed under the recommended moving-cup clock; build them with mechanics wave 2.
- Merged rather than built twice: the three achievement and sticker-book ideas become one Trophy Case (world-tour), the two personal-best ghost ideas become one (rivals), and the separate save, hole, ghost and challenge code formats share one byte codec (foundation).
