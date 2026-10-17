/**
 * The picker: decides deterministically (no LLM) what the worker does next.
 *
 *  1. Finish before starting: an agent PR with "changes requested" gets a fix pass.
 *  2. Respect the WIP limit (tickets in progress or in review) and the daily start cap.
 *  3. Then M tickets with an approved plan that aren't implemented yet,
 *  4. then `status:ready` tickets by priority (P0 first), then oldest first.
 *  5. Skip anything whose "Blocked by #N" issues are still open.
 *
 *   npx tsx scripts/agent/pick-next.ts [--issue N]   → prints a JSON PickResult
 *
 * PROTECTED: agents may not edit this file.
 */
import { pathToFileURL } from 'node:url';
import type { AgentConfig } from './config.ts';
import { PLAN, STATUS } from './labels.ts';
import { parseRunLog, ticketsStartedOn, type RunLogEntry } from './run-log.ts';
import { blockers, priorityRank, sizeOf, statusOf } from './tickets.ts';
import type { PullRequest, Ticket, Tracker } from './tracker/types.ts';

export type PickMode = 'implement' | 'plan' | 'fix';

export type PickResult =
  | {
      readonly issue: number;
      readonly mode: PickMode;
      readonly pr: number | null;
      readonly reason: string;
    }
  | { readonly issue: null; readonly mode: null; readonly pr: null; readonly reason: string };

export interface Snapshot {
  readonly tickets: readonly Ticket[];
  readonly pullRequests: readonly PullRequest[];
  /** State of every issue referenced by "Blocked by #N" in a ready ticket. Unknown = open. */
  readonly issueStates: ReadonlyMap<number, 'open' | 'closed'>;
  readonly runLog: readonly RunLogEntry[];
}

export type PickerConfig = Pick<AgentConfig, 'wipLimit' | 'maxTicketsStartedPerDay'>;

const nothing = (reason: string): PickResult => ({ issue: null, mode: null, pr: null, reason });

/** The ticket an agent PR belongs to: "Closes #N", else the agent/<N>-slug branch name. */
export function ticketOfPr(pr: PullRequest): number | null {
  if (pr.closesIssues[0] !== undefined) return pr.closesIssues[0];
  const match = /^agent\/(\d+)-/.exec(pr.headRef);
  return match ? Number(match[1]) : null;
}

function openBlockers(ticket: Ticket, states: Snapshot['issueStates']): number[] {
  return blockers(ticket.body).filter((n) => states.get(n) !== 'closed');
}

function modeFor(ticket: Ticket): PickMode {
  return sizeOf(ticket.labels) === 'M' && !ticket.labels.includes(PLAN.approved)
    ? 'plan'
    : 'implement';
}

function fixCandidate(s: Snapshot): { ticket: Ticket; pr: PullRequest } | null {
  const byNumber = new Map(s.tickets.map((t) => [t.number, t]));
  for (const pr of [...s.pullRequests].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!pr.headRef.startsWith('agent/') || pr.isDraft || pr.reviewDecision !== 'CHANGES_REQUESTED')
      continue;
    const n = ticketOfPr(pr);
    const ticket = n === null ? undefined : byNumber.get(n);
    if (ticket && statusOf(ticket.labels) !== STATUS.needsHuman) return { ticket, pr };
  }
  return null;
}

/** Why a ticket can't be started right now, or null if it can. */
function ineligibility(ticket: Ticket, s: Snapshot): string | null {
  if (ticket.state !== 'open') return 'closed';
  if (statusOf(ticket.labels) !== STATUS.ready)
    return `status is ${statusOf(ticket.labels) ?? 'missing'}`;
  if (ticket.labels.includes(PLAN.proposed)) return 'plan awaiting review';
  if (sizeOf(ticket.labels) === null) return 'no size:S/size:M label (not ready)';
  const open = openBlockers(ticket, s.issueStates);
  if (open.length > 0) return `blocked by ${open.map((n) => `#${String(n)}`).join(', ')}`;
  return null;
}

