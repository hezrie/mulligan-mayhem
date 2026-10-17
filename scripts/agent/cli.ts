/**
 * The agent workflows' deterministic steps. Every GitHub side effect of the loop happens here,
 * never in an LLM step: labels, comments, pushes, PRs, reviews, merges.
 *
 * Trust model: on GitHub-hosted runners every step of a job can read every secret of that job,
 * so jobs that run an LLM (and the code it writes) never hold the bot App token. Commands that
 * write run in separate "trusted" jobs on fresh runners and treat everything produced by an LLM
 * job (git bundles, markdown, JSON) strictly as data: they never execute or check it out.
 *
 *   npx tsx scripts/agent/cli.ts <command> [--flag value ...]
 *
 * PROTECTED: agents may not edit this file.
 */
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findViolations, modeViolations, parseNameStatus } from './agent-guard.ts';
import {
  ARCH_REVIEW_TITLE,
  architectureReviewBody,
  closeSummary,
  labelsToStrip,
  shouldOpenArchitectureReview,
} from './close.ts';
import { loadAgentConfig, REPO_ROOT, type AgentConfig } from './config.ts';
import { digestBody, prsToCheck, recommendAutonomy, weeklyMetrics, within } from './digest.ts';
import { readExecutionFile, type ExecutionSummary } from './execution.ts';
import { GitHubPullRequests, type CheckRun, type PrInfo } from './github-pr.ts';
import { AGENT_APPROVED, META, PHYSICS_CHANGE, PLAN, SOURCE_AGENT, STATUS } from './labels.ts';
import { decideMerge, HUMAN_MERGE_MARKER, humanMergeComment, REVIEWER_LOGIN } from './merge.ts';
import {
  isAgentPr,
  loadSnapshot,
  orphanedTickets,
  pickNext,
  pickSpecific,
  readyWithOpenPr,
  strandedInReview,
  ticketOfPr,
  type PickMode,
  type Snapshot,
} from './pick-next.ts';
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
  latestRunPerName,
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
import { execGhClient, GhApiError, repoFromEnv } from './tracker/gh-client.ts';
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
  | 'updateBody'
  | 'branchExists'
  | 'openAgentPrsWithLabel'
  | 'reviewComments'
>;

export interface Git {
  /** Runs git with hooks and global/system config disabled. */
  run(args: readonly string[]): string;
}

