/**
 * Weekly digest: metrics from the run log plus a rule-based autonomy recommendation. The rules
 * are explicit so the owner can audit them; the digest only RECOMMENDS. Changing
 * autonomyLevel is a PR to agent.config.json that the owner merges. PROTECTED.
 */
import type { RunLogEntry } from './run-log.ts';

const DAY_MS = 86_400_000;
const TROUBLE = new Set([
  'failed',
  'changes-requested',
  'plan-changes-requested',
  'escalated',
  'needs-human',
]);

export interface ShippedTicket {
  readonly issue: number;
  readonly pr: number | null;
  readonly size: 'S' | 'M' | null;
  readonly closedAt: string;
  /** No failed attempt, no changes requested, no escalation for this issue. */
  readonly firstPass: boolean;
}

export function within(entries: readonly RunLogEntry[], now: Date, days: number): RunLogEntry[] {
  const since = now.getTime() - days * DAY_MS;
  return entries.filter((e) => new Date(e.startedAt).getTime() > since);
}

/** Tickets the closer recorded as shipped (closed by a merged agent PR), newest first. */
export function shippedTickets(entries: readonly RunLogEntry[]): ShippedTicket[] {
  const troubled = new Set(
    entries.filter((e) => e.issue !== null && TROUBLE.has(e.outcome)).map((e) => e.issue),
  );
  return entries
    .filter(
      (e) => e.role === 'closer' && e.outcome === 'closed' && e.issue !== null && e.pr !== null,
    )
    .map((e) => ({
      issue: e.issue ?? 0,
      pr: e.pr,
      size: e.size,
      closedAt: e.startedAt,
      firstPass: !troubled.has(e.issue),
    }))
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt))
    .filter((t, i, all) => all.findIndex((o) => o.issue === t.issue) === i); // reopened + re-closed counts once
}

export interface WeeklyMetrics {
  readonly ticketsDone: number;
  readonly firstPassRate: number | null;
  readonly ticketsStarted: number;
  readonly needsHumanRate: number | null;
  readonly reverts: number;
  readonly runs: number;
  readonly avgTurns: number | null;
  readonly avgCostUsd: number | null;
  readonly totalCostUsd: number;
  readonly byRole: Readonly<
    Record<string, { runs: number; avgTurns: number | null; costUsd: number }>
  >;
}

