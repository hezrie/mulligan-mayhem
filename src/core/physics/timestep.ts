import { DT, MAX_FRAME_SECONDS } from './constants.ts';

export interface ClockAdvance {
  readonly steps: number;
  readonly accumulator: number;
}

/**
 * Fixed-timestep accumulator: converts real elapsed time into a whole number of DT steps and
 * carries the remainder. Long frames are clamped so a returning background tab can't stall.
 */
export function advanceClock(accumulator: number, frameSeconds: number): ClockAdvance {
  const total = accumulator + Math.min(Math.max(frameSeconds, 0), MAX_FRAME_SECONDS);
  const steps = Math.floor(total / DT);
  return { steps, accumulator: total - steps * DT };
}
