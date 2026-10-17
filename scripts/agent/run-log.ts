/**
 * The agent run log: every agent run appends one JSON comment to the pinned
 * "🤖 Agent Run Log" issue (label meta:run-log). The picker reads it for the daily cap; the
 * weekly digest reads it for metrics. PROTECTED.
 */
import { z } from 'zod';

export const ROLES = ['refiner', 'worker', 'reviewer', 'merger', 'closer', 'digest'] as const;
export const MODES = [
  'plan',
  'implement',
  'fix',
  'refine',
  'review-plan',
  'review-pr',
  'merge',
  'close',
  'digest',
] as const;
export const OUTCOMES = [
  'pr-opened',
  'plan-posted',
  'fix-pushed',
  'escalated',
  'failed',
  'no-work',
  'approved',
  'changes-requested',
  'plan-approved',
  'plan-changes-requested',
  'merged',
  'ready-for-human',
  'refined',
  'split',
  'needs-human',
  'awaiting-triage',
  'closed',
  'digest-opened',
] as const;

export const RunLogEntrySchema = z.strictObject({
  v: z.literal(1),
  role: z.enum(ROLES),
  issue: z.int().nullable(),
  pr: z.int().nullable(),
  mode: z.enum(MODES).nullable(),
  outcome: z.enum(OUTCOMES),
  attempt: z.int().min(0).nullable(),
  turns: z.int().min(0).nullable(),
  durationSec: z.number().min(0).nullable(),
  costUsd: z.number().min(0).nullable(),
  startedAt: z.iso.datetime(),
  runUrl: z.string().nullable(),
  note: z.string().max(500).nullable(),
});

export type RunLogEntry = z.infer<typeof RunLogEntrySchema>;

const FENCE = /```json\n([\s\S]*?)\n```/;

export function formatRunLogComment(entry: RunLogEntry): string {
  return `\`\`\`json\n${JSON.stringify(RunLogEntrySchema.parse(entry))}\n\`\`\``;
}

/** Parses run-log comments; anything that isn't a valid entry (e.g. a human note) is skipped. */
export function parseRunLog(commentBodies: readonly string[]): RunLogEntry[] {
  return commentBodies.flatMap((body) => {
    const match = FENCE.exec(body);
    if (!match?.[1]) return [];
    try {
      const result = RunLogEntrySchema.safeParse(JSON.parse(match[1]));
      return result.success ? [result.data] : [];
    } catch {
      return [];
    }
  });
}

export function sameUtcDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

/** Worker runs today (UTC) that started a ticket (planning or implementing; fix passes don't count). */
export function ticketsStartedOn(entries: readonly RunLogEntry[], day: Date): number {
  return entries.filter(
    (e) =>
      e.role === 'worker' &&
      (e.mode === 'plan' || e.mode === 'implement') &&
      e.outcome !== 'no-work' &&
      sameUtcDay(new Date(e.startedAt), day),
  ).length;
}