const avg = (xs: readonly number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (x: number | null, d = 2): number | null =>
  x === null ? null : Math.round(x * 10 ** d) / 10 ** d;

export function weeklyMetrics(
  all: readonly RunLogEntry[],
  now: Date,
  reverts: number,
): WeeklyMetrics {
  const week = within(all, now, 7);
  const weekStart = now.getTime() - 7 * DAY_MS;
  // First-pass status looks at the ticket's whole history, not just this week's entries.
  const shipped = shippedTickets(all).filter((t) => new Date(t.closedAt).getTime() > weekStart);
  const started = new Set(
    week
      .filter(
        (e) =>
          e.role === 'worker' &&
          (e.mode === 'plan' || e.mode === 'implement') &&
          e.outcome !== 'no-work',
      )
      .map((e) => e.issue),
  );
  const escalated = new Set(
    week
      .filter((e) => e.outcome === 'escalated' || e.outcome === 'needs-human')
      .map((e) => e.issue),
  );
  const costed = week.filter((e) => e.costUsd !== null);
  const byRole: Record<string, { runs: number; avgTurns: number | null; costUsd: number }> = {};
  for (const role of new Set(week.map((e) => e.role))) {
    const mine = week.filter((e) => e.role === role);
    byRole[role] = {
      runs: mine.length,
      avgTurns: round(avg(mine.flatMap((e) => (e.turns === null ? [] : [e.turns]))), 1),
      costUsd: round(mine.reduce((s, e) => s + (e.costUsd ?? 0), 0)) ?? 0,
    };
  }
  return {
    ticketsDone: shipped.length,
    firstPassRate: shipped.length
      ? round(shipped.filter((t) => t.firstPass).length / shipped.length)
      : null,
    ticketsStarted: started.size,
    needsHumanRate: started.size
      ? round([...escalated].filter((i) => started.has(i)).length / started.size)
      : null,
    reverts,
    runs: week.length,
    avgTurns: round(avg(week.flatMap((e) => (e.turns === null ? [] : [e.turns]))), 1),
    avgCostUsd: round(avg(costed.map((e) => e.costUsd ?? 0))),
    totalCostUsd: round(costed.reduce((s, e) => s + (e.costUsd ?? 0), 0)) ?? 0,
    byRole,
  };
}

export interface AutonomyInput {
  readonly level: 1 | 2 | 3;
  readonly entries: readonly RunLogEntry[];
  readonly now: Date;
  /** Reverts of agent PRs on main in the last 14 days. */
  readonly reverts14d: number;
  /** PR numbers where someone other than the bot pushed commits before merge. */
  readonly humanEditedPrs: ReadonlySet<number>;
  /** PRs whose commit authors were actually checked; any other PR never counts as clean. */
  readonly checkedPrs?: ReadonlySet<number>;
}

/** The S and M windows recommendAutonomy judges: exactly the PRs whose authors must be checked. */
export function prsToCheck(entries: readonly RunLogEntry[]): number[] {
  const shipped = shippedTickets(entries);
  return [
    ...shipped.filter((t) => t.size === 'S').slice(0, 15),
    ...shipped.filter((t) => t.size === 'M').slice(0, 6),
  ].flatMap((t) => (t.pr === null ? [] : [t.pr]));
}

export interface AutonomyRecommendation {
  readonly action: 'raise' | 'keep' | 'lower';
  readonly to: 1 | 2 | 3;
  readonly reasons: readonly string[];
}

/**
 * Raise 1→2: ≥ 8 of the last 10 shipped S tickets first-pass with no human edits, no reverts in
 * 14 days, needs-human ≤ 20% over 14 days.
 * Raise 2→3: additionally ≥ 15 S tickets shipped since level 2 began (approximated by the last
 * 15), and ≥ 5 of the last 6 shipped M tickets first-pass with no human edits.
 * Lower one level: any revert in 14 days, or needs-human > 40% over 14 days.
 */
export function recommendAutonomy(input: AutonomyInput): AutonomyRecommendation {
  const recent = within(input.entries, input.now, 14);
  const started = new Set(
    recent
      .filter((e) => e.role === 'worker' && (e.mode === 'plan' || e.mode === 'implement'))
      .map((e) => e.issue),
  );
  const escalated = new Set(
    recent
      .filter((e) => e.outcome === 'escalated' || e.outcome === 'needs-human')
      .map((e) => e.issue),
  );
  const needsHuman = started.size
    ? [...escalated].filter((i) => started.has(i)).length / started.size
    : 0;
  const clean = (t: ShippedTicket): boolean =>
    t.firstPass &&
    (t.pr === null || ((input.checkedPrs?.has(t.pr) ?? true) && !input.humanEditedPrs.has(t.pr)));
  const shipped = shippedTickets(input.entries);
  const s = shipped.filter((t) => t.size === 'S');
  const m = shipped.filter((t) => t.size === 'M');
  const pct = (x: number): string => `${String(Math.round(x * 100))}%`;

  if (input.level > 1 && (input.reverts14d > 0 || needsHuman > 0.4)) {
    return {
      action: 'lower',
      to: (input.level - 1) as 1 | 2,
      reasons: [
        ...(input.reverts14d > 0
          ? [`${String(input.reverts14d)} revert(s) in the last 14 days`]
          : []),
        ...(needsHuman > 0.4 ? [`needs-human rate ${pct(needsHuman)} (> 40%)`] : []),
      ],
    };
  }

  const lastTenS = s.slice(0, 10);
  const sOk = lastTenS.length >= 10 && lastTenS.filter(clean).length >= 8;
  const stable = input.reverts14d === 0 && needsHuman <= 0.2;
  const status = [
    `last 10 S tickets: ${String(lastTenS.filter(clean).length)}/${String(lastTenS.length)} first-pass without human edits (need ≥ 8 of 10)`,
    `reverts (14d): ${String(input.reverts14d)} (need 0)`,
    `needs-human (14d): ${pct(needsHuman)} (need ≤ 20%)`,
  ];
  if (input.level === 1) {
    return sOk && stable
      ? { action: 'raise', to: 2, reasons: status }
      : { action: 'keep', to: 1, reasons: status };
  }
  if (input.level === 2) {
    const lastSixM = m.slice(0, 6);
    const mOk = lastSixM.length >= 6 && lastSixM.filter(clean).length >= 5;
    const enoughS =
      s.slice(0, 15).length >= 15 &&
      s.slice(0, 15).every((t) => !t.pr || !input.humanEditedPrs.has(t.pr));
    const status3 = [
      ...status,
      `S tickets shipped: ${String(Math.min(s.length, 15))}/15 clean`,
      `last 6 M tickets: ${String(lastSixM.filter(clean).length)}/${String(lastSixM.length)} first-pass (need ≥ 5 of 6)`,
    ];
    return sOk && stable && mOk && enoughS
      ? { action: 'raise', to: 3, reasons: status3 }
      : { action: 'keep', to: 2, reasons: status3 };
  }
  return { action: 'keep', to: 3, reasons: status };
}

const fmtPct = (x: number | null): string =>
  x === null ? 'n/a' : `${String(Math.round(x * 100))}%`;
const fmtUsd = (x: number | null): string => (x === null ? 'n/a' : `$${x.toFixed(2)}`);

export function digestBody(
  m: WeeklyMetrics,
  rec: AutonomyRecommendation,
  level: number,
  weekOf: string,
): string {
  const roles = Object.entries(m.byRole)
    .map(
      ([role, r]) =>
        `| ${role} | ${String(r.runs)} | ${r.avgTurns === null ? 'n/a' : String(r.avgTurns)} | ${fmtUsd(r.costUsd)} |`,
    )
    .join('\n');
  const arrow = { raise: '⬆️ raise', keep: '⏸️ keep', lower: '⬇️ lower' }[rec.action];
  return `## 🤖 Weekly agent digest: week of ${weekOf}

| Metric | Value |
|---|---|
| Tickets done | ${String(m.ticketsDone)} |
| First-pass success | ${fmtPct(m.firstPassRate)} |
| Tickets started | ${String(m.ticketsStarted)} |
| Needs-human rate | ${fmtPct(m.needsHumanRate)} |
| Reverts on main | ${String(m.reverts)} |
| Agent runs | ${String(m.runs)} |
| Avg turns / run | ${m.avgTurns === null ? 'n/a' : String(m.avgTurns)} |
| Avg cost / run | ${fmtUsd(m.avgCostUsd)} |
| Total cost | ${fmtUsd(m.totalCostUsd)} |

${roles ? `| Role | Runs | Avg turns | Cost |\n|---|---|---|---|\n${roles}\n` : '_No agent runs this week._\n'}
### Autonomy: currently level ${String(level)} → recommendation: **${arrow}${rec.action === 'keep' ? '' : ` to level ${String(rec.to)}`}**

${rec.reasons.map((r) => `- ${r}`).join('\n')}

${rec.action === 'keep' ? '' : `To apply it, change \`autonomyLevel\` in \`agent.config.json\` in a PR (it's a protected file, so you merge it).\n`}
A PR proposing CLAUDE.md / LESSONS.md updates from recurring failures follows if there's anything to learn.`;
}
