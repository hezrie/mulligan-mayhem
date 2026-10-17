import { describe, expect, it } from 'vitest';
import {
  formatRunLogComment,
  parseRunLog,
  ticketsStartedOn,
  type RunLogEntry,
} from '../../scripts/agent/run-log.ts';

const entry: RunLogEntry = {
  v: 1,
  role: 'worker',
  issue: 12,
  pr: 30,
  mode: 'implement',
  size: 'S',
  outcome: 'pr-opened',
  attempt: 1,
  turns: 42,
  durationSec: 913.5,
  costUsd: 1.23,
  startedAt: '2026-10-20T10:00:00.000Z',
  runUrl: 'https://github.com/hezrie/mulligan-mayhem/actions/runs/1',
  note: null,
};

describe('run log', () => {
  it('round-trips entries through comment bodies', () => {
    const body = formatRunLogComment(entry);
    expect(body.startsWith('```json\n')).toBe(true);
    expect(parseRunLog([body])).toEqual([entry]);
  });

  it('skips human comments and malformed or invalid entries', () => {
    const bodies = [
      'Pinned: this issue collects one JSON line per agent run.',
      '```json\n{not json}\n```',
      '```json\n{"v":2,"role":"worker"}\n```',
      formatRunLogComment(entry),
    ];
    expect(parseRunLog(bodies)).toEqual([entry]);
  });

  it('refuses to format an invalid entry', () => {
    expect(() =>
      formatRunLogComment({ ...entry, outcome: 'yolo' as RunLogEntry['outcome'] }),
    ).toThrow();
  });

  it('counts tickets started on a UTC day', () => {
    const day = new Date('2026-10-20T23:00:00Z');
    const entries = [
      entry,
      { ...entry, mode: 'plan' as const },
      { ...entry, mode: 'fix' as const },
      { ...entry, outcome: 'no-work' as const },
      { ...entry, role: 'reviewer' as const },
      { ...entry, startedAt: '2026-10-19T23:59:59.000Z' },
    ];
    expect(ticketsStartedOn(entries, day)).toBe(2);
  });
});