export interface Ctx {
  readonly repo: string;
  readonly tracker: Tracker;
  /** Acts as the bot App: labels, comments, PRs, merges. Read-only GITHUB_TOKEN in LLM jobs. */
  readonly prs: PrHost;
  /** Acts as github-actions[bot] (GITHUB_TOKEN): submits reviews, so author ≠ reviewer. */
  readonly reviewPrs: PrHost;
  /** Reads check runs (GITHUB_TOKEN with checks:read; the App has no Checks permission). */
  readonly checks: Pick<PrHost, 'checkRuns'>;
  readonly config: AgentConfig;
  readonly root: string;
  readonly now: Date;
  readonly runUrl: string;
  readonly git: Git;
  readonly fingerprint: () => string;
  readonly permissionOf: (user: string) => Promise<string>;
  /** Pushes a local ref (never a checked-out tree) to a branch, authenticated as the bot. */
  readonly push: (ref: string, branch: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  readonly output: (key: string, value: string) => void;
  readonly summary: (markdown: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

type Args = Readonly<Record<string, string | undefined>>;

// ---------- small helpers ----------

const outDir = (ctx: Ctx): string => join(ctx.root, '.agent', 'out');
const stateDir = (ctx: Ctx): string =>
  ctx.env['AGENT_STATE_DIR'] ?? join(ctx.root, '.agent', '.state');

function readFile(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function writeOut(ctx: Ctx, name: string, content: string): void {
  const path = join(outDir(ctx), name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

/** Parses a JSON env var or file (an LLM job's output); missing or malformed → null. */
function parseJson(raw: string | null | undefined): unknown {
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

/** The bot App's login, e.g. "mulligan-mayhem-agent[bot]", from APP_SLUG. */
export function botLogin(ctx: Ctx): string | null {
  const slug = ctx.env['APP_SLUG'];
  return slug ? `${slug}[bot]` : null;
}

function trustedAuthors(ctx: Ctx): string[] {
  const bot = botLogin(ctx);
  return bot ? [bot] : [];
}

async function applyLabels(ctx: Ctx, number: number, change: LabelChange): Promise<void> {
  // Remove first: an interrupted run never leaves two contradictory status labels behind.
  for (const label of change.remove) await ctx.tracker.removeLabel(number, label);
  await ctx.tracker.addLabels(number, change.add);
}

/** Moves a ticket to exactly one status label. */
async function setStatus(ctx: Ctx, ticket: Ticket, status: string): Promise<void> {
  const current = ticket.labels.filter((l) => (Object.values(STATUS) as string[]).includes(l));
  await applyLabels(ctx, ticket.number, {
    add: [status],
    remove: current.filter((l) => l !== status),
  });
}

/**
 * Strips anything credential-shaped from text that goes into public comments or the run log
 * (error messages can echo command lines and HTTP headers).
 */
export function redact(text: string): string {
  return text
    .replace(/(authorization:\s*)(basic|bearer|token)?\s*[^\s'"]+/gi, '$1[redacted]')
    .replace(/x-access-token:[^@\s'"]+/gi, 'x-access-token:[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}/g, '[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[redacted]')
    .replace(/[A-Za-z0-9+/]{60,}={0,2}/g, '[redacted]');
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
    ctx.summary(
      '::error::No run log issue found (label meta:run-log); run entry not recorded. Run `npm run setup:run-log`.',
    );
    return;
  }
  await ctx.tracker.comment(log.number, formatRunLogComment(entry));
}

/**
 * The LLM step's execution summary: read from EXECUTION_FILE in the LLM job itself, or from the
 * EXEC_* values that job passed on (trusted jobs run on another runner without the file).
 */
function execSummary(ctx: Ctx): ExecutionSummary {
  const file = ctx.env['EXECUTION_FILE'];
  if (file && existsSync(file)) return readExecutionFile(file);
  const num = (key: string): number | null => {
    const raw = ctx.env[key];
    return raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };
  return {
    turns: num('EXEC_TURNS'),
    costUsd: num('EXEC_COST_USD'),
    durationSec: num('EXEC_DURATION_SEC'),
    subtype: ctx.env['EXEC_SUBTYPE'] ?? null,
    isError: ctx.env['EXEC_IS_ERROR'] !== 'false',
  };
}

function execStats(ctx: Ctx): Pick<RunLogEntry, 'turns' | 'costUsd' | 'durationSec'> {
  const e = execSummary(ctx);
  return { turns: e.turns, costUsd: e.costUsd, durationSec: e.durationSec };
}

/**
 * The ticket a PR belongs to: the agent/<N>-slug branch, named by the trusted pick job. The PR
 * body is LLM-written, so its "Closes #N" never decides which ticket gets labels or attempts.
 */
export function ticketNumberOfPr(pr: Pick<PrInfo, 'headRef'>): number | null {
  return ticketOfPr(pr);
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

async function waitForChecks(ctx: Ctx, sha: string): Promise<CiStatus> {
  const timeoutMs = Number(ctx.env['CHECK_WAIT_MS'] ?? 300_000);
  for (let waited = 0; ; waited += 15_000) {
    const ci = evaluateChecks(await ctx.checks.checkRuns(sha));
    if (ci.pending.length === 0 || waited >= timeoutMs) return ci;
    await ctx.sleep(15_000);
  }
}

// ---------- worker: pick (trusted job) ----------

/**
 * The worker runs one at a time, so a ticket still in status:in-progress at the start of a run
 * was left behind by a run that died (timeout, cancellation, runner loss). Re-queue it once;
 * the second time, hand it to the owner.
 */
async function recoverOrphans(ctx: Ctx, snapshot: Snapshot): Promise<number> {
  const orphans = orphanedTickets(snapshot);
  for (const ticket of orphans) {
    const before = snapshot.runLog.filter(
      (e) => e.issue === ticket.number && e.outcome === 'infra-failure',
    ).length;
    const hasPr = snapshot.pullRequests.some(
      (pr) => isAgentPr(pr, snapshot.agentLogin) && ticketOfPr(pr) === ticket.number,
    );
    if (before >= 1) {
      await setStatus(ctx, ticket, STATUS.needsHuman);
      await ctx.tracker.comment(
        ticket.number,
        '## 🤖 Needs your help\n\nWorker runs on this ticket keep ending without finishing (timeouts, cancellations or infrastructure errors). Look at the recent **Agent Worker** runs, then set the ticket back to `status:ready`.',
      );
    } else {
      await setStatus(ctx, ticket, hasPr ? STATUS.inReview : STATUS.ready);
      await ctx.tracker.comment(
        ticket.number,
        `⚠️ The previous worker run on this ticket ended without finishing its bookkeeping (cancelled or timed out). Re-queued; this was not counted as an attempt. [Run](${ctx.runUrl})`,
      );
    }
    await appendRunLog(ctx, {
      role: 'worker',
      issue: ticket.number,
      size: sizeOf(ticket.labels),
      attempt: attemptOf(ticket.labels),
      outcome: 'infra-failure',
      note: 'infra: orphaned status:in-progress recovered at pick time',
    });
  }
  return orphans.length;
}

/**
 * Tickets whose status contradicts their PR: a ready ticket that already has an open agent PR
 * goes to review (a second PR would be a duplicate), and an in-review ticket whose PR is gone
 * (closed without merging) goes to the owner instead of holding the WIP slot forever.
 */
async function repairStuckStates(ctx: Ctx, snapshot: Snapshot): Promise<number> {
  let repaired = 0;
  for (const { ticket, pr } of readyWithOpenPr(snapshot)) {
    await setStatus(ctx, ticket, STATUS.inReview);
    await ctx.tracker.comment(
      ticket.number,
      `🤖 This ticket already has an open agent PR (#${String(pr.number)}), so it goes to review rather than a second implementation. To start over instead, close that PR and set the ticket back to \`${STATUS.ready}\`.`,
    );
    repaired++;
  }
  for (const ticket of strandedInReview(snapshot)) {
    await setStatus(ctx, ticket, STATUS.needsHuman);
    await ctx.tracker.comment(
      ticket.number,
      `## 🤖 Needs your help\n\nThis ticket is \`${STATUS.inReview}\` but has no open agent PR (was it closed without merging?). Set it back to \`${STATUS.ready}\` for a fresh attempt, or close the ticket.`,
    );
    repaired++;
  }
  return repaired;
}

export async function cmdPick(ctx: Ctx, args: Args): Promise<void> {
  let snapshot = await loadSnapshot(ctx.tracker, META.runLog, trustedAuthors(ctx));
  const fixed = (await recoverOrphans(ctx, snapshot)) + (await repairStuckStates(ctx, snapshot));
  if (fixed > 0) snapshot = await loadSnapshot(ctx.tracker, META.runLog, trustedAuthors(ctx));
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

const WRITE_PERMISSIONS = ['admin', 'maintain', 'write'];

/**
 * The feedback a fix pass works from: the newest "changes requested" by the reviewer agent or a
 * maintainer (the same reviewers whose requests start a fix pass), with its line comments.
 * Anyone can review on a public repo, so other reviews are ignored.
 */
async function reviewFeedback(ctx: Ctx, pr: number): Promise<string> {
  const requests = (await ctx.prs.reviews(pr))
    .filter((r) => r.state === 'CHANGES_REQUESTED')
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  for (const r of requests) {
    const agent = r.author === REVIEWER_LOGIN;
    if (!agent && !WRITE_PERMISSIONS.includes(await ctx.permissionOf(r.author))) continue;
    const lines = (await ctx.prs.reviewComments(pr, r.id)).map(
      (c) => `- \`${c.path}${c.line === null ? '' : `:${String(c.line)}`}\`: ${c.body}`,
    );
    return [
      `Changes requested by @${r.author} (${agent ? 'the reviewer agent' : 'a maintainer'}):`,
      '',
      r.body.trim() || '(no summary)',
      ...(lines.length ? ['', '### Line comments', '', ...lines] : []),
    ].join('\n');
  }
  return '(No reviewer feedback found.)';
}

export async function cmdWorkerStart(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const mode = args['mode'] as PickMode;
  const pr = optionalInt(args, 'pr');
  const ticket = await ctx.tracker.getTicket(issue);
  const bot = botLogin(ctx);

  let prHeadRef: string | null = null;
  if (mode === 'fix' && pr) {
    prHeadRef = (await ctx.prs.get(pr)).headRef;
    writeOut(ctx, 'review-feedback.md', await reviewFeedback(ctx, pr));
  }
  if (mode === 'implement' && sizeOf(ticket.labels) === 'M') {
    // Implement exactly the plan the reviewer approved: its comment id is recorded in the approval.
    const comments = (await ctx.tracker.listComments(issue)).filter((c) => c.author === bot);
    const approval = comments
      .map((c) => /<!-- mm:approved-plan:(\d+) -->/.exec(c.body)?.[1])
      .filter(Boolean)
      .at(-1);
    const plan = approval ? comments.find((c) => c.id === Number(approval)) : undefined;
    writeOut(ctx, 'approved-plan.md', plan?.body ?? '(No approved plan found.)');
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
  // Never reuse a branch that already exists (e.g. WIP pushed by an earlier run): no force-pushes.
  const branch =
    mode !== 'fix' && (await ctx.prs.branchExists(plan.branch))
      ? `${plan.branch}-r${ctx.env['GITHUB_RUN_ID'] ?? String(ctx.now.getTime())}`
      : plan.branch;
  await ctx.tracker.comment(issue, plan.comment);
  await applyLabels(ctx, issue, plan.labels);
  ctx.output('branch', branch);
  ctx.output('attempt', String(plan.attempt));
  ctx.output('allow_golden', plan.allowGolden ? '1' : '0');
  ctx.output('size', sizeOf(ticket.labels) ?? '');
}

// ---------- worker: package the LLM job's result (untrusted job) ----------

export interface WorkResult {
  readonly hooksLoaded: boolean;
  /** Advisory only: computed inside the LLM job. CI on the PR is the real gate. */
  readonly checkPassed: boolean;
  readonly conflict: boolean;
  /** Why the fix pass couldn't start: "merge" (conflicts with main) or "workflows". */
  readonly conflictReason?: string;
  readonly commits: number;
  readonly exec: ExecutionSummary;
}

const OUT_FILES = ['pr-body.md', 'plan.md', 'escalation.md', 'follow-ups.json'];

/** Packages the agent's commits (as a git bundle) and outputs for the trusted finish job. */
export function cmdWorkResult(ctx: Ctx, args: Args): void {
  // Measure the workspace before writing anything: the output dir may be inside the checkout.
  // Only commits are shipped, so a pass counts only if nothing is left uncommitted.
  const fingerprint = ctx.fingerprint();
  const committed = ctx.git.run(['status', '--porcelain', '--untracked-files=all']).trim() === '';
  const dir = args['out-dir'] ?? join(ctx.root, 'result');
  const base = args['base'] ?? 'origin/main';
  mkdirSync(join(dir, 'out'), { recursive: true });
  const commits = Number(ctx.git.run(['rev-list', '--count', `${base}..HEAD`]).trim()) || 0;
  if (commits > 0) ctx.git.run(['bundle', 'create', join(dir, 'agent.bundle'), `${base}..HEAD`]);
  for (const name of OUT_FILES) {
    const src = join(outDir(ctx), name);
    if (existsSync(src)) copyFileSync(src, join(dir, 'out', name));
  }
  const checkPass = readFile(join(stateDir(ctx), 'check-pass'))?.trim();
  const result: WorkResult = {
    hooksLoaded: args['hooks-loaded'] === 'true',
    checkPassed: checkPass !== undefined && checkPass === fingerprint && committed,
    conflict: args['conflict'] === 'true',
    conflictReason: args['conflict-reason'] === 'workflows' ? 'workflows' : 'merge',
    commits,
    exec: execSummary(ctx),
  };
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  ctx.summary(
    `Packaged ${String(commits)} commit(s); hooks ${result.hooksLoaded ? 'loaded' : 'MISSING'}; check ${result.checkPassed ? 'passed' : 'not passed'}.`,
  );
}

// ---------- worker: finish (trusted job) ----------

interface FollowUp {
  title: string;
  why: string;
}

async function createFollowUps(
  ctx: Ctx,
  raw: string | null,
  issue: number,
  pr: number,
): Promise<number[]> {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  const items: FollowUp[] = parsed.flatMap((x: unknown) => {
    if (typeof x !== 'object' || x === null) return [];
    const { title, why } = x as Record<string, unknown>;
    return typeof title === 'string' && title.trim()
      ? [{ title: title.trim(), why: typeof why === 'string' ? why : '' }]
      : [];
  });
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

const WORK_REF = 'refs/agent/work';

/**
 * A fix pass starts by merging main into the PR branch (in the work job). That merge commit is
 * not the agent's work, so when the first new commit is exactly such a merge (first parent = the
 * branch tip, second parent already on main), the agent's own changes are counted from it.
 */
function agentWorkBase(ctx: Ctx, branchRef: string): string {
  const first = ctx.git
    .run(['rev-list', '--first-parent', '--reverse', `${branchRef}..${WORK_REF}`])
    .split('\n')[0]
    ?.trim();
  if (!first) return branchRef;
  const [, ...parents] = ctx.git.run(['rev-list', '--parents', '-n', '1', first]).trim().split(' ');
  const tip = ctx.git.run(['rev-parse', branchRef]).trim();
  if (parents.length !== 2 || parents[0] !== tip || !parents[1]) return branchRef;
  try {
    ctx.git.run(['merge-base', '--is-ancestor', parents[1], 'origin/main']);
    return first;
  } catch {
    return branchRef;
  }
}

const PICK_MODES: readonly string[] = ['implement', 'plan', 'fix'];

export async function cmdWorkerFinish(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  let message: string | null = null;
  try {
    await finishWorker(ctx, args, await ctx.tracker.getTicket(issue));
  } catch (error) {
    // Whatever went wrong, never leave the ticket stuck in status:in-progress.
    message = redact(error instanceof Error ? error.message : String(error));
    try {
      // Re-read: the failed step may already have changed the labels.
      const fresh = await ctx.tracker.getTicket(issue);
      await setStatus(ctx, fresh, STATUS.needsHuman);
      await ctx.tracker.comment(
        issue,
        `## 🤖 Needs your help\n\nThe worker's bookkeeping failed: \`${message.slice(0, 300)}\`. Nothing more will happen on this ticket until you look. [Run](${ctx.runUrl})`,
      );
      // Counted like any started run (daily cap, digest), so a recurring crash can't loop freely.
      const mode = args['mode'] ?? '';
      await appendRunLog(ctx, {
        role: 'worker',
        issue,
        mode: PICK_MODES.includes(mode) ? (mode as PickMode) : null,
        size: sizeOf(fresh.labels),
        attempt: optionalInt(args, 'attempt'),
        outcome: 'needs-human',
        note: `finish step error: ${message}`.slice(0, 500),
      });
    } catch {
      // Best effort: the original error below is what matters.
    }
  }
  // Re-thrown redacted (and outside the catch, so the raw error can't ride along as a cause).
  if (message !== null) throw new Error(message);
}

async function finishWorker(ctx: Ctx, args: Args, ticket: Ticket): Promise<void> {
  const issue = ticket.number;
  const mode = args['mode'] as PickMode;
  const branch = args['branch'] ?? '';
  const prArg = optionalInt(args, 'pr');
  const attempt = optionalInt(args, 'attempt') ?? 1;
  const dir = args['result-dir'] ?? join(ctx.root, 'result');
  const workSucceeded = args['work-result'] === 'success';
  const result = parseJson(readFile(join(dir, 'result.json'))) as WorkResult | null;
  const out = (name: string): string | null => readFile(join(dir, 'out', name));
  const size = sizeOf(ticket.labels);
  const stats = result
    ? {
        turns: result.exec.turns,
        costUsd: result.exec.costUsd,
        durationSec: result.exec.durationSec,
      }
    : {};
  const log = { role: 'worker' as const, issue, mode, size, attempt, ...stats };
  const workResult = args['work-result'] ?? 'unknown';

  const requeue = async (reason: string): Promise<void> => {
    await setStatus(ctx, ticket, mode === 'fix' ? STATUS.inReview : STATUS.ready);
    await ctx.tracker.comment(
      issue,
      `⚠️ Infrastructure problem: ${reason}. Nothing was pushed and this attempt was not counted; the ticket is back in the queue. Repeated infrastructure failures stop the worker (circuit breaker). [Run](${ctx.runUrl})`,
    );
    await appendRunLog(ctx, {
      ...log,
      outcome: 'infra-failure',
      note: `infra: ${reason}`.slice(0, 500),
    });
  };

  if (workResult !== 'success' && args['paused'] === 'true') {
    // The owner pulled the kill switch before the agent ran: not a failure of any kind.
    ctx.output('outcome', 'paused');
    await setStatus(ctx, ticket, mode === 'fix' ? STATUS.inReview : STATUS.ready);
    await ctx.tracker.comment(
      issue,
      `⏸️ The agent loop was paused before this run's agent started. Re-queued; nothing was counted. [Run](${ctx.runUrl})`,
    );
    return;
  }
  if (!branch || workResult === 'skipped') {
    ctx.output('outcome', 'infra-failure');
    await requeue(
      `the agent job never started (${branch ? workResult : 'the start step did not prepare a branch'})`,
    );
    return;
  }

  // Bring the agent's commits in as git objects only: fetched into a private ref, never checked out.
  const base = mode === 'fix' ? `origin/${branch}` : 'origin/main';
  if (mode === 'fix') {
    ctx.git.run([
      'fetch',
      '--no-tags',
      'origin',
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
  }
  let hasChanges = false;
  let guard: string[] = [];
  const bundle = join(dir, 'agent.bundle');
  if (mode !== 'plan' && existsSync(bundle)) {
    ctx.git.run(['bundle', 'verify', bundle]);
    ctx.git.run(['fetch', '--no-tags', bundle, `+HEAD:${WORK_REF}`]);
    const since = mode === 'fix' ? agentWorkBase(ctx, base) : base;
    const agentCommits = Number(
      ctx.git.run(['rev-list', '--count', `${since}..${WORK_REF}`]).trim(),
    );
    // A fix pass whose only new commit is the merge of main still ships it once the check passed
    // on it: the red CI may have been fixed on main itself (a flaky test, a tooling fix).
    hasChanges = agentCommits > 0 || (since !== base && result?.checkPassed === true);
    const diff = ctx.git.run(['diff', '--name-status', '-M', `origin/main...${WORK_REF}`]);
    guard = [
      ...findViolations(parseNameStatus(diff), ctx.config, ticket.labels.includes(PHYSICS_CHANGE)),
      ...modeViolations(ctx.git.run(['diff', '--raw', '-M', `origin/main...${WORK_REF}`])),
    ];
  }

  const escalation = !result?.conflict
    ? out('escalation.md')
    : result.conflictReason === 'workflows'
      ? `main has changed workflow files since \`${branch}\` was created. The bot can't push those (it has no Workflows permission), and fixing without them would run outdated tooling. Please merge main into the branch, then set the ticket back to \`${STATUS.inReview}\`.`
      : `The PR branch \`${branch}\` conflicts with main, so the fix pass could not start. Please resolve the conflict (merge main into the branch), then set the ticket back to \`${STATUS.inReview}\`.`;
  let decision = decideWorkerOutcome({
    mode,
    escalated: escalation !== null,
    planText: out('plan.md'),
    hasChanges,
    checkPassed: result?.checkPassed ?? false,
    claudeSubtype: result?.exec.subtype ?? null,
    claudeErrored: result?.exec.isError ?? true,
    hooksLoaded: (workSucceeded && result?.hooksLoaded === true) || result?.conflict === true,
  });
  if (decision.outcome === 'infra-failure' && !workSucceeded && !result?.conflict) {
    decision = { ...decision, reason: `the agent job did not complete (${workResult})` };
  }
  if ((decision.outcome === 'pr-opened' || decision.outcome === 'fix-pushed') && guard.length > 0) {
    decision = {
      outcome: 'failed',
      reason: `the change touches paths only the owner may change: ${guard.join('; ')}`,
    };
  }
  const canPushWip = hasChanges && guard.length === 0 && mode !== 'fix';
  ctx.output('outcome', decision.outcome);

  switch (decision.outcome) {
    case 'infra-failure': {
      await requeue(decision.reason);
      return;
    }
    case 'escalated': {
      if (canPushWip) ctx.push(WORK_REF, branch);
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
      await ctx.tracker.comment(issue, planComment(out('plan.md') ?? ''));
      await applyLabels(ctx, issue, {
        add: [PLAN.proposed, STATUS.ready],
        remove: [STATUS.inProgress],
      });
      await appendRunLog(ctx, { ...log, outcome: 'plan-posted' });
      return;
    }
    case 'pr-opened': {
      ctx.push(WORK_REF, branch);
      const pr = await ctx.prs.create({
        title: prTitle(ticket),
        body: finalizePrBody(out('pr-body.md'), issue, ctx.runUrl),
        head: branch,
        base: 'main',
      });
      await ctx.tracker.addLabels(pr.number, prLabelsFromTicket(ticket.labels));
      await applyLabels(ctx, issue, { add: [STATUS.inReview], remove: [STATUS.inProgress] });
      const followUps = await createFollowUps(ctx, out('follow-ups.json'), issue, pr.number);
      await ctx.tracker.comment(
        issue,
        `🤖 Opened ${pr.url} for review.${followUps.length ? ` Proposed follow-ups: ${followUps.map((n) => `#${String(n)}`).join(', ')}.` : ''}`,
      );
      ctx.output('pr', String(pr.number));
      await appendRunLog(ctx, { ...log, pr: pr.number, outcome: 'pr-opened' });
      return;
    }
    case 'fix-pushed': {
      ctx.push(WORK_REF, branch);
      const body = out('pr-body.md');
      if (prArg && body) await ctx.prs.updateBody(prArg, finalizePrBody(body, issue, ctx.runUrl));
      await applyLabels(ctx, issue, { add: [STATUS.inReview], remove: [STATUS.inProgress] });
      if (prArg) {
        await ctx.tracker.comment(
          prArg,
          `🤖 Pushed fixes for the review feedback (attempt ${String(attempt)}). [Run](${ctx.runUrl})`,
        );
      }
      await appendRunLog(ctx, { ...log, pr: prArg, outcome: 'fix-pushed' });
      return;
    }
    case 'failed': {
      if (canPushWip) ctx.push(WORK_REF, branch);
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
          `## 🤖 Needs your help\n\nAttempt ${String(attempt)}/${String(ctx.config.maxAttemptsPerTicket)} failed: ${decision.reason}. No attempts left.${where}\n\nLook at the [run](${ctx.runUrl}), clarify the ticket, remove the \`agent:attempt-*\` label for a fresh budget, and set it back to \`${STATUS.ready}\`.`,
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

function checksMarkdown(runs: readonly CheckRun[]): string {
  return (
    runs.map((r) => `- ${r.name}: ${r.conclusion ?? r.status}`).join('\n') ||
    '- (no checks reported)'
  );
}

/** Runs in the read-only review job (GITHUB_TOKEN). Writes review/*.md for the LLM. */
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
  // A branch name is not a trust signal: only PRs the bot opened from this repository.
  const bot = botLogin(ctx);
  if (pr.headRepo !== ctx.repo || !(bot ? pr.author === bot : pr.author.endsWith('[bot]'))) {
    skip('not opened by the bot from this repository');
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
    `# CI for ${pr.headSha}\n\n${checksMarkdown(await ctx.checks.checkRuns(pr.headSha))}\n`,
  );
  ctx.output('skip', 'false');
  ctx.output('issue', String(issue));
  ctx.output('head_sha', pr.headSha);
  ctx.output('ci_green', ci.green ? 'true' : 'false');
  ctx.output('ci_failing', ci.failing.join(','));
  ctx.output('ci_pending', ci.pending.join(','));
}

/** Marks a review that only reported red CI: a later green re-run still deserves a real review. */
const CI_RED_MARKER = '<!-- mm:ci-red -->';
const reviewFailedMarker = (sha: string): string => `<!-- mm:review-failed:${sha} -->`;

export async function cmdReviewFinish(ctx: Ctx, args: Args): Promise<void> {
  const prNumber = requireInt(args, 'pr');
  const issue = requireInt(args, 'issue');
  const reviewedSha = args['sha'] ?? '';
  const pr = await ctx.prs.get(prNumber);
  ctx.output('approved', 'false');
  if (!reviewedSha || pr.headSha !== reviewedSha) {
    ctx.summary(
      `Review of ${reviewedSha.slice(0, 7) || '?'} superseded by ${pr.headSha.slice(0, 7)}; its own CI run will trigger a new review.`,
    );
    return;
  }
  const ciGreen = ctx.env['CI_GREEN'] === 'true';
  const ticket = await ctx.tracker.getTicket(issue);
  const prior = (await ctx.prs.reviews(prNumber)).filter(
    (r) => r.author === REVIEWER_LOGIN && r.commitId === reviewedSha,
  );
  // One real review per commit. A CI-red notice doesn't count once CI is green again (a flaky
  // run that was re-run), but the attempt it charged is not charged twice.
  if (prior.some((r) => !r.body.includes(CI_RED_MARKER)) || (prior.length > 0 && !ciGreen)) {
    ctx.summary(
      `${reviewedSha.slice(0, 7)} was already reviewed; not reviewing (or counting an attempt) twice.`,
    );
    return;
  }
  const alreadyCharged = prior.length > 0;
  const attempt = Math.max(attemptOf(ticket.labels), 1);
  const log = {
    role: 'reviewer' as const,
    issue,
    pr: prNumber,
    mode: 'review-pr' as const,
    size: sizeOf(ticket.labels),
    attempt,
    ...execStats(ctx),
  };

  let verdict;
  if (!ciGreen) {
    const csv = (key: string): string[] => (ctx.env[key] ?? '').split(',').filter(Boolean);
    verdict = ciFailureVerdict({
      green: false,
      failing: csv('CI_FAILING'),
      pending: csv('CI_PENDING'),
    });
  } else {
    const parsed = PrVerdictSchema.safeParse(parseJson(ctx.env['VERDICT_JSON']));
    if (!parsed.success) {
      await ctx.tracker.comment(
        prNumber,
        `${reviewFailedMarker(reviewedSha)}\n⚠️ The reviewer agent did not return a valid verdict, so nothing was approved. Re-run **Agent Review** for this PR. [Run](${ctx.runUrl})`,
      );
      await appendRunLog(ctx, {
        ...log,
        outcome: 'failed',
        note: 'reviewer returned no valid verdict',
      });
      return;
    }
    verdict = enforceConsistency(parsed.data);
  }

  const body = `${prReviewBody(verdict, attempt, ctx.config.maxAttemptsPerTicket)}${ciGreen ? '' : `\n\n${CI_RED_MARKER}`}`;
  if (verdict.verdict === 'approve') {
    // Label first: its labeled event re-runs agent-guard, which the merge gate then waits for.
    await ctx.tracker.addLabels(prNumber, [AGENT_APPROVED]);
    await ctx.reviewPrs.submitReview(prNumber, reviewedSha, 'APPROVE', body);
    ctx.output('approved', 'true');
    await appendRunLog(ctx, { ...log, outcome: 'approved' });
    return;
  }
  if (alreadyCharged) {
    // CI was red on this commit before and that already cost an attempt.
    await ctx.reviewPrs.submitReview(prNumber, reviewedSha, 'REQUEST_CHANGES', body);
    await ctx.tracker.removeLabel(prNumber, AGENT_APPROVED);
    await appendRunLog(ctx, {
      ...log,
      outcome: 'changes-requested',
      note: 'attempt already counted (CI was red on this commit)',
    });
    return;
  }
  // Count the attempt before submitting: if the run dies in between, the worst case is an attempt
  // counted twice (the ticket reaches the owner sooner), never a free extra attempt.
  const bump = planAttemptBump({
    labels: ticket.labels,
    maxAttempts: ctx.config.maxAttemptsPerTicket,
    backToStatus: STATUS.inReview,
  });
  await ctx.tracker.removeLabel(prNumber, AGENT_APPROVED);
  await applyLabels(ctx, issue, bump.labels);
  await ctx.reviewPrs.submitReview(prNumber, reviewedSha, 'REQUEST_CHANGES', body);
  if (bump.exhausted) {
    await ctx.tracker.comment(
      issue,
      `## 🤖 Needs your help\n\nThe reviewer requested changes on #${String(prNumber)} and the worker has no attempts left. Decide whether to fix it yourself, clarify the ticket (remove \`agent:attempt-*\` for a fresh budget), or close the PR.`,
    );
    await appendRunLog(ctx, {
      ...log,
      outcome: 'needs-human',
      note: `LESSON DRAFT: review rejected #${String(prNumber)} on the last attempt: ${verdict.summary}`.slice(
        0,
        500,
      ),
    });
    return;
  }
  await appendRunLog(ctx, { ...log, outcome: 'changes-requested' });
}

function latestBotPlan<C extends { id: number; body: string; author: string }>(
  ctx: Ctx,
  comments: readonly C[],
): C | undefined {
  const bot = botLogin(ctx);
  return comments.filter((c) => c.author === bot && c.body.includes(PLAN_MARKER)).at(-1);
}

const planReviewMarker = (planId: number): string => `<!-- mm:plan-review:${String(planId)} -->`;

/** How long after CI finishes (or a plan is posted) the hourly sweep treats a review as missed. */
const reviewGraceMs = (ctx: Ctx): number => Number(ctx.env['REVIEW_GRACE_MS'] ?? 30 * 60_000);

/** Automatic re-runs per commit (or per plan) before a review that never completes goes to the owner. */
export const MAX_REVIEW_SWEEPS = 2;
const sweptMarker = (sha: string): string => `<!-- mm:review-swept:${sha} -->`;
const planSweptMarker = (planId: number): string =>
  `<!-- mm:plan-review-swept:${String(planId)} -->`;

function isGone(error: unknown): boolean {
  return error instanceof GhApiError && [404, 410].includes(error.status ?? 0);
}

/**
 * Hourly sweep (trusted job, no LLM): finds the oldest agent PR head and the oldest plan whose
 * review never completed (a dropped event, a pause, a failed run) and outputs them as `pr` and
 * `issue` for this run's review jobs. Every retry is recorded on the PR or ticket; after
 * MAX_REVIEW_SWEEPS the ticket goes to the owner instead, and the sweep moves on to the next one.
 */
export async function cmdReviewSweep(ctx: Ctx): Promise<void> {
  const bot = botLogin(ctx);
  const byBot = (author: string): boolean => (bot ? author === bot : author.endsWith('[bot]'));
  const aged = (iso: string): boolean =>
    ctx.now.getTime() - new Date(iso).getTime() >= reviewGraceMs(ctx);
  ctx.output('pr', '');
  ctx.output('issue', '');

  const prs = (await ctx.tracker.listOpenPullRequests())
    .filter((pr) => isAgentPr(pr, bot) && !pr.isDraft)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const candidate of prs) {
    const issue = ticketOfPr(candidate);
    if (issue === null) continue;
    let ticket: Ticket;
    try {
      ticket = await ctx.tracker.getTicket(issue);
    } catch (error) {
      if (isGone(error)) continue; // the ticket was deleted or moved: nothing to review for
      throw error;
    }
    if (statusOf(ticket.labels) !== STATUS.inReview) continue;
    const pr = await ctx.prs.get(candidate.number);
    const sha = pr.headSha;
    const botReviews = (await ctx.prs.reviews(pr.number)).filter(
      (r) => r.author === REVIEWER_LOGIN && r.commitId === sha,
    );
    if (botReviews.some((r) => !r.body.includes(CI_RED_MARKER))) continue;
    const runs = latestRunPerName(await ctx.checks.checkRuns(sha));
    const ci = evaluateChecks(runs);
    if (ci.pending.length > 0) continue;
    if (botReviews.length > 0 && !ci.green) continue; // already told CI is red; a fix pass is next
    const finished =
      runs
        .map((r) => r.completedAt ?? '')
        .sort()
        .at(-1) ?? '';
    if (!finished || !aged(finished)) continue; // its own CI-triggered review may still be coming
    const comments = await ctx.tracker.listComments(pr.number);
    if (comments.some((c) => byBot(c.author) && c.body.includes(reviewFailedMarker(sha)))) continue;
    const sweeps = comments.filter(
      (c) => byBot(c.author) && c.body.includes(sweptMarker(sha)),
    ).length;
    if (sweeps >= MAX_REVIEW_SWEEPS) {
      await setStatus(ctx, ticket, STATUS.needsHuman);
      await ctx.tracker.comment(
        issue,
        `## 🤖 Needs your help\n\nThe review of PR #${String(pr.number)} (\`${sha.slice(0, 7)}\`) never completed, even after ${String(MAX_REVIEW_SWEEPS)} automatic retries. Look at the recent **Agent Review** runs, re-run it by hand (Actions → Agent Review → PR number), and set this ticket back to \`${STATUS.inReview}\`.`,
      );
      continue;
    }
    await ctx.tracker.comment(
      pr.number,
      `${sweptMarker(sha)}\n🔁 The review of \`${sha.slice(0, 7)}\` never completed; re-running it (retry ${String(sweeps + 1)}/${String(MAX_REVIEW_SWEEPS)}). [Run](${ctx.runUrl})`,
    );
    ctx.output('pr', String(pr.number));
    break;
  }

  const tickets = (await ctx.tracker.listOpenTickets())
    .filter((t) => t.labels.includes(PLAN.proposed))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const ticket of tickets) {
    const comments = await ctx.tracker.listComments(ticket.number);
    const plan = latestBotPlan(ctx, comments);
    if (!plan || !aged(plan.createdAt)) continue;
    const mine = comments.filter((c) => byBot(c.author));
    if (mine.some((c) => c.body.includes(planReviewMarker(plan.id)))) continue;
    const sweeps = mine.filter((c) => c.body.includes(planSweptMarker(plan.id))).length;
    if (sweeps >= MAX_REVIEW_SWEEPS) {
      await setStatus(ctx, ticket, STATUS.needsHuman);
      await ctx.tracker.comment(
        ticket.number,
        `## 🤖 Needs your help\n\nThe review of the latest plan never completed, even after ${String(MAX_REVIEW_SWEEPS)} automatic retries. Look at the recent **Agent Review** runs, re-run it by hand (Actions → Agent Review → issue number), and set this ticket back to \`${STATUS.ready}\`.`,
      );
      continue;
    }
    await ctx.tracker.comment(
      ticket.number,
      `${planSweptMarker(plan.id)}\n🔁 The plan review never completed; re-running it (retry ${String(sweeps + 1)}/${String(MAX_REVIEW_SWEEPS)}). [Run](${ctx.runUrl})`,
    );
    ctx.output('issue', String(ticket.number));
    break;
  }
}

/** Runs in the read-only plan-review job (GITHUB_TOKEN). */
export async function cmdPlanReviewContext(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const ticket = await ctx.tracker.getTicket(issue);
  const plan = latestBotPlan(ctx, await ctx.tracker.listComments(issue));
  if (!ticket.labels.includes(PLAN.proposed) || !plan) {
    ctx.output('skip', 'true');
    return;
  }
  writeOut(ctx, 'review/ticket.md', `# #${String(issue)}: ${ticket.title}\n\n${ticket.body}\n`);
  writeOut(ctx, 'review/plan.md', plan.body);
  ctx.output('skip', 'false');
  ctx.output('plan_id', String(plan.id));
}

export async function cmdPlanReviewFinish(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const planId = requireInt(args, 'plan-id');
  const ticket = await ctx.tracker.getTicket(issue);
  const log = {
    role: 'reviewer' as const,
    issue,
    mode: 'review-plan' as const,
    size: sizeOf(ticket.labels),
    attempt: Math.max(attemptOf(ticket.labels), 1),
    ...execStats(ctx),
  };
  if (latestBotPlan(ctx, await ctx.tracker.listComments(issue))?.id !== planId) {
    ctx.summary('A newer plan was posted after this review started; not applying a stale verdict.');
    return;
  }
  const marker = planReviewMarker(planId);
  const parsed = PlanVerdictSchema.safeParse(parseJson(ctx.env['VERDICT_JSON']));
  if (!parsed.success) {
    await ctx.tracker.comment(
      issue,
      `${marker}\n⚠️ The reviewer agent did not return a valid plan verdict. Re-run **Agent Review** for this issue. [Run](${ctx.runUrl})`,
    );
    await appendRunLog(ctx, {
      ...log,
      outcome: 'failed',
      note: 'reviewer returned no valid plan verdict',
    });
    return;
  }
  const v =
    parsed.data.verdict === 'approve' && parsed.data.issues.length > 0
      ? { ...parsed.data, verdict: 'request_changes' as const }
      : parsed.data;
  if (v.verdict === 'approve') {
    await ctx.tracker.comment(
      issue,
      `${planReviewComment(v)}\n\n${marker}\n<!-- mm:approved-plan:${String(planId)} -->`,
    );
    await applyLabels(ctx, issue, { add: [PLAN.approved], remove: [PLAN.proposed] });
    await appendRunLog(ctx, { ...log, outcome: 'plan-approved' });
    return;
  }
  await ctx.tracker.comment(issue, `${planReviewComment(v)}\n\n${marker}`);
  const bump = planAttemptBump({
    labels: ticket.labels,
    maxAttempts: ctx.config.maxAttemptsPerTicket,
    backToStatus: STATUS.ready,
  });
  await applyLabels(ctx, issue, {
    add: bump.labels.add,
    remove: [PLAN.proposed, ...bump.labels.remove],
  });
  if (bump.exhausted) {
    await ctx.tracker.comment(
      issue,
      '## 🤖 Needs your help\n\nThe plan was rejected and the worker has no attempts left. Please clarify the ticket (remove `agent:attempt-*` for a fresh budget).',
    );
    await appendRunLog(ctx, {
      ...log,
      outcome: 'needs-human',
      note: `LESSON DRAFT: plan rejected on the last attempt: ${v.summary}`.slice(0, 500),
    });
    return;
  }
  await appendRunLog(ctx, { ...log, outcome: 'plan-changes-requested' });
}

// ---------- merger ----------

async function mergeOne(ctx: Ctx, prNumber: number): Promise<void> {
  const pr = await ctx.prs.get(prNumber);
  const decision = decideMerge({
    pr,
    ci: await waitForChecks(ctx, pr.headSha),
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

  const humanComment = async (reasons: readonly string[]): Promise<void> => {
    // Only the bot's own notice counts: anyone could post the markers on a public repo.
    const bot = botLogin(ctx);
    const already = (await ctx.tracker.listComments(prNumber)).some(
      (c) =>
        (bot ? c.author === bot : c.author.endsWith('[bot]')) &&
        c.body.includes(HUMAN_MERGE_MARKER) &&
        c.body.includes(`<!-- sha:${pr.headSha} -->`),
    );
    if (already) return;
    await ctx.tracker.comment(prNumber, humanMergeComment(pr.headSha, reasons));
    await appendRunLog(ctx, {
      ...log,
      outcome: 'ready-for-human',
      note: reasons.join('; ').slice(0, 500),
    });
  };

  if (decision.action === 'merge') {
    try {
      await ctx.prs.squashMerge(
        prNumber,
        pr.headSha,
        pr.title.replace(/\s*\(#\d+\)$/, ''),
        `${issue === null ? '' : `Closes #${String(issue)}\n\n`}Auto-merged by the merge gate after the reviewer approved ${pr.headSha.slice(0, 7)}.`,
      );
    } catch (error) {
      const why = redact(error instanceof Error ? error.message : String(error));
      await humanComment([`auto-merge was attempted but GitHub refused: ${why.slice(0, 300)}`]);
      return;
    }
    await appendRunLog(ctx, { ...log, outcome: 'merged' });
    return;
  }
  if (decision.action === 'human') await humanComment(decision.reasons);
}

export async function cmdMerge(ctx: Ctx, args: Args): Promise<void> {
  await mergeOne(ctx, requireInt(args, 'pr'));
}

/** Re-evaluates every approved agent PR (e.g. after autonomyLevel changes or a check re-run). */
export async function cmdMergeSweep(ctx: Ctx): Promise<void> {
  const prs = await ctx.prs.openAgentPrsWithLabel(AGENT_APPROVED);
  for (const pr of prs) await mergeOne(ctx, pr.number);
  if (prs.length === 0) ctx.summary('No approved agent PRs to evaluate.');
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

const SPLIT_MARKER = /<!-- mm:split:([\d,]*) -->/;

export async function cmdRefineFinish(ctx: Ctx, args: Args): Promise<void> {
  const issue = requireInt(args, 'issue');
  const ticket = await ctx.tracker.getTicket(issue);
  const log = { role: 'refiner' as const, issue, mode: 'refine' as const, ...execStats(ctx) };
  const parsed = RefinementSchema.safeParse(parseJson(ctx.env['REFINEMENT_JSON']));
  if (!parsed.success) {
    await ctx.tracker.comment(
      issue,
      `⚠️ The refiner did not return a valid result. Re-apply \`${STATUS.needsRefinement}\` to retry. [Run](${ctx.runUrl})`,
    );
    await setStatus(ctx, ticket, STATUS.needsHuman);
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
    await setStatus(ctx, ticket, STATUS.needsHuman);
    await appendRunLog(ctx, { ...log, outcome: 'needs-human' });
    return;
  }
  const comments = await ctx.tracker.listComments(issue);
  const bot = botLogin(ctx);
  if (!comments.some((c) => c.body.includes('Original request (before refinement)'))) {
    await ctx.tracker.comment(issue, originalTextComment(ticket.title, ticket.body));
  }
  if (action.kind === 'ready') {
    await ctx.tracker.updateTicket(issue, { title: action.title, body: action.body });
    // New criteria invalidate any earlier plan: an M ticket gets planned and reviewed again.
    await applyLabels(ctx, issue, {
      add: action.labels.add.filter((l) => l !== STATUS.ready),
      remove: [
        ...action.labels.remove,
        ...[PLAN.approved, PLAN.proposed].filter((l) => ticket.labels.includes(l)),
      ],
    });
    await setStatus(ctx, await ctx.tracker.getTicket(issue), STATUS.ready);
    await ctx.tracker.comment(issue, action.comment);
    await appendRunLog(ctx, { ...log, size: sizeOf(action.labels.add), outcome: 'refined' });
    return;
  }

  // Split: children are created outside the queue (status:proposed) and promoted only once all
  // exist; progress is recorded on the parent so a retry reuses them instead of duplicating.
  const recorded = comments
    .filter((c) => !bot || c.author === bot)
    .map((c) => SPLIT_MARKER.exec(c.body)?.[1])
    .filter(Boolean)
    .at(-1);
  const numbers: number[] = recorded ? recorded.split(',').filter(Boolean).map(Number) : [];
  try {
    for (const [i, child] of action.children.entries()) {
      if (numbers[i]) continue;
      const dependencies = [
        ...child.spec.dependencies,
        ...child.dependsOnChildren.map((d) => numbers[d] ?? 0).filter((n) => n > 0),
      ];
      const spec = { ...child.spec, dependencies };
      numbers[i] = await ctx.tracker.createTicket({
        title: child.title,
        body: `${renderTicketBody(spec)}\n_Split from #${String(issue)} by the refiner._\n`,
        labels: [
          `size:${spec.size}`,
          `priority:${spec.priority}`,
          `type:${spec.type}`,
          STATUS.proposed,
        ],
      });
    }
  } finally {
    await ctx.tracker.comment(
      issue,
      `<!-- mm:split:${numbers.join(',')} -->\n🤖 Split progress: ${numbers.map((n) => `#${String(n)}`).join(', ') || 'none yet'}`,
    );
  }
  for (const n of numbers)
    await applyLabels(ctx, n, { add: [STATUS.ready], remove: [STATUS.proposed] });
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
  const authors = trustedAuthors(ctx);
  const comments = logIssue ? await ctx.tracker.listComments(logIssue.number) : [];
  const entries = parseRunLog(
    comments
      .filter((c) => (authors.length ? authors.includes(c.author) : c.author.endsWith('[bot]')))
      .map((c) => c.body),
  );
  const day = 86_400_000;
  const iso = (daysAgo: number): string =>
    new Date(ctx.now.getTime() - daysAgo * day).toISOString();
  const humanEdited = new Set<number>();
  const checked = new Set<number>();
  for (const pr of prsToCheck(entries)) {
    const prAuthors = await ctx.prs.commitAuthors(pr);
    checked.add(pr);
    if (prAuthors.some((a) => !a.endsWith('[bot]'))) humanEdited.add(pr);
  }
  const metrics = weeklyMetrics(entries, ctx.now, await ctx.prs.revertsSince(iso(7)));
  const rec = recommendAutonomy({
    level: ctx.config.autonomyLevel,
    entries,
    now: ctx.now,
    reverts14d: await ctx.prs.revertsSince(iso(14)),
    humanEditedPrs: humanEdited,
    checkedPrs: checked,
  });
  const weekOf = iso(7).slice(0, 10);
  const title = `🤖 Weekly agent digest: week of ${weekOf}`;
  const body = digestBody(metrics, rec, ctx.config.autonomyLevel, weekOf);
  const existing = (await ctx.tracker.listTicketsByLabel(META.digest)).find(
    (t) => t.title === title && t.state === 'open',
  );
  let number: number;
  if (existing) {
    number = existing.number;
    await ctx.tracker.updateTicket(number, { body });
  } else {
    number = await ctx.tracker.createTicket({ title, body, labels: [META.digest] });
  }
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
}

/** The only files the digest may propose changes to. */
export const DIGEST_EDITABLE = ['CLAUDE.md', '.agent/LESSONS.md'];

/**
 * Runs in a trusted job on a fresh checkout. Only the two rulebook files are taken from the LLM
 * job's artifact (everything else in it is ignored), so the digest's scope holds by construction.
 */
export async function cmdDigestPr(ctx: Ctx, args: Args): Promise<void> {
  const digestIssue = optionalInt(args, 'digest-issue');
  const dir = args['result-dir'] ?? join(ctx.root, 'result');
  ctx.output('pr', '');
  for (const file of DIGEST_EDITABLE) {
    const proposed = readFile(join(dir, file));
    if (proposed !== null) writeFileSync(join(ctx.root, file), proposed);
  }
  const changed = ctx.git
    .run(['status', '--porcelain', '--', ...DIGEST_EDITABLE])
    .split('\n')
    .filter(Boolean);
  if (changed.length > 0) {
    const date = ctx.now.toISOString().slice(0, 10);
    const branch = `digest/${date}-${ctx.env['GITHUB_RUN_ID'] ?? 'local'}`;
    ctx.git.run(['switch', '-c', branch]);
    ctx.git.run(['add', '--', ...DIGEST_EDITABLE]);
    ctx.git.run(['commit', '-m', `docs(rules): weekly digest lesson updates (${date})`]);
    ctx.push('HEAD', branch);
    const pr = await ctx.prs.create({
      title: `docs(rules): weekly digest lesson updates (${date})`,
      body: `Proposed rulebook updates from recurring failures this week${digestIssue ? ` (see #${String(digestIssue)})` : ''}.\n\nThese are protected files: **you decide**. Merge, edit, or close.\n\n🤖 Opened by the digest agent · [run](${ctx.runUrl})`,
      head: branch,
      base: 'main',
    });
    ctx.output('pr', String(pr.number));
  }
  await appendRunLog(ctx, {
    role: 'digest',
    mode: 'digest',
    outcome: 'digest-opened',
    issue: digestIssue,
    note: changed.length ? 'rulebook PR opened' : 'no rulebook changes proposed',
    ...execStats(ctx),
  });
}

// ---------- misc ----------

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
    args['sha'] ? `Head commit: ${args['sha']}` : '',
    args['attempt'] ? `Attempt: ${args['attempt']}/${String(ctx.config.maxAttemptsPerTicket)}` : '',
  ].filter(Boolean);
  ctx.output('text', `${body.trim()}\n\n---\n${context.join('\n')}`.trim());
}

/** Outputs the per-role settings from agent.config.json for the workflow. */
export function cmdConfig(ctx: Ctx, args: Args): void {
  const role = args['role'] as 'refiner' | 'worker' | 'reviewer' | 'digest' | undefined;
  if (!role || !(role in ctx.config.maxTurns)) {
    throw new Error('--role must be refiner, worker, reviewer or digest');
  }
  ctx.output('model', ctx.config.models[role]);
  ctx.output('max_turns', String(ctx.config.maxTurns[role]));
  ctx.output('max_attempts', String(ctx.config.maxAttemptsPerTicket));
}

/** Outputs the LLM step's execution stats so a later (trusted) job can log them. */
export function cmdExecStats(ctx: Ctx): void {
  const e = execSummary(ctx);
  ctx.output('turns', e.turns === null ? '' : String(e.turns));
  ctx.output('cost_usd', e.costUsd === null ? '' : String(e.costUsd));
  ctx.output('duration_sec', e.durationSec === null ? '' : String(e.durationSec));
  ctx.output('subtype', e.subtype ?? '');
  ctx.output('is_error', e.isError ? 'true' : 'false');
}

export const COMMANDS: Readonly<Record<string, (ctx: Ctx, args: Args) => Promise<void> | void>> = {
  pick: cmdPick,
  'worker-start': cmdWorkerStart,
  'work-result': cmdWorkResult,
  'worker-finish': cmdWorkerFinish,
  'review-context': cmdReviewContext,
  'review-finish': cmdReviewFinish,
  'review-sweep': cmdReviewSweep,
  'plan-review-context': cmdPlanReviewContext,
  'plan-review-finish': cmdPlanReviewFinish,
  merge: cmdMerge,
  'merge-sweep': cmdMergeSweep,
  close: cmdClose,
  'refine-gate': cmdRefineGate,
  'refine-finish': cmdRefineFinish,
  'digest-report': cmdDigestReport,
  'digest-pr': cmdDigestPr,
  schema: cmdSchema,
  prompt: cmdPrompt,
  config: cmdConfig,
  'exec-stats': cmdExecStats,
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

/**
 * Git without hooks, global or system config: nothing in the workspace can run code through git.
 * Extra config travels in the environment (GIT_CONFIG_COUNT), never on the command line, and
 * errors carry only git's redacted stderr: a failed command must not echo a credential.
 */
function safeGit(
  root: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
  extraConfig: Readonly<Record<string, string>> = {},
): string {
  const extra = Object.entries(extraConfig);
  let detail: string;
  try {
    return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: String(extra.length),
        ...Object.fromEntries(
          extra.flatMap(([key, value], i) => [
            [`GIT_CONFIG_KEY_${String(i)}`, key],
            [`GIT_CONFIG_VALUE_${String(i)}`, value],
          ]),
        ),
      },
    });
  } catch (error) {
    // Never the error itself: its message repeats the full command line.
    const stderr = (error as { stderr?: unknown }).stderr;
    detail = typeof stderr === 'string' ? stderr.trim() : 'no output';
  }
  throw new Error(redact(`git ${args[0] ?? ''} failed: ${detail}`));
}

function realContext(env: NodeJS.ProcessEnv): Ctx {
  const repo = repoFromEnv(env);
  const bot = execGhClient(); // GH_TOKEN: the App token in trusted jobs, GITHUB_TOKEN in LLM jobs
  const reviewToken = env['REVIEW_TOKEN'];
  const checksToken = env['CHECKS_TOKEN'];
  const root = REPO_ROOT;
  return {
    repo,
    tracker: new GitHubTracker(bot, repo),
    prs: new GitHubPullRequests(bot, repo),
    reviewPrs: new GitHubPullRequests(
      reviewToken ? execGhClient({ GH_TOKEN: reviewToken }) : bot,
      repo,
    ),
    checks: new GitHubPullRequests(
      checksToken ? execGhClient({ GH_TOKEN: checksToken }) : bot,
      repo,
    ),
    config: loadAgentConfig(),
    root,
    now: new Date(),
    runUrl: `${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${repo}/actions/runs/${env['GITHUB_RUN_ID'] ?? '0'}`,
    git: { run: (a) => safeGit(root, env, a) },
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
    push: (ref, branch) => {
      const token = env['AGENT_BOT_TOKEN'];
      if (!token) throw new Error('AGENT_BOT_TOKEN is required to push');
      const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
      safeGit(
        root,
        env,
        ['push', `https://github.com/${repo}.git`, `${ref}:refs/heads/${branch}`],
        {
          'http.https://github.com/.extraheader': `AUTHORIZATION: basic ${auth}`,
        },
      );
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  if (!run) {
    throw new Error(`Unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(', ')}`);
  }
  await run(realContext(process.env), args);
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
