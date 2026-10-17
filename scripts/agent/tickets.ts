/** Pure helpers for reading ticket metadata from labels and bodies. PROTECTED. */
import { ATTEMPT_PREFIX, PRIORITIES, SIZES, STATUS_LABELS, type StatusLabel } from './labels.ts';

export type Size = 'S' | 'M';

/** Issue numbers listed as `Blocked by #N` anywhere in the body (case-insensitive, deduplicated). */
export function blockers(body: string): number[] {
  const found = [...body.matchAll(/blocked\s+by\s+#(\d+)/gi)].map((m) => Number(m[1]));
  return [...new Set(found)].sort((a, b) => a - b);
}

export function statusOf(labels: readonly string[]): StatusLabel | null {
  return STATUS_LABELS.find((s) => labels.includes(s)) ?? null;
}

export function sizeOf(labels: readonly string[]): Size | null {
  const label = SIZES.find((s) => labels.includes(s));
  return label ? (label.slice('size:'.length) as Size) : null;
}

/** 0 for P0 … 3 for P3; tickets without a priority sort last. */
export function priorityRank(labels: readonly string[]): number {
  const index = PRIORITIES.findIndex((p) => labels.includes(p));
  return index === -1 ? PRIORITIES.length : index;
}

/** Current attempt number from `agent:attempt-N` labels (highest wins), or 0 if never attempted. */
export function attemptOf(labels: readonly string[]): number {
  return labels
    .filter((l) => l.startsWith(ATTEMPT_PREFIX))
    .map((l) => Number(l.slice(ATTEMPT_PREFIX.length)))
    .filter(Number.isInteger)
    .reduce((max, n) => Math.max(max, n), 0);
}
