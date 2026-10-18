import type { GameEvent } from '../core/game/machine.ts';

// These are `type` aliases over Readonly<{...}> rather than interfaces: anonymous object types get
// an implicit index signature, so snapshots built from them stay assignable to FxSnapshot.

/** What the renderer gets each frame besides the state: a real-time clock and fresh events. */
export type FrameInput = Readonly<{
  /** rAF timestamp in ms; keeps running while tests hold the simulation on the manual clock. */
  nowMs: number;
  /** Every event from the steps simulated since the previous frame. */
  events: readonly GameEvent[];
}>;

export type EventCounts = Readonly<{ bounce: number; cup: number; rest: number; holed: number }>;

export const ZERO_COUNTS: EventCounts = Object.freeze({ bounce: 0, cup: 0, rest: 0, holed: 0 });

export function countEvents(counts: EventCounts, events: readonly GameEvent[]): EventCounts {
  const next: { -readonly [K in keyof EventCounts]: number } = { ...counts };
  for (const e of events) next[e.type] += 1;
  return next;
}
