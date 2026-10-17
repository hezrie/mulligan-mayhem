/**
 * Worker bookkeeping around the LLM step: what to label and comment when a ticket is picked up,
 * and what the run's outcome is afterwards (PR, plan, escalation or failure, plus attempt
 * bumps). Pure decision functions; the workflow CLI performs the resulting actions. PROTECTED.
 */
import {
  ATTEMPT_PREFIX,
  PHYSICS_CHANGE,
  PLAN,
  PRIORITIES,
  SIZES,
  STATUS,
  TYPES,
} from './labels.ts';
import type { PickMode } from './pick-next.ts';
import { attemptOf } from './tickets.ts';

export interface LabelChange {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/^\[(ticket|idea)\]\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'ticket';
}

export interface WorkerStartPlan {
  readonly attempt: number;
  readonly branch: string;
  readonly allowGolden: boolean;
  readonly labels: LabelChange;
  readonly comment: string;
}

export function planWorkerStart(input: {
  readonly issue: number;
  readonly title: string;
  readonly labels: readonly string[];
  readonly mode: PickMode;
  readonly prHeadRef: string | null;
  readonly maxAttempts: number;
  readonly runUrl: string;
}): WorkerStartPlan {
  const current = attemptOf(input.labels);
  const attempt = Math.max(current, 1);
  const branch =
    input.mode === 'fix' && input.prHeadRef
      ? input.prHeadRef
      : `agent/${String(input.issue)}-${slugify(input.title)}${attempt > 1 ? `-a${String(attempt)}` : ''}`;
  const add = [STATUS.inProgress, ...(current === 0 ? [`${ATTEMPT_PREFIX}1`] : [])];
  const remove = [STATUS.ready, STATUS.inReview].filter((l) => input.labels.includes(l));
  const what = {
    implement: 'implementing',
    plan: 'writing a plan for',
    fix: 'addressing review feedback on',
  }[input.mode];
  return {
    attempt,
    branch,
    allowGolden: input.labels.includes(PHYSICS_CHANGE),
    labels: { add, remove },
    comment: `🤖 picked up: ${what} this ticket (attempt ${String(attempt)}/${String(input.maxAttempts)}). [Run log](${input.runUrl})`,
  };
}

export type WorkerOutcome = 'escalated' | 'plan-posted' | 'pr-opened' | 'fix-pushed' | 'failed';

export interface WorkerFinishInput {
  readonly mode: PickMode;
  readonly escalated: boolean;
  readonly planText: string | null;
  readonly hasChanges: boolean;
  readonly checkPassed: boolean;
  /** e.g. 'error_max_turns' from the execution summary, or null. */
  readonly claudeSubtype: string | null;
}

export function decideWorkerOutcome(input: WorkerFinishInput): {
  outcome: WorkerOutcome;
  reason: string;
} {
  if (input.escalated) return { outcome: 'escalated', reason: 'the worker escalated' };
  if (input.mode === 'plan') {
    return (input.planText?.trim().length ?? 0) >= 80
      ? { outcome: 'plan-posted', reason: 'plan written' }
      : { outcome: 'failed', reason: 'no plan was written to .agent/out/plan.md' };
  }
  if (!input.hasChanges) {
    const why = input.claudeSubtype === 'error_max_turns' ? ' (hit the turn limit)' : '';
    return { outcome: 'failed', reason: `no code changes were committed${why}` };
  }
  if (!input.checkPassed) {
    return { outcome: 'failed', reason: '`npm run check` had not passed on the final files' };
  }
  return input.mode === 'fix'
    ? { outcome: 'fix-pushed', reason: 'review feedback addressed' }
    : { outcome: 'pr-opened', reason: 'implementation ready for review' };
}

/** What happens to the ticket's labels after a failed attempt (or a changes-requested round). */
export function planAttemptBump(input: {
  readonly labels: readonly string[];
  readonly maxAttempts: number;
  readonly backToStatus: string;
}): { exhausted: boolean; labels: LabelChange; nextAttempt: number } {
  const attempt = Math.max(attemptOf(input.labels), 1);
  const statuses = [STATUS.inProgress, STATUS.ready, STATUS.inReview].filter((l) =>
    input.labels.includes(l),
  );
  const currentAttemptLabels = input.labels.filter((l) => l.startsWith(ATTEMPT_PREFIX));
  if (attempt >= input.maxAttempts) {
    return {
      exhausted: true,
      nextAttempt: attempt,
      labels: { add: [STATUS.needsHuman], remove: statuses },
    };
  }
  return {
    exhausted: false,
    nextAttempt: attempt + 1,
    labels: {
      add: [`${ATTEMPT_PREFIX}${String(attempt + 1)}`, input.backToStatus],
      remove: [...currentAttemptLabels, ...statuses.filter((s) => s !== input.backToStatus)],
    },
  };
}

/** Labels copied from the ticket to its PR (the merger reads size; agent-guard reads physics-change). */
export function prLabelsFromTicket(labels: readonly string[]): string[] {
  const copy = new Set<string>([...SIZES, ...TYPES, ...PRIORITIES, PHYSICS_CHANGE]);
  return labels.filter((l) => copy.has(l));
}

export const PLAN_MARKER = '<!-- mm:plan -->';

export function planComment(plan: string): string {
  return `${PLAN_MARKER}\n## 🤖 Implementation plan\n\n${plan.trim()}\n\n---\n_The reviewer agent will approve this plan (\`${PLAN.approved}\`) or request changes before any code is written._`;
}

/** Ensures the PR body closes the ticket and says who made it. */
export function finalizePrBody(body: string | null, issue: number, runUrl: string): string {
  const base = body?.trim()
    ? body.trim()
    : `Implements #${String(issue)}.\n\n⚠️ The worker did not write a PR description with the criterion → test mapping.`;
  const closes = new RegExp(`\\b(closes|fixes|resolves)\\s+#${String(issue)}\\b`, 'i').test(base)
    ? ''
    : `\n\nCloses #${String(issue)}`;
  return `${base}${closes}\n\n---\n🤖 Opened by the worker agent · [run](${runUrl}) · reviewed next by the reviewer agent`;
}
