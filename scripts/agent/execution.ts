/**
 * Reads the claude-code-action `execution_file` (a JSON array of Claude Code SDK messages) and
 * extracts the run's turns, cost, duration and outcome for the run log. Tolerant: an unreadable
 * file yields nulls rather than failing the workflow's bookkeeping. PROTECTED.
 */
import { existsSync, readFileSync } from 'node:fs';

export interface ExecutionSummary {
  readonly turns: number | null;
  readonly costUsd: number | null;
  readonly durationSec: number | null;
  /** 'success', 'error_max_turns', 'error_during_execution', … or null if unknown. */
  readonly subtype: string | null;
  readonly isError: boolean;
}

const UNKNOWN: ExecutionSummary = {
  turns: null,
  costUsd: null,
  durationSec: null,
  subtype: null,
  isError: true,
};

interface ResultMessage {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  duration_ms?: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function summarizeExecution(messages: unknown): ExecutionSummary {
  if (!Array.isArray(messages)) return UNKNOWN;
  const result = [...(messages as ResultMessage[])].reverse().find((m) => m.type === 'result');
  if (!result) return UNKNOWN;
  const durationMs = num(result.duration_ms);
  return {
    turns: num(result.num_turns),
    costUsd: num(result.total_cost_usd),
    durationSec: durationMs === null ? null : Math.round(durationMs / 100) / 10,
    subtype: typeof result.subtype === 'string' ? result.subtype : null,
    isError: result.is_error === true || (result.subtype ?? 'success') !== 'success',
  };
}

export function readExecutionFile(path: string | undefined): ExecutionSummary {
  if (!path || !existsSync(path)) return UNKNOWN;
  try {
    return summarizeExecution(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return UNKNOWN;
  }
}
