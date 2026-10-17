import { z } from 'zod';
import type { Hole } from '../course/schema.ts';
import { hashState } from '../hash.ts';
import { GameSession } from './session.ts';
import type { Shot } from './shot.ts';

/** Shape of a golden replay file in tests/replays/. `expected` is filled by `npm run replay:record`. */
export const ReplayFileSchema = z.strictObject({
  description: z.string().min(1),
  holeId: z.string().min(1),
  seed: z.int(),
  shots: z.array(z.strictObject({ angle: z.number(), power: z.number() })).min(1),
  expected: z
    .strictObject({
      strokes: z.int().min(1),
      holed: z.boolean(),
      finalStateHash: z.string().regex(/^[0-9a-f]{16}$/),
    })
    .optional(),
});

export type ReplayFile = z.infer<typeof ReplayFileSchema>;

export interface ReplayResult {
  readonly strokes: number;
  readonly holed: boolean;
  readonly finalStateHash: string;
}

export class ReplayError extends Error {
  override readonly name = 'ReplayError';
}

/**
 * Plays shots exactly as the golden-replay runner, the recorder and the e2e test do: each shot
 * is taken the moment the ball is at rest, then simulated until it stops again.
 */
export function playReplay(hole: Hole, seed: number, shots: readonly Shot[]): ReplayResult {
  const session = new GameSession(hole, seed);
  shots.forEach((shot, index) => {
    if (session.state.phase === 'holed') {
      throw new ReplayError(`shot ${String(index + 1)} was taken after the ball was holed`);
    }
    session.shoot(shot);
    session.runUntilRest();
  });
  const { strokes, phase } = session.state;
  return { strokes, holed: phase === 'holed', finalStateHash: hashState(session.state) };
}
