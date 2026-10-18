import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../../src/core/game/machine.ts';
import { countEvents, ZERO_COUNTS, type EventCounts } from '../../../src/render/fx-frame.ts';

const bounce: GameEvent = { type: 'bounce', impulse: 1 };
const rest: GameEvent = { type: 'rest', forced: false };

describe('countEvents', () => {
  it('counts each event kind from ZERO_COUNTS', () => {
    expect(countEvents(ZERO_COUNTS, [bounce, bounce, rest])).toEqual({
      bounce: 2,
      cup: 0,
      rest: 1,
      holed: 0,
    });
  });

  it('counts cup and holed events and adds to existing counts', () => {
    const start: EventCounts = { bounce: 1, cup: 0, rest: 2, holed: 0 };
    const events: GameEvent[] = [{ type: 'cup' }, { type: 'holed', strokes: 1 }];
    expect(countEvents(start, events)).toEqual({ bounce: 1, cup: 1, rest: 2, holed: 1 });
  });

  it('returns an equal object for an empty list', () => {
    expect(countEvents(ZERO_COUNTS, [])).toEqual(ZERO_COUNTS);
  });

  it('does not mutate the input counts', () => {
    const start: EventCounts = { bounce: 0, cup: 0, rest: 0, holed: 0 };
    const snapshot = { ...start };
    const next = countEvents(start, [bounce, rest]);
    expect(start).toEqual(snapshot);
    expect(ZERO_COUNTS).toEqual({ bounce: 0, cup: 0, rest: 0, holed: 0 });
    expect(next).not.toBe(start);
  });
});
