import { describe, expect, it } from 'vitest';
import {
  digestBody,
  prsToCheck,
  recommendAutonomy,
  shippedTickets,
  weeklyMetrics,
  type AutonomyInput,
} from '../../scripts/agent/digest.ts';
import { isRevertCommit } from '../../scripts/agent/github-pr.ts';
import type { RunLogEntry } from '../../scripts/agent/run-log.ts';

const NOW = new Date('2026-10-26T07:00:00Z');
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function e(partial: Partial<RunLogEntry>): RunLogEntry {
  return {
    v: 1,
    role: 'worker',
    issue: 1,
    pr: null,
    mode: 'implement',
    size: 'S',
    outcome: 'pr-opened',
    attempt: 1,
    turns: 20,
    durationSec: 300,
    costUsd: 1,
    startedAt: daysAgo(1),
    runUrl: null,
    note: null,
    ...partial,
  };
}

/** A ticket's whole lifecycle: started, PR, approved, merged, closed. */
function lifecycle(
  issue: number,
  opts: { size?: 'S' | 'M'; trouble?: RunLogEntry['outcome']; day?: number } = {},
): RunLogEntry[] {
  const day = opts.day ?? 1;
  const size = opts.size ?? 'S';
  return [
    e({ issue, size, startedAt: daysAgo(day + 0.5) }),
    ...(opts.trouble
      ? [
          e({
            issue,
            size,
            role: 'reviewer',
            mode: 'review-pr',
            outcome: opts.trouble,
            startedAt: daysAgo(day + 0.4),
          }),
        ]
      : []),
    e({
      issue,
      size,
      role: 'reviewer',
      mode: 'review-pr',
      outcome: 'approved',
      costUsd: 0.5,
      startedAt: daysAgo(day + 0.3),
    }),
    e({
      issue,
      size,
      pr: 100 + issue,
      role: 'closer',
      mode: 'close',
      outcome: 'closed',
      turns: null,
      costUsd: null,
      startedAt: daysAgo(day),
    }),
  ];
}

describe('weekly metrics', () => {
  it('computes done, first-pass, needs-human, turns and cost for the last 7 days', () => {
    const entries = [
      ...lifecycle(1),
      ...lifecycle(2, { trouble: 'changes-requested' }),
      e({ issue: 3, startedAt: daysAgo(2) }),
      e({ issue: 3, outcome: 'escalated', startedAt: daysAgo(2) }),
      ...lifecycle(9, { day: 10 }), // outside the week
    ];
    const m = weeklyMetrics(entries, NOW, 1);
    expect(m.ticketsDone).toBe(2);
    expect(m.firstPassRate).toBe(0.5);
    expect(m.ticketsStarted).toBe(3);
    expect(m.needsHumanRate).toBe(0.33);
    expect(m.reverts).toBe(1);
    expect(m.byRole['closer']?.runs).toBe(2);
    expect(m.totalCostUsd).toBe(6); // 1.5 + 2.5 (incl. the changes-requested review) + 2
  });

  it('judges first-pass on the ticket’s whole history, not just this week', () => {
    const entries = [
      e({ issue: 7, role: 'reviewer', outcome: 'changes-requested', startedAt: daysAgo(9) }),
      e({
        issue: 7,
        pr: 107,
        role: 'closer',
        mode: 'close',
        outcome: 'closed',
        startedAt: daysAgo(1),
      }),
    ];
    expect(weeklyMetrics(entries, NOW, 0)).toMatchObject({ ticketsDone: 1, firstPassRate: 0 });
  });

  it('handles an empty week', () => {
    const m = weeklyMetrics([], NOW, 0);
    expect(m).toMatchObject({
      ticketsDone: 0,
      firstPassRate: null,
      needsHumanRate: null,
      avgCostUsd: null,
    });
    expect(digestBody(m, { action: 'keep', to: 1, reasons: [] }, 1, '2026-10-19')).toContain(
      '_No agent runs this week._',
    );
  });

  it('lists shipped tickets newest first with first-pass flags', () => {
    const shipped = shippedTickets([
      ...lifecycle(1, { day: 3 }),
      ...lifecycle(2, { day: 1, trouble: 'failed' }),
    ]);
    expect(shipped.map((t) => [t.issue, t.firstPass])).toEqual([
      [2, false],
      [1, true],
    ]);
  });

  it('counts a ticket that was reopened and closed again only once', () => {
    const entries = [
      ...lifecycle(1, { day: 3 }),
      ...lifecycle(2, { day: 2 }),
      e({
        issue: 1,
        role: 'closer',
        mode: 'close',
        outcome: 'closed',
        pr: 101,
        startedAt: daysAgo(1),
      }),
    ];
    expect(shippedTickets(entries).map((t) => t.issue)).toEqual([1, 2]);
  });
});

