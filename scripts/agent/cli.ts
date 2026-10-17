/**
 * The agent workflows' deterministic steps. Every GitHub side effect of the loop happens here,
 * never in an LLM step: labels, comments, pushes, PRs, reviews, merges. Each command reads its
 * inputs from flags/env, acts through injected dependencies (so it can be tested with fakes),
 * appends one run-log entry when something happened, and writes GitHub step outputs.
 *
 *   npx tsx scripts/agent/cli.ts <command> [--flag value ...]
 *
 * PROTECTED: agents may not edit this file.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findViolations, parseNameStatus } from './agent-guard.ts';
import {
  ARCH_REVIEW_TITLE,
  architectureReviewBody,
  closeSummary,
  labelsToStrip,
  shouldOpenArchitectureReview,
} from './close.ts';
import { loadAgentConfig, REPO_ROOT, type AgentConfig } from './config.ts';
import { digestBody, recommendAutonomy, shippedTickets, weeklyMetrics, within } from './digest.ts';
import { readExecutionFile } from './execution.ts';
import { GitHubPullRequests, type CheckRun, type PrInfo } from './github-pr.ts';
import { AGENT_APPROVED, META, PHYSICS_CHANGE, PLAN, SOURCE_AGENT, STATUS } from './labels.ts';
import { decideMerge, HUMAN_MERGE_MARKER, humanMergeComment } from './merge.ts';
import { loadSnapshot, pickNext, pickSpecific, type PickMode } from './pick-next.ts';
import type { FileChange } from './protected.ts';
import {
  AWAITING_TRIAGE_COMMENT,
  AWAITING_TRIAGE_MARKER,
  isTrusted,
  originalTextComment,
  planRefinement,
  RefinementSchema,
} from './refine.ts';
import {
  ciFailureVerdict,
  enforceConsistency,
  evaluateChecks,
  jsonSchemaFor,
  planReviewComment,
  PlanVerdictSchema,
  prReviewBody,
  PrVerdictSchema,
  type CiStatus,
} from './review.ts';
import { formatRunLogComment, parseRunLog, sameUtcDay, type RunLogEntry } from './run-log.ts';
import { renderTicketBody } from './ticket-format.ts';
import { attemptOf, sizeOf, statusOf } from './tickets.ts';
import { execGhClient, repoFromEnv } from './tracker/gh-client.ts';
import { GitHubTracker } from './tracker/github.ts';
import type { Ticket, Tracker } from './tracker/types.ts';
import {
  decideWorkerOutcome,
  finalizePrBody,
  PLAN_MARKER,
  planAttemptBump,
  planComment,
  planWorkerStart,
  prLabelsFromTicket,
  type LabelChange,
} from './worker.ts';

/** The pull-request operations the CLI needs (GitHubPullRequests implements it). */
export type PrHost = Pick<
  GitHubPullRequests,
  | 'get'
  | 'create'
  | 'files'
  | 'checkRuns'
  | 'reviews'
  | 'submitReview'
  | 'squashMerge'
  | 'closingPullRequest'
  | 'mergedAgentPrsSince'
  | 'commitAuthors'
  | 'revertsSince'
>;

export interface Git {
  run(args: readonly string[]): string;
}

