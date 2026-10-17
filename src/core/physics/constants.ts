/**
 * Every physics tuning constant lives here. Units: world units (1 unit = 1 CSS px at scale 1)
 * and seconds. Changing any value changes golden-replay hashes, so it needs `physics-change`.
 */

/** Fixed simulation step: 120 Hz, independent of display refresh rate. */
export const DT = 1 / 120;

export const BALL_RADIUS = 6;
export const CUP_RADIUS = 10;

/** Ball speed at power 1. A full-power shot on fairway rolls roughly 890 units in ~2.2 s. */
export const MAX_SHOT_SPEED = 800;

/** The ball drops only if its centre is over the cup AND it is at most this fast. */
export const CUP_CAPTURE_SPEED = 280;

/** Below this speed the ball stops dead (avoids an endless creep toward zero). */
export const REST_SPEED = 5;

/** Fraction of the normal velocity kept after hitting a wall. Must be < 1 (no energy gain). */
export const WALL_RESTITUTION = 0.8;

/** Fraction of the tangential velocity lost on wall impact. */
export const WALL_FRICTION = 0.05;

/** Safety cap: a roll is force-stopped after this long. Invariants prove natural rest is sooner. */
export const MAX_ROLL_SECONDS = 30;
export const MAX_ROLL_STEPS = Math.ceil(MAX_ROLL_SECONDS / DT);

/** Longest real frame the clock will simulate, e.g. after a backgrounded tab returns. */
export const MAX_FRAME_SECONDS = 0.25;