export function pickNext(s: Snapshot, config: PickerConfig, now: Date): PickResult {
  const fix = fixCandidate(s);
  if (fix) {
    return {
      issue: fix.ticket.number,
      mode: 'fix',
      pr: fix.pr.number,
      reason: `finish before starting: PR #${String(fix.pr.number)} has changes requested`,
    };
  }

  const inFlight = s.tickets.filter((t) => {
    const status = statusOf(t.labels);
    return status === STATUS.inProgress || status === STATUS.inReview;
  });
  if (inFlight.length >= config.wipLimit) {
    const list = inFlight.map((t) => `#${String(t.number)}`).join(', ');
    return nothing(
      `WIP limit reached (${String(inFlight.length)}/${String(config.wipLimit)}): ${list}`,
    );
  }

  const started = ticketsStartedOn(s.runLog, now);
  if (started >= config.maxTicketsStartedPerDay) {
    return nothing(
      `daily cap reached: ${String(started)}/${String(config.maxTicketsStartedPerDay)} tickets started today (UTC)`,
    );
  }

  const candidates = s.tickets
    .filter((t) => ineligibility(t, s) === null)
    .sort((a, b) => {
      const approvedPlan = (t: Ticket): number =>
        sizeOf(t.labels) === 'M' && t.labels.includes(PLAN.approved) ? 0 : 1;
      return (
        approvedPlan(a) - approvedPlan(b) ||
        priorityRank(a.labels) - priorityRank(b.labels) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.number - b.number
      );
    });

  const next = candidates[0];
  if (!next) {
    const blocked = s.tickets
      .filter((t) => statusOf(t.labels) === STATUS.ready)
      .map((t) => `#${String(t.number)} ${ineligibility(t, s) ?? ''}`.trim());
    return nothing(
      blocked.length ? `nothing startable: ${blocked.join('; ')}` : 'no status:ready tickets',
    );
  }
  const mode = modeFor(next);
  return {
    issue: next.number,
    mode,
    pr: null,
    reason:
      mode === 'plan'
        ? 'size M without an approved plan: post a plan first'
        : 'next by priority, then age',
  };
}

/** Manual override (workflow_dispatch with an issue number): ignores ordering, WIP and the cap. */
export function pickSpecific(s: Snapshot, issue: number): PickResult {
  const fix = fixCandidate(s);
  if (fix?.ticket.number === issue) {
    return {
      issue,
      mode: 'fix',
      pr: fix.pr.number,
      reason: 'manual: fix pass on changes requested',
    };
  }
  const ticket = s.tickets.find((t) => t.number === issue);
  if (!ticket) return nothing(`#${String(issue)} is not an open ticket`);
  const why = ineligibility(ticket, s);
  if (why) return nothing(`#${String(issue)} can't be started: ${why}`);
  return {
    issue,
    mode: modeFor(ticket),
    pr: null,
    reason: 'manual dispatch (ordering, WIP and cap ignored)',
  };
}

export async function loadSnapshot(tracker: Tracker, runLogLabel: string): Promise<Snapshot> {
  const [tickets, pullRequests, logIssue] = await Promise.all([
    tracker.listOpenTickets(),
    tracker.listOpenPullRequests(),
    tracker.findOpenTicketByLabel(runLogLabel),
  ]);
  const referenced = tickets
    .filter((t) => statusOf(t.labels) === STATUS.ready)
    .flatMap((t) => blockers(t.body));
  const openNumbers = new Set(tickets.map((t) => t.number));
  const unknown = referenced.filter((n) => !openNumbers.has(n));
  const states = await tracker.issueStates(unknown);
  for (const n of openNumbers) states.set(n, 'open');
  const comments = logIssue ? await tracker.listComments(logIssue.number) : [];
  return {
    tickets,
    pullRequests,
    issueStates: states,
    runLog: parseRunLog(comments.map((c) => c.body)),
  };
}

async function main(): Promise<void> {
  const { loadAgentConfig } = await import('./config.ts');
  const { createTracker } = await import('./tracker/index.ts');
  const { META } = await import('./labels.ts');
  const args = process.argv.slice(2);
  const issueFlag = args.indexOf('--issue');
  const issueArg = issueFlag === -1 ? undefined : args[issueFlag + 1];
  const snapshot = await loadSnapshot(createTracker(), META.runLog);
  const pick =
    issueArg && Number(issueArg) > 0
      ? pickSpecific(snapshot, Number(issueArg))
      : pickNext(snapshot, loadAgentConfig(), new Date());
  console.log(JSON.stringify(pick));
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