export interface Ctx {
  readonly repo: string;
  readonly tracker: Tracker;
  /** Acts as the bot App (AGENT_BOT_TOKEN): labels, comments, pushes, PRs, merges. */
  readonly prs: PrHost;
  /** Acts as github-actions[bot] (GITHUB_TOKEN): submits reviews, so author ≠ reviewer. */
  readonly reviewPrs: PrHost;
  readonly config: AgentConfig;
  readonly root: string;
  readonly now: Date;
  readonly runUrl: string;
  readonly git: Git;
  readonly fingerprint: () => string;
  readonly permissionOf: (user: string) => Promise<string>;
  readonly push: (branch: string) => void;
  readonly output: (key: string, value: string) => void;
  readonly summary: (markdown: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

type Args = Readonly<Record<string, string | undefined>>;

// ---------- small helpers ----------

const outDir = (ctx: Ctx): string => join(ctx.root, '.agent', 'out');
const stateDir = (ctx: Ctx): string =>
  ctx.env['AGENT_STATE_DIR'] ?? join(ctx.root, '.agent', '.state');

function readOut(ctx: Ctx, name: string): string | null {
  const path = join(outDir(ctx), name);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function writeOut(ctx: Ctx, name: string, content: string): void {
  const path = join(outDir(ctx), name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function readState(ctx: Ctx, name: string): string | null {
  const path = join(stateDir(ctx), name);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
}

/** Parses a JSON env var (an LLM step's structured output); missing or malformed → null. */
function jsonEnv(ctx: Ctx, key: string): unknown {
  const raw = ctx.env[key];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function requireInt(args: Args, key: string): number {
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${key} must be a positive integer`);
  return value;
}

function optionalInt(args: Args, key: string): number | null {
  const raw = args[key];
  return raw && Number(raw) > 0 ? Number(raw) : null;
}

async function applyLabels(ctx: Ctx, number: number, change: LabelChange): Promise<void> {
  await ctx.tracker.addLabels(number, change.add);
  for (const label of change.remove) await ctx.tracker.removeLabel(number, label);
}

/** Moves a ticket to exactly one status label. */
async function setStatus(ctx: Ctx, ticket: Ticket, status: string): Promise<void> {
  const current = ticket.labels.filter((l) => (Object.values(STATUS) as string[]).includes(l));
  await applyLabels(ctx, ticket.number, {
    add: [status],
    remove: current.filter((l) => l !== status),
  });
}

async function appendRunLog(
  ctx: Ctx,
  partial: Partial<RunLogEntry> & Pick<RunLogEntry, 'role' | 'outcome'>,
): Promise<void> {
  const entry: RunLogEntry = {
    v: 1,
    issue: null,
    pr: null,
    mode: null,
    size: null,
    attempt: null,
    turns: null,
    durationSec: null,
    costUsd: null,
    startedAt: ctx.env['STARTED_AT'] ?? ctx.now.toISOString(),
    runUrl: ctx.runUrl,
    note: null,
    ...partial,
  };
  const log = await ctx.tracker.findOpenTicketByLabel(META.runLog);
  if (!log) {
    ctx.summary('⚠️ No run log issue found (label meta:run-log); run entry not recorded.');
    return;
  }
  await ctx.tracker.comment(log.number, formatRunLogComment(entry));
}

/** Turns, cost and duration of the LLM step, in exactly the shape the run log stores. */
function execStats(ctx: Ctx): Pick<RunLogEntry, 'turns' | 'costUsd' | 'durationSec'> {
  const e = readExecutionFile(ctx.env['EXECUTION_FILE']);
  return { turns: e.turns, costUsd: e.costUsd, durationSec: e.durationSec };
}

/** The ticket a PR belongs to: "Closes #N" in its body, else the agent/<N>-slug branch. */
export function ticketNumberOfPr(pr: Pick<PrInfo, 'body' | 'headRef'>): number | null {
  const closes = /\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body);
  if (closes?.[1]) return Number(closes[1]);
  const branch = /^agent\/(\d+)-/.exec(pr.headRef);
  return branch?.[1] ? Number(branch[1]) : null;
}

export function toFileChanges(
  files: readonly { filename: string; status: string; previous_filename?: string }[],
): FileChange[] {
  const letter: Record<string, string> = {
    added: 'A',
    modified: 'M',
    removed: 'D',
    changed: 'M',
    copied: 'A',
    unchanged: 'M',
  };
  return files.flatMap((f) =>
    f.status === 'renamed'
      ? [
          ...(f.previous_filename ? [{ path: f.previous_filename, status: 'D' }] : []),
          { path: f.filename, status: 'A' },
        ]
      : [{ path: f.filename, status: letter[f.status] ?? 'M' }],
  );
}

const CONVENTIONAL: Readonly<Record<string, string>> = {
  'type:feature': 'feat',
  'type:bug': 'fix',
  'type:chore': 'chore',
  'type:refactor': 'refactor',
  'type:test': 'test',
};

function prTitle(ticket: Ticket): string {
  const type = ticket.labels.map((l) => CONVENTIONAL[l]).find(Boolean) ?? 'feat';
  const title = ticket.title.replace(/^\[(ticket|idea)\]\s*/i, '');
  return `${type}: ${title.charAt(0).toLowerCase()}${title.slice(1)} (#${String(ticket.number)})`;
}

// ---------- worker ----------

export async function cmdPick(ctx: Ctx, args: Args): Promise<void> {
  const snapshot = await loadSnapshot(ctx.tracker, META.runLog);
  const requested = optionalInt(args, 'issue');
  const pick = requested
    ? pickSpecific(snapshot, requested)
    : pickNext(snapshot, ctx.config, ctx.now);
  ctx.output('issue', pick.issue === null ? '' : String(pick.issue));
  ctx.output('mode', pick.mode ?? '');
  ctx.output('pr', pick.pr === null ? '' : String(pick.pr));
  ctx.summary(
    `### 🎯 Picker\n${pick.issue === null ? 'Nothing to do' : `#${String(pick.issue)} → **${pick.mode}**`}: ${pick.reason}`,
  );
}

export async function cmdWorkerStart(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const mode = args['mode'] as PickMode;
  const pr = optionalInt(args, 'pr');
  const ticket = await ctx.tracker.getTicket(issue);

  let prHeadRef: string | null = null;
  if (mode === 'fix' && pr) {
    prHeadRef = (await ctx.prs.get(pr)).headRef;
    const changesRequested = (await ctx.prs.reviews(pr))
      .filter((r) => r.state === 'CHANGES_REQUESTED')
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .at(-1);
    writeOut(
      ctx,
      'review-feedback.md',
      changesRequested?.body ?? '(The latest review had no text.)',
    );
  }
  if (mode === 'implement' && sizeOf(ticket.labels) === 'M') {
    const plan = (await ctx.tracker.listComments(issue))
      .filter((c) => c.body.includes(PLAN_MARKER))
      .at(-1);
    writeOut(ctx, 'approved-plan.md', plan?.body ?? '(No approved plan comment found.)');
  }
  writeOut(ctx, 'ticket.md', `# #${String(issue)}: ${ticket.title}\n\n${ticket.body}\n`);

  const plan = planWorkerStart({
    issue,
    title: ticket.title,
    labels: ticket.labels,
    mode,
    prHeadRef,
    maxAttempts: ctx.config.maxAttemptsPerTicket,
    runUrl: ctx.runUrl,
  });
  await applyLabels(ctx, issue, plan.labels);
  await ctx.tracker.comment(issue, plan.comment);
  ctx.output('branch', plan.branch);
  ctx.output('attempt', String(plan.attempt));
  ctx.output('allow_golden', plan.allowGolden ? '1' : '0');
  ctx.output('size', sizeOf(ticket.labels) ?? '');
}

interface FollowUp {
  title: string;
  why: string;
}

async function createFollowUps(ctx: Ctx, issue: number, pr: number): Promise<number[]> {
  const raw = readOut(ctx, 'follow-ups.json');
  if (!raw) return [];
  let items: FollowUp[];
  try {
    items = (JSON.parse(raw) as unknown[]).flatMap((x) => {
      if (typeof x !== 'object' || x === null) return [];
      const { title, why } = x as Record<string, unknown>;
      return typeof title === 'string' && title.trim()
        ? [{ title: title.trim(), why: typeof why === 'string' ? why : '' }]
        : [];
    });
  } catch {
    return [];
  }
  const today = (await ctx.tracker.listTicketsByLabel(SOURCE_AGENT)).filter((t) =>
    sameUtcDay(new Date(t.createdAt), ctx.now),
  ).length;
  const room = Math.max(0, ctx.config.maxAgentProposedTicketsPerDay - today);
  const created: number[] = [];
  for (const item of items.slice(0, Math.min(room, 3))) {
    created.push(
      await ctx.tracker.createTicket({
        title: item.title.slice(0, 90),
        body: `Proposed by the worker agent while working on #${String(issue)} (PR #${String(pr)}).\n\n${item.why.slice(0, 1500)}\n\n_Not in the queue: the owner decides whether to refine and promote it._`,
        labels: [SOURCE_AGENT, STATUS.proposed],
      }),
    );
  }
  if (items.length > created.length) {
    ctx.summary(
      `Follow-ups: ${String(items.length - created.length)} not filed (daily cap of ${String(ctx.config.maxAgentProposedTicketsPerDay)} agent proposals).`,
    );
  }
  return created;
}

export async function cmdWorkerFinish(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const mode = args['mode'] as PickMode;
  const branch = args['branch'] ?? '';
  const prArg = optionalInt(args, 'pr');
  const attempt = optionalInt(args, 'attempt') ?? 1;
  const ticket = await ctx.tracker.getTicket(issue);
  const size = sizeOf(ticket.labels);
  const stats = execStats(ctx);
  const escalation = readOut(ctx, 'escalation.md');

  if (ctx.env['HOOKS_LOADED'] !== 'true') {
    // The agent never ran with guardrails (hooks didn't load, or Claude didn't start). Push
    // nothing, don't count it against the ticket, and make the problem loud.
    await setStatus(ctx, ticket, mode === 'fix' ? STATUS.inReview : STATUS.ready);
    await ctx.tracker.comment(
      issue,
      `⚠️ Infrastructure problem: the agent did not run with guardrails loaded, so nothing was pushed and this attempt was not counted. The ticket is back in the queue. [Run](${ctx.runUrl})`,
    );
    ctx.output('outcome', 'failed');
    await appendRunLog(ctx, {
      role: 'worker',
      issue,
      mode,
      size,
      attempt,
      outcome: 'failed',
      note: 'infra: guardrail canary missing; nothing pushed',
    });
    return;
  }

  let hasChanges = false;
  let checkPassed = false;
  let guard: string[] = [];
  if (mode !== 'plan') {
    if (ctx.git.run(['status', '--porcelain']).trim()) {
      ctx.git.run(['add', '-A']);
      ctx.git.run([
        'commit',
        '-m',
        `chore(#${String(issue)}): changes the worker left uncommitted`,
      ]);
    }
    const base = mode === 'fix' ? `origin/${branch}` : 'origin/main';
    hasChanges = Number(ctx.git.run(['rev-list', '--count', `${base}..HEAD`]).trim()) > 0;
    checkPassed = readState(ctx, 'check-pass') === ctx.fingerprint();
    // Same rules as CI agent-guard, before anything leaves the runner.
    const diff = ctx.git.run(['diff', '--name-status', '-M', 'origin/main...HEAD']);
    guard = findViolations(
      parseNameStatus(diff),
      ctx.config,
      ticket.labels.includes(PHYSICS_CHANGE),
    );
  }

  let decision = decideWorkerOutcome({
    mode,
    escalated: escalation !== null,
    planText: readOut(ctx, 'plan.md'),
    hasChanges,
    checkPassed,
    claudeSubtype: readExecutionFile(ctx.env['EXECUTION_FILE']).subtype,
  });
  if ((decision.outcome === 'pr-opened' || decision.outcome === 'fix-pushed') && guard.length > 0) {
    decision = {
      outcome: 'failed',
      reason: `the change touches paths only the owner may change: ${guard.join('; ')}`,
    };
  }
  const canPushWip = hasChanges && guard.length === 0 && mode !== 'fix';
  const log = { role: 'worker' as const, issue, mode, size, attempt, ...stats };
  ctx.output('outcome', decision.outcome);

  switch (decision.outcome) {
    case 'escalated': {
      if (canPushWip) ctx.push(branch);
      await setStatus(ctx, ticket, STATUS.needsHuman);
      await ctx.tracker.comment(
        issue,
        `## 🤖 Escalated: needs your input\n\n${escalation?.trim() ?? ''}${canPushWip ? `\n\nWork in progress was pushed to \`${branch}\` (no PR).` : ''}\n\nAnswer here and set the ticket back to \`${STATUS.ready}\` (or \`${STATUS.needsRefinement}\`). [Run](${ctx.runUrl})`,
      );
      await appendRunLog(ctx, {
        ...log,
        outcome: 'escalated',
        note: escalation?.trim().slice(0, 500) ?? null,
      });
      return;
    }
    case 'plan-posted': {
      await ctx.tracker.comment(issue, planComment(readOut(ctx, 'plan.md') ?? ''));
      await applyLabels(ctx, issue, {
        add: [PLAN.proposed, STATUS.ready],
        remove: [STATUS.inProgress],
      });
      await appendRunLog(ctx, { ...log, outcome: 'plan-posted' });
      return;
    }
    case 'pr-opened': {
      ctx.push(branch);
      const pr = await ctx.prs.create({
        title: prTitle(ticket),
        body: finalizePrBody(readOut(ctx, 'pr-body.md'), issue, ctx.runUrl),
        head: branch,
        base: 'main',
      });
      await ctx.tracker.addLabels(pr.number, prLabelsFromTicket(ticket.labels));
      await applyLabels(ctx, issue, { add: [STATUS.inReview], remove: [STATUS.inProgress] });
      const followUps = await createFollowUps(ctx, issue, pr.number);
      await ctx.tracker.comment(
        issue,
        `🤖 Opened ${pr.url} for review.${followUps.length ? ` Proposed follow-ups: ${followUps.map((n) => `#${String(n)}`).join(', ')}.` : ''}`,
      );
      ctx.output('pr', String(pr.number));
      await appendRunLog(ctx, { ...log, pr: pr.number, outcome: 'pr-opened' });
      return;
    }
    case 'fix-pushed': {
      ctx.push(branch);
      await applyLabels(ctx, issue, { add: [STATUS.inReview], remove: [STATUS.inProgress] });
      if (prArg)
        await ctx.tracker.comment(
          prArg,
          `🤖 Pushed fixes for the review feedback (attempt ${String(attempt)}). [Run](${ctx.runUrl})`,
        );
      await appendRunLog(ctx, { ...log, pr: prArg, outcome: 'fix-pushed' });
      return;
    }
    case 'failed': {
      if (canPushWip) ctx.push(branch);
      const bump = planAttemptBump({
        labels: ticket.labels,
        maxAttempts: ctx.config.maxAttemptsPerTicket,
        backToStatus: mode === 'fix' ? STATUS.inReview : STATUS.ready,
      });
      await applyLabels(ctx, issue, bump.labels);
      const where = canPushWip ? ` Work in progress: \`${branch}\`.` : '';
      if (bump.exhausted) {
        await ctx.tracker.comment(
          issue,
          `## 🤖 Needs your help\n\nAttempt ${String(attempt)}/${String(ctx.config.maxAttemptsPerTicket)} failed: ${decision.reason}. No attempts left.${where}\n\nLook at the [run](${ctx.runUrl}), then clarify the ticket and set it back to \`${STATUS.ready}\`.`,
        );
        await appendRunLog(ctx, {
          ...log,
          outcome: 'needs-human',
          note: `LESSON DRAFT: #${String(issue)} exhausted attempts. Last failure: ${decision.reason}`.slice(
            0,
            500,
          ),
        });
      } else {
        await ctx.tracker.comment(
          issue,
          `🤖 Attempt ${String(attempt)} failed: ${decision.reason}.${where} Will retry as attempt ${String(bump.nextAttempt)}/${String(ctx.config.maxAttemptsPerTicket)}. [Run](${ctx.runUrl})`,
        );
        await appendRunLog(ctx, { ...log, outcome: 'failed', note: decision.reason.slice(0, 500) });
      }
      return;
    }
  }
}

// ---------- reviewer ----------

async function waitForChecks(ctx: Ctx, sha: string): Promise<CiStatus> {
  const timeoutMs = Number(ctx.env['CHECK_WAIT_MS'] ?? 300_000);
  const started = Date.now();
  for (;;) {
    const ci = evaluateChecks(await ctx.prs.checkRuns(sha));
    if (ci.pending.length === 0 || Date.now() - started > timeoutMs) return ci;
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

function checksMarkdown(runs: readonly CheckRun[]): string {
  return (
    runs.map((r) => `- ${r.name}: ${r.conclusion ?? r.status}`).join('\n') ||
    '- (no checks reported)'
  );
}

export async function cmdReviewContext(ctx: Ctx, args: Args): Promise<void> {
  const prNumber = requireInt(args, 'pr');
  const expectedSha = args['sha'];
  const pr = await ctx.prs.get(prNumber);
  const skip = (reason: string): void => {
    ctx.output('skip', 'true');
    ctx.summary(`Review skipped: ${reason}`);
  };
  if (pr.state !== 'open' || !pr.headRef.startsWith('agent/') || pr.draft) {
    skip('not an open agent PR');
    return;
  }
  if (expectedSha && pr.headSha !== expectedSha) {
    skip('a newer commit exists; its own CI run will trigger review');
    return;
  }
  const issue = ticketNumberOfPr(pr);
  if (issue === null) {
    skip('cannot tell which ticket this PR implements');
    return;
  }
  const ticket = await ctx.tracker.getTicket(issue);
  if (statusOf(ticket.labels) === STATUS.needsHuman) {
    skip(`#${String(issue)} is waiting on the owner`);
    return;
  }

  const ci = await waitForChecks(ctx, pr.headSha);
  writeOut(ctx, 'review/ticket.md', `# #${String(issue)}: ${ticket.title}\n\n${ticket.body}\n`);
  writeOut(ctx, 'review/pr.md', `# PR #${String(pr.number)}: ${pr.title}\n\n${pr.body}\n`);
  writeOut(
    ctx,
    'review/ci.md',
    `# CI for ${pr.headSha}\n\n${checksMarkdown(await ctx.prs.checkRuns(pr.headSha))}\n`,
  );
  ctx.output('skip', 'false');
  ctx.output('issue', String(issue));
  ctx.output('head_sha', pr.headSha);
  ctx.output('ci_green', ci.green ? 'true' : 'false');
  ctx.output('ci_failing', ci.failing.join(','));
  ctx.output('ci_pending', ci.pending.join(','));
}

export async function cmdReviewFinish(ctx: Ctx, args: Args): Promise<void> {
  const prNumber = requireInt(args, 'pr');
  const issue = requireInt(args, 'issue');
  const pr = await ctx.prs.get(prNumber);
  const ticket = await ctx.tracker.getTicket(issue);
  const attempt = Math.max(attemptOf(ticket.labels), 1);
  const stats = execStats(ctx);
  const log = {
    role: 'reviewer' as const,
    issue,
    pr: prNumber,
    mode: 'review-pr' as const,
    size: sizeOf(ticket.labels),
    attempt,
  };

  let verdict;
  if (ctx.env['CI_GREEN'] !== 'true') {
    const csv = (key: string): string[] => (ctx.env[key] ?? '').split(',').filter(Boolean);
    verdict = ciFailureVerdict({
      green: false,
      failing: csv('CI_FAILING'),
      pending: csv('CI_PENDING'),
    });
  } else {
    const parsed = PrVerdictSchema.safeParse(jsonEnv(ctx, 'VERDICT_JSON'));
    if (!parsed.success) {
      await ctx.tracker.comment(
        prNumber,
        `⚠️ The reviewer agent did not return a valid verdict, so nothing was approved. Re-run **Agent Review** for this PR. [Run](${ctx.runUrl})`,
      );
      await appendRunLog(ctx, {
        ...log,
        ...stats,
        outcome: 'failed',
        note: 'reviewer returned no valid verdict',
      });
      ctx.output('approved', 'false');
      return;
    }
    verdict = enforceConsistency(parsed.data);
  }

  const approve = verdict.verdict === 'approve';
  await ctx.reviewPrs.submitReview(
    prNumber,
    pr.headSha,
    approve ? 'APPROVE' : 'REQUEST_CHANGES',
    prReviewBody(verdict, attempt, ctx.config.maxAttemptsPerTicket),
  );
  if (approve) {
    await ctx.tracker.addLabels(prNumber, [AGENT_APPROVED]);
  } else {
    await ctx.tracker.removeLabel(prNumber, AGENT_APPROVED);
    const bump = planAttemptBump({
      labels: ticket.labels,
      maxAttempts: ctx.config.maxAttemptsPerTicket,
      backToStatus: STATUS.inReview,
    });
    await applyLabels(ctx, issue, bump.labels);
    if (bump.exhausted) {
      await ctx.tracker.comment(
        issue,
        `## 🤖 Needs your help\n\nThe reviewer requested changes on #${String(prNumber)} and the worker has no attempts left. Decide whether to fix it yourself, clarify the ticket, or close the PR.`,
      );
    }
  }
  ctx.output('approved', approve ? 'true' : 'false');
  await appendRunLog(ctx, {
    ...log,
    ...stats,
    outcome: approve ? 'approved' : 'changes-requested',
  });
}

export async function cmdPlanReviewContext(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const ticket = await ctx.tracker.getTicket(issue);
  const plan = (await ctx.tracker.listComments(issue))
    .filter((c) => c.body.includes(PLAN_MARKER))
    .at(-1);
  if (!ticket.labels.includes(PLAN.proposed) || !plan) {
    ctx.output('skip', 'true');
    return;
  }
  writeOut(ctx, 'review/ticket.md', `# #${String(issue)}: ${ticket.title}\n\n${ticket.body}\n`);
  writeOut(ctx, 'review/plan.md', plan.body);
  ctx.output('skip', 'false');
}

export async function cmdPlanReviewFinish(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const ticket = await ctx.tracker.getTicket(issue);
  const stats = execStats(ctx);
  const log = {
    role: 'reviewer' as const,
    issue,
    mode: 'review-plan' as const,
    size: sizeOf(ticket.labels),
    attempt: Math.max(attemptOf(ticket.labels), 1),
  };
  const parsed = PlanVerdictSchema.safeParse(jsonEnv(ctx, 'VERDICT_JSON'));
  if (!parsed.success) {
    await ctx.tracker.comment(
      issue,
      `⚠️ The reviewer agent did not return a valid plan verdict. Re-run **Agent Review** for this issue. [Run](${ctx.runUrl})`,
    );
    await appendRunLog(ctx, {
      ...log,
      ...stats,
      outcome: 'failed',
      note: 'reviewer returned no valid plan verdict',
    });
    return;
  }
  const v =
    parsed.data.verdict === 'approve' && parsed.data.issues.length > 0
      ? { ...parsed.data, verdict: 'request_changes' as const }
      : parsed.data;
  await ctx.tracker.comment(issue, planReviewComment(v));
  if (v.verdict === 'approve') {
    await applyLabels(ctx, issue, { add: [PLAN.approved], remove: [PLAN.proposed] });
    await appendRunLog(ctx, { ...log, ...stats, outcome: 'plan-approved' });
    return;
  }
  const bump = planAttemptBump({
    labels: ticket.labels,
    maxAttempts: ctx.config.maxAttemptsPerTicket,
    backToStatus: STATUS.ready,
  });
  await applyLabels(ctx, issue, {
    add: bump.labels.add,
    remove: [PLAN.proposed, ...bump.labels.remove],
  });
  if (bump.exhausted)
    await ctx.tracker.comment(
      issue,
      '## 🤖 Needs your help\n\nThe plan was rejected and the worker has no attempts left. Please clarify the ticket.',
    );
  await appendRunLog(ctx, { ...log, ...stats, outcome: 'plan-changes-requested' });
}

// ---------- merger ----------

export async function cmdMerge(ctx: Ctx, args: Args): Promise<void> {
  const prNumber = requireInt(args, 'pr');
  const pr = await ctx.prs.get(prNumber);
  const decision = decideMerge({
    pr,
    ci: evaluateChecks(await ctx.prs.checkRuns(pr.headSha)),
    reviews: await ctx.prs.reviews(prNumber),
    files: toFileChanges(await ctx.prs.files(prNumber)),
    config: ctx.config,
  });
  const issue = ticketNumberOfPr(pr);
  ctx.output('action', decision.action);
  ctx.summary(
    `### 🔀 Merge gate for #${String(prNumber)}: ${decision.action}\n${decision.reasons.map((r) => `- ${r}`).join('\n')}`,
  );
  const log = {
    role: 'merger' as const,
    issue,
    pr: prNumber,
    mode: 'merge' as const,
    size: sizeOf(pr.labels),
  };

  if (decision.action === 'merge') {
    await ctx.prs.squashMerge(prNumber, pr.headSha, pr.title.replace(/\s*\(#\d+\)$/, ''));
    await appendRunLog(ctx, { ...log, outcome: 'merged' });
    return;
  }
  if (decision.action === 'human') {
    const already = (await ctx.tracker.listComments(prNumber)).some(
      (c) => c.body.includes(HUMAN_MERGE_MARKER) && c.body.includes(`<!-- sha:${pr.headSha} -->`),
    );
    if (already) return;
    await ctx.tracker.comment(prNumber, humanMergeComment(pr.headSha, decision.reasons));
    await appendRunLog(ctx, {
      ...log,
      outcome: 'ready-for-human',
      note: decision.reasons.join('; ').slice(0, 500),
    });
  }
}

// ---------- closer ----------

export async function cmdClose(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const ticket = await ctx.tracker.getTicket(issue);
  if (ticket.labels.some((l) => l.startsWith('meta:'))) return;
  for (const label of labelsToStrip(ticket.labels)) await ctx.tracker.removeLabel(issue, label);
  const closing = await ctx.prs.closingPullRequest(issue);
  const summary = closeSummary(closing, ctx.repo);
  if (summary) await ctx.tracker.comment(issue, summary);
  if (!closing) return;

  const pr = await ctx.prs.get(closing.number);
  if (!pr.headRef.startsWith('agent/')) return;
  await appendRunLog(ctx, {
    role: 'closer',
    issue,
    pr: closing.number,
    mode: 'close',
    size: sizeOf(ticket.labels),
    outcome: 'closed',
  });

  const lastReview = (await ctx.tracker.listTicketsByLabel('type:refactor')).find(
    (t) => t.title === ARCH_REVIEW_TITLE,
  );
  const since = lastReview?.createdAt ?? '1970-01-01T00:00:00Z';
  const merged = (await ctx.prs.mergedAgentPrsSince(since)).length;
  if (shouldOpenArchitectureReview(merged, ctx.config.architectureReviewEveryNMerges)) {
    const n = await ctx.tracker.createTicket({
      title: ARCH_REVIEW_TITLE,
      body: architectureReviewBody(merged),
      labels: ['type:refactor', STATUS.needsHuman],
    });
    ctx.summary(`Opened architecture review #${String(n)} after ${String(merged)} merges.`);
  }
}

// ---------- refiner ----------

export async function cmdRefineGate(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const sender = args['sender'] ?? '';
  const ticket = await ctx.tracker.getTicket(issue);
  if (ticket.state !== 'open' || !ticket.labels.includes(STATUS.needsRefinement)) {
    ctx.output('proceed', 'false');
    return;
  }
  const senderPermission = sender ? await ctx.permissionOf(sender) : 'none';
  const trusted = isTrusted({
    author: ticket.author,
    authorAssociation: ticket.authorAssociation,
    sender,
    senderPermission,
    trustedSubmitters: ctx.config.trustedSubmitters,
  });
  if (!trusted) {
    const comments = await ctx.tracker.listComments(issue);
    if (!comments.some((c) => c.body.includes(AWAITING_TRIAGE_MARKER))) {
      await ctx.tracker.comment(issue, AWAITING_TRIAGE_COMMENT);
      await appendRunLog(ctx, {
        role: 'refiner',
        issue,
        mode: 'refine',
        outcome: 'awaiting-triage',
      });
    }
    ctx.output('proceed', 'false');
    return;
  }
  const comments = (await ctx.tracker.listComments(issue))
    .filter((c) => !c.author.endsWith('[bot]'))
    .slice(-10)
    .map((c) => `**@${c.author}** (${c.createdAt}):\n${c.body}`)
    .join('\n\n---\n\n');
  writeOut(
    ctx,
    'issue.md',
    `# #${String(issue)}: ${ticket.title}\n\nAuthor: @${ticket.author}\n\n${ticket.body}\n\n## Discussion\n\n${comments || '(none)'}\n`,
  );
  ctx.output('proceed', 'true');
  // The action's own write-access check runs on the event actor; trusted family members
  // without write access are let through explicitly (and only them).
  const writer = ['admin', 'maintain', 'write'].includes(senderPermission);
  ctx.output('non_write_actor', writer ? '' : sender);
}

export async function cmdRefineFinish(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const ticket = await ctx.tracker.getTicket(issue);
  const stats = execStats(ctx);
  const log = { role: 'refiner' as const, issue, mode: 'refine' as const, ...stats };
  const parsed = RefinementSchema.safeParse(jsonEnv(ctx, 'REFINEMENT_JSON'));
  if (!parsed.success) {
    await ctx.tracker.comment(
      issue,
      `⚠️ The refiner did not return a valid result. Re-apply \`${STATUS.needsRefinement}\` to retry. [Run](${ctx.runUrl})`,
    );
    await applyLabels(ctx, issue, { add: [STATUS.needsHuman], remove: [STATUS.needsRefinement] });
    await appendRunLog(ctx, {
      ...log,
      outcome: 'failed',
      note: 'refiner returned no valid result',
    });
    return;
  }
  const action = planRefinement(parsed.data, ticket.labels);
  if (action.kind === 'needs-human') {
    await ctx.tracker.comment(issue, action.comment);
    await applyLabels(ctx, issue, { add: [STATUS.needsHuman], remove: [STATUS.needsRefinement] });
    await appendRunLog(ctx, { ...log, outcome: 'needs-human' });
    return;
  }
  await ctx.tracker.comment(issue, originalTextComment(ticket.title, ticket.body));
  if (action.kind === 'ready') {
    await ctx.tracker.updateTicket(issue, { title: action.title, body: action.body });
    await applyLabels(ctx, issue, action.labels);
    await ctx.tracker.comment(issue, action.comment);
    await appendRunLog(ctx, { ...log, size: sizeOf(action.labels.add), outcome: 'refined' });
    return;
  }
  const numbers: number[] = [];
  for (const child of action.children) {
    const dependencies = [
      ...child.spec.dependencies,
      ...child.dependsOnChildren.map((i) => numbers[i] ?? 0).filter((n) => n > 0),
    ];
    const spec = { ...child.spec, dependencies };
    numbers.push(
      await ctx.tracker.createTicket({
        title: child.title,
        body: `${renderTicketBody(spec)}\n_Split from #${String(issue)} by the refiner._\n`,
        labels: [
          `size:${spec.size}`,
          `priority:${spec.priority}`,
          `type:${spec.type}`,
          STATUS.ready,
        ],
      }),
    );
  }
  await ctx.tracker.comment(
    issue,
    `${action.comment}\n\n${numbers.map((n) => `- #${String(n)}`).join('\n')}\n\nClosing this one; tracking continues in the new tickets.`,
  );
  await ctx.tracker.removeLabel(issue, STATUS.needsRefinement);
  await ctx.tracker.updateTicket(issue, { state: 'closed', stateReason: 'not_planned' });
  await appendRunLog(ctx, {
    ...log,
    outcome: 'split',
    note: `split into ${numbers.map((n) => `#${String(n)}`).join(', ')}`,
  });
}

// ---------- digest ----------

export async function cmdDigestReport(ctx: Ctx): Promise<void> {
  const logIssue = await ctx.tracker.findOpenTicketByLabel(META.runLog);
  const entries = logIssue
    ? parseRunLog((await ctx.tracker.listComments(logIssue.number)).map((c) => c.body))
    : [];
  const day = 86_400_000;
  const iso = (daysAgo: number): string =>
    new Date(ctx.now.getTime() - daysAgo * day).toISOString();
  const humanEdited = new Set<number>();
  for (const t of shippedTickets(within(entries, ctx.now, 90)).slice(0, 30)) {
    if (t.pr === null) continue;
    const authors = await ctx.prs.commitAuthors(t.pr);
    if (authors.some((a) => !a.endsWith('[bot]'))) humanEdited.add(t.pr);
  }
  const metrics = weeklyMetrics(entries, ctx.now, await ctx.prs.revertsSince(iso(7)));
  const rec = recommendAutonomy({
    level: ctx.config.autonomyLevel,
    entries,
    now: ctx.now,
    reverts14d: await ctx.prs.revertsSince(iso(14)),
    humanEditedPrs: humanEdited,
  });
  const weekOf = iso(7).slice(0, 10);
  const number = await ctx.tracker.createTicket({
    title: `🤖 Weekly agent digest: week of ${weekOf}`,
    body: digestBody(metrics, rec, ctx.config.autonomyLevel, weekOf),
    labels: [META.digest],
  });
  const troubles = within(entries, ctx.now, 7).filter((e) =>
    ['failed', 'changes-requested', 'plan-changes-requested', 'escalated', 'needs-human'].includes(
      e.outcome,
    ),
  );
  writeOut(
    ctx,
    'digest-context.md',
    `# Digest context (week of ${weekOf})\n\nMetrics:\n\n\`\`\`json\n${JSON.stringify(metrics, null, 2)}\n\`\`\`\n\nFailures and escalations this week:\n\n${troubles.map((e) => `- ${e.role} ${e.outcome} on #${String(e.issue)}${e.note ? `: ${e.note}` : ''}`).join('\n') || '- none'}\n`,
  );
  ctx.output('digest_issue', String(number));
  ctx.output('has_failures', troubles.length > 0 ? 'true' : 'false');
  await appendRunLog(ctx, {
    role: 'digest',
    mode: 'digest',
    outcome: 'digest-opened',
    issue: number,
  });
}

export const DIGEST_EDITABLE = ['CLAUDE.md', '.agent/LESSONS.md'];

export async function cmdDigestPr(ctx: Ctx, args: Args): Promise<void> {
  const digestIssue = optionalInt(args, 'digest-issue');
  const changed = ctx.git
    .run(['status', '--porcelain'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3).trim());
  if (changed.length === 0) {
    ctx.output('pr', '');
    return;
  }
  const outside = changed.filter((f) => !DIGEST_EDITABLE.includes(f));
  if (outside.length > 0)
    throw new Error(`The digest agent changed files outside the rulebook: ${outside.join(', ')}`);
  const date = ctx.now.toISOString().slice(0, 10);
  const branch = `digest/${date}`;
  ctx.git.run(['switch', '-c', branch]);
  ctx.git.run(['add', ...changed]);
  ctx.git.run(['commit', '-m', `docs(rules): weekly digest lesson updates (${date})`]);
  ctx.push(branch);
  const pr = await ctx.prs.create({
    title: `docs(rules): weekly digest lesson updates (${date})`,
    body: `Proposed rulebook updates from recurring failures this week${digestIssue ? ` (see #${String(digestIssue)})` : ''}.\n\nThese are protected files: **you decide**. Merge, edit, or close.\n\n🤖 Opened by the digest agent · [run](${ctx.runUrl})`,
    head: branch,
    base: 'main',
  });
  ctx.output('pr', String(pr.number));
}

// ---------- misc ----------

const PROMPTS = [
  'worker',
  'worker-fix',
  'planner',
  'reviewer-pr',
  'reviewer-plan',
  'refiner',
  'digest',
];

/** Outputs a prompt file plus run context, for the Claude step's `prompt` input. */
export function cmdPrompt(ctx: Ctx, args: Args): void {
  const name = args['name'] ?? '';
  if (!PROMPTS.includes(name)) throw new Error(`--name must be one of ${PROMPTS.join(', ')}`);
  const body = readFileSync(join(ctx.root, '.agent', 'prompts', `${name}.md`), 'utf8');
  const context = [
    args['issue'] ? `Ticket: #${args['issue']}` : '',
    args['pr'] ? `Pull request: #${args['pr']}` : '',
    args['attempt'] ? `Attempt: ${args['attempt']}/${String(ctx.config.maxAttemptsPerTicket)}` : '',
  ].filter(Boolean);
  ctx.output('text', `${body.trim()}\n\n---\n${context.join('\n')}`.trim());
}

/** Outputs the per-role settings from agent.config.json for the workflow. */
export function cmdConfig(ctx: Ctx, args: Args): void {
  const role = args['role'] as 'refiner' | 'worker' | 'reviewer' | 'digest' | undefined;
  if (!role || !(role in ctx.config.maxTurns))
    throw new Error('--role must be refiner, worker, reviewer or digest');
  ctx.output('model', ctx.config.models[role]);
  ctx.output('max_turns', String(ctx.config.maxTurns[role]));
  ctx.output('max_attempts', String(ctx.config.maxAttemptsPerTicket));
}

const SCHEMAS = {
  'pr-verdict': PrVerdictSchema,
  'plan-verdict': PlanVerdictSchema,
  refinement: RefinementSchema,
};

export function cmdSchema(ctx: Ctx, args: Args): void {
  const name = args['name'] as keyof typeof SCHEMAS | undefined;
  const schema = name ? SCHEMAS[name] : undefined;
  if (!schema) throw new Error(`--name must be one of ${Object.keys(SCHEMAS).join(', ')}`);
  ctx.output('json', jsonSchemaFor(schema));
}

export const COMMANDS: Readonly<Record<string, (ctx: Ctx, args: Args) => Promise<void> | void>> = {
  pick: cmdPick,
  'worker-start': cmdWorkerStart,
  'worker-finish': cmdWorkerFinish,
  'review-context': cmdReviewContext,
  'review-finish': cmdReviewFinish,
  'plan-review-context': cmdPlanReviewContext,
  'plan-review-finish': cmdPlanReviewFinish,
  merge: cmdMerge,
  close: cmdClose,
  'refine-gate': cmdRefineGate,
  'refine-finish': cmdRefineFinish,
  'digest-report': cmdDigestReport,
  'digest-pr': cmdDigestPr,
  schema: cmdSchema,
  prompt: cmdPrompt,
  config: cmdConfig,
};

export function parseArgs(argv: readonly string[]): {
  command: string;
  args: Record<string, string>;
} {
  const [command = '', ...rest] = argv;
  const args: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key?.startsWith('--')) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) args[key.slice(2)] = 'true';
      else {
        args[key.slice(2)] = value;
        i++;
      }
    }
  }
  return { command, args };
}

function realContext(env: NodeJS.ProcessEnv): Ctx {
  const repo = repoFromEnv(env);
  const bot = execGhClient(); // GH_TOKEN = the App token in agent workflows
  const reviewToken = env['REVIEW_TOKEN'];
  const reviewer = reviewToken ? execGhClient({ GH_TOKEN: reviewToken }) : bot;
  const root = REPO_ROOT;
  const git: Git = { run: (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }) };
  return {
    repo,
    tracker: new GitHubTracker(bot, repo),
    prs: new GitHubPullRequests(bot, repo),
    reviewPrs: new GitHubPullRequests(reviewer, repo),
    config: loadAgentConfig(),
    root,
    now: new Date(),
    runUrl: `${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${repo}/actions/runs/${env['GITHUB_RUN_ID'] ?? '0'}`,
    git,
    fingerprint: () =>
      execFileSync('bash', ['-c', 'source .claude/hooks/lib.sh && fingerprint'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    permissionOf: async (user) => {
      try {
        const r = await bot.rest<{ permission: string }>(
          'GET',
          `repos/${repo}/collaborators/${encodeURIComponent(user)}/permission`,
        );
        return r.permission;
      } catch {
        return 'none';
      }
    },
    push: (branch) => {
      const token = env['AGENT_BOT_TOKEN'];
      if (!token) throw new Error('AGENT_BOT_TOKEN is required to push');
      execFileSync(
        'git',
        [
          'push',
          `https://x-access-token:${token}@github.com/${repo}.git`,
          `HEAD:refs/heads/${branch}`,
        ],
        {
          cwd: root,
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      );
    },
    output: (key, value) => {
      const file = env['GITHUB_OUTPUT'];
      const line = value.includes('\n')
        ? `${key}<<__MM_EOF__\n${value}\n__MM_EOF__\n`
        : `${key}=${value}\n`;
      if (file) appendFileSync(file, line);
      else console.log(`[output] ${key}=${value}`);
    },
    summary: (markdown) => {
      const file = env['GITHUB_STEP_SUMMARY'];
      if (file) appendFileSync(file, `${markdown}\n\n`);
      console.log(markdown);
    },
    env,
  };
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  const run = COMMANDS[command];
  if (!run)
    throw new Error(`Unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(', ')}`);
  await run(realContext(process.env), args);
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