describe('autonomy recommendation', () => {
  const tenS = (troubled: number): RunLogEntry[] =>
    Array.from({ length: 10 }, (_, i) =>
      lifecycle(i + 1, {
        day: 1 + i * 0.1,
        ...(i < troubled ? { trouble: 'changes-requested' as const } : {}),
      }),
    ).flat();
  const base = (entries: RunLogEntry[], over: Partial<AutonomyInput> = {}): AutonomyInput => ({
    level: 1,
    entries,
    now: NOW,
    reverts14d: 0,
    humanEditedPrs: new Set(),
    ...over,
  });

  it('recommends raising 1 → 2 after 8 of the last 10 S tickets passed first time, cleanly', () => {
    expect(recommendAutonomy(base(tenS(2)))).toMatchObject({ action: 'raise', to: 2 });
  });

  it('keeps level 1 with too few clean tickets, human edits, or any revert', () => {
    expect(recommendAutonomy(base(tenS(3))).action).toBe('keep');
    expect(
      recommendAutonomy(base(tenS(0), { humanEditedPrs: new Set([101, 102, 103]) })).action,
    ).toBe('keep');
    expect(recommendAutonomy(base(tenS(0), { reverts14d: 1 })).action).toBe('keep');
    expect(recommendAutonomy(base(tenS(0).slice(0, 20))).action).toBe('keep'); // only 5 tickets
  });

  it('recommends lowering after a revert or a needs-human spike', () => {
    expect(recommendAutonomy(base(tenS(0), { level: 2, reverts14d: 1 }))).toMatchObject({
      action: 'lower',
      to: 1,
    });
    const spiky = [
      ...tenS(0),
      ...[50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60].flatMap((i) => [
        e({ issue: i }),
        e({ issue: i, outcome: 'escalated' }),
      ]),
    ];
    expect(recommendAutonomy(base(spiky, { level: 3 }))).toMatchObject({ action: 'lower', to: 2 });
  });

  it('never counts a PR as clean unless its commit authors were actually checked', () => {
    const entries = tenS(0);
    const toCheck = prsToCheck(entries);
    expect(toCheck).toHaveLength(10);
    expect(recommendAutonomy(base(entries, { checkedPrs: new Set(toCheck) })).action).toBe('raise');
    expect(
      recommendAutonomy(base(entries, { checkedPrs: new Set(toCheck.slice(0, 7)) })).action,
    ).toBe('keep');
  });

  it('recognizes reverts in every common style (they gate autonomy)', () => {
    expect(isRevertCommit('Revert "feat: sand (#12)"')).toBe(true);
    expect(isRevertCommit('revert: feat(physics): add sand friction (#12)')).toBe(true);
    expect(isRevertCommit('fix: undo sand\n\nThis reverts commit abc1234.')).toBe(true);
    expect(isRevertCommit('feat: reverting ball spin is now possible')).toBe(false);
  });

  it('requires M-ticket evidence and 15 clean S tickets to go 2 → 3', () => {
    const fifteenS = Array.from({ length: 15 }, (_, i) =>
      lifecycle(i + 1, { day: 1 + i * 0.05 }),
    ).flat();
    expect(recommendAutonomy(base(fifteenS, { level: 2 })).action).toBe('keep');
    const sixM = Array.from({ length: 6 }, (_, i) =>
      lifecycle(100 + i, { size: 'M', day: 2 + i * 0.05 }),
    ).flat();
    expect(recommendAutonomy(base([...fifteenS, ...sixM], { level: 2 }))).toMatchObject({
      action: 'raise',
      to: 3,
    });
  });

  it('renders the recommendation with the reasons', () => {
    const body = digestBody(
      weeklyMetrics(tenS(2), NOW, 0),
      recommendAutonomy(base(tenS(2))),
      1,
      '2026-10-19',
    );
    expect(body).toContain('recommendation: **⬆️ raise to level 2**');
    expect(body).toContain('8/10 first-pass');
  });
});
