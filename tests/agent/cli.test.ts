/**
 * The workflow CLI end to end against an in-memory tracker, a fake PR host and a fake git.
 * These are the side effects the agent loop has on GitHub, so every branch matters.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cmdClose,
  cmdMerge,
  cmdConfig,
  cmdPick,
  cmdPrompt,
  cmdPlanReviewFinish,
  cmdRefineFinish,
  cmdRefineGate,
  cmdReviewContext,
  cmdReviewFinish,
  cmdSchema,
  cmdWorkerFinish,
  cmdWorkerStart,
  parseArgs,
  ticketNumberOfPr,
  toFileChanges,
  type Ctx,
  type PrHost,
} from '../../scripts/agent/cli.ts';
import { loadAgentConfig, type AgentConfig } from '../../scripts/agent/config.ts';
import type { CheckRun, PrInfo, Review } from '../../scripts/agent/github-pr.ts';
import { parseRunLog } from '../../scripts/agent/run-log.ts';
import { renderTicketBody } from '../../scripts/agent/ticket-format.ts';
import type {
  IssueComment,
  NewTicket,
  PullRequest,
  Ticket,
  TicketPatch,
  Tracker,
} from '../../scripts/agent/tracker/types.ts';

// ---------- fakes ----------

class FakeTracker implements Tracker {
  tickets = new Map<number, Ticket>();
  comments = new Map<number, IssueComment[]>();
  prs: PullRequest[] = [];
  next = 100;
  commentId = 1;

  seed(t: Partial<Ticket> & { number: number }): void {
    this.tickets.set(t.number, {
      title: `Ticket ${String(t.number)}`,
      body: '',
      labels: [],
      state: 'open',
      createdAt: '2026-10-01T00:00:00Z',
      author: 'hezrie',
      authorAssociation: 'OWNER',
      ...t,
    });
  }
  labels(n: number): string[] {
    return [...(this.tickets.get(n)?.labels ?? [])];
  }
  commentsOn(n: number): string[] {
    return (this.comments.get(n) ?? []).map((c) => c.body);
  }
  runLog() {
    return parseRunLog(this.commentsOn(1));
  }

  listOpenTickets = (): Promise<Ticket[]> =>
    Promise.resolve([...this.tickets.values()].filter((t) => t.state === 'open'));
  getTicket = (n: number): Promise<Ticket> => {
    const t = this.tickets.get(n);
    return t
      ? Promise.resolve({ ...t, labels: [...t.labels] })
      : Promise.reject(new Error(`no #${String(n)}`));
  };
  issueStates = (ns: readonly number[]) =>
    Promise.resolve(new Map(ns.map((n) => [n, this.tickets.get(n)?.state ?? 'open'] as const)));
  listOpenPullRequests = (): Promise<PullRequest[]> => Promise.resolve(this.prs);
  listComments = (n: number): Promise<IssueComment[]> =>
    Promise.resolve([...(this.comments.get(n) ?? [])]);
  findOpenTicketByLabel = (label: string): Promise<Ticket | null> =>
    Promise.resolve(
      [...this.tickets.values()]
        .filter((t) => t.state === 'open' && t.labels.includes(label))
        .sort((a, b) => a.number - b.number)[0] ?? null,
    );
  createTicket = (t: NewTicket): Promise<number> => {
    const number = this.next++;
    this.seed({
      number,
      title: t.title,
      body: t.body,
      labels: [...t.labels],
      createdAt: '2026-10-20T12:00:00Z',
      author: 'agent[bot]',
      authorAssociation: 'NONE',
    });
    return Promise.resolve(number);
  };
  addLabels = (n: number, labels: readonly string[]): Promise<void> => {
    const t = this.tickets.get(n) ?? this.prTicket(n);
    this.tickets.set(n, { ...t, labels: [...new Set([...t.labels, ...labels])] });
    return Promise.resolve();
  };
  removeLabel = (n: number, label: string): Promise<void> => {
    const t = this.tickets.get(n);
    if (t) this.tickets.set(n, { ...t, labels: t.labels.filter((l) => l !== label) });
    return Promise.resolve();
  };
  comment = (n: number, body: string): Promise<void> => {
    const list = this.comments.get(n) ?? [];
    list.push({
      id: this.commentId++,
      body,
      author: 'agent[bot]',
      createdAt: '2026-10-20T12:00:00Z',
    });
    this.comments.set(n, list);
    return Promise.resolve();
  };
  updateTicket = (n: number, patch: TicketPatch): Promise<void> => {
    const t = this.tickets.get(n);
    if (t)
      this.tickets.set(n, {
        ...t,
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.body ? { body: patch.body } : {}),
        ...(patch.state ? { state: patch.state } : {}),
      });
    return Promise.resolve();
  };
  listTicketsByLabel = (label: string): Promise<Ticket[]> =>
    Promise.resolve(
      [...this.tickets.values()]
        .filter((t) => t.labels.includes(label))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );

  /** PR numbers share the issue number space on GitHub; labels on PRs land here too. */
  private prTicket(n: number): Ticket {
    return {
      number: n,
      title: `PR ${String(n)}`,
      body: '',
      labels: [],
      state: 'open',
      createdAt: '',
      author: '',
      authorAssociation: '',
    };
  }
}

const SHA = 'feedface1234';

function prInfo(over: Partial<PrInfo> = {}): PrInfo {
  return {
    number: 30,
    title: 'feat: sand friction (#12)',
    body: 'Closes #12',
    state: 'open',
    merged: false,
    draft: false,
    headRef: 'agent/12-sand-friction',
    headSha: SHA,
    baseRef: 'main',
    labels: ['size:S', 'agent-approved'],
    author: 'mm-agent[bot]',
    url: 'https://github.com/o/r/pull/30',
    mergeable: true,
    ...over,
  };
}

class FakePrs implements PrHost {
  calls: string[] = [];
  pr = prInfo();
  runs: CheckRun[] = [
    { name: 'check', status: 'completed', conclusion: 'success' },
    { name: 'agent-guard', status: 'completed', conclusion: 'success' },
  ];
  reviewList: Review[] = [
    {
      body: '',
      author: 'github-actions[bot]',
      state: 'APPROVED',
      commitId: SHA,
      submittedAt: '2026-10-20T10:00:00Z',
    },
  ];
  fileList: { filename: string; status: string; previous_filename?: string }[] = [
    { filename: 'src/core/physics/terrain.ts', status: 'modified' },
  ];
  closing: { number: number; title: string; url: string } | null = null;
  merged: PrInfo[] = [];

  get = (n: number) => {
    this.calls.push(`get ${String(n)}`);
    return Promise.resolve({ ...this.pr, number: n });
  };
  create = (input: { title: string; body: string; head: string; base: string }) => {
    this.calls.push(`create ${input.head} -> ${input.base}: ${input.title}`);
    this.pr = prInfo({ number: 31, title: input.title, body: input.body, headRef: input.head });
    return Promise.resolve(this.pr);
  };
  files = () => Promise.resolve(this.fileList);
  checkRuns = () => Promise.resolve(this.runs);
  reviews = () => Promise.resolve(this.reviewList);
  submitReview = (n: number, sha: string, event: string, body: string) => {
    this.calls.push(`review ${String(n)} ${event} @${sha} ${body.split('\n')[0] ?? ''}`);
    return Promise.resolve();
  };
  squashMerge = (n: number, sha: string) => {
    this.calls.push(`merge ${String(n)} @${sha}`);
    return Promise.resolve();
  };
  closingPullRequest = () => Promise.resolve(this.closing);
  mergedAgentPrsSince = () => Promise.resolve(this.merged);
  commitAuthors = () => Promise.resolve(['mm-agent[bot]']);
  revertsSince = () => Promise.resolve(0);
}

interface Harness {
  ctx: Ctx;
  tracker: FakeTracker;
  prs: FakePrs;
  reviewer: FakePrs;
  outputs: Record<string, string>;
  pushes: string[];
  git: Record<string, string>;
  gitCalls: string[][];
  root: string;
  writeOut(name: string, content: string): void;
  setCheckPass(fp: string): void;
}

function harness(
  opts: { env?: Record<string, string>; config?: Partial<AgentConfig> } = {},
): Harness {
  const root = mkdtempSync(join(tmpdir(), 'mm-cli-'));
  const tracker = new FakeTracker();
  tracker.seed({ number: 1, title: '🤖 Agent Run Log', labels: ['meta:run-log'] });
  const prs = new FakePrs();
  const reviewer = new FakePrs();
  const outputs: Record<string, string> = {};
  const pushes: string[] = [];
  const git: Record<string, string> = {
    status: '',
    'rev-list': '1',
    diff: 'M\tsrc/core/physics/terrain.ts\n',
  };
  const gitCalls: string[][] = [];
  const state = join(root, 'state');
  const ctx: Ctx = {
    repo: 'hezrie/mulligan-mayhem',
    tracker,
    prs,
    reviewPrs: reviewer,
    config: { ...loadAgentConfig(), ...opts.config },
    root,
    now: new Date('2026-10-20T12:00:00Z'),
    runUrl: 'https://github.com/hezrie/mulligan-mayhem/actions/runs/7',
    git: {
      run: (args) => {
        gitCalls.push([...args]);
        return git[args[0] ?? ''] ?? '';
      },
    },
    fingerprint: () => 'fp-current',
    permissionOf: (user) => Promise.resolve(user === 'hezrie' ? 'admin' : 'read'),
    push: (branch) => {
      pushes.push(branch);
    },
    output: (k, v) => {
      outputs[k] = v;
    },
    summary: () => undefined,
    env: {
      AGENT_STATE_DIR: state,
      STARTED_AT: '2026-10-20T11:00:00.000Z',
      HOOKS_LOADED: 'true',
      ...opts.env,
    },
  };
  return {
    ctx,
    tracker,
    prs,
    reviewer,
    outputs,
    pushes,
    git,
    gitCalls,
    root,
    writeOut: (name, content) => {
      mkdirSync(join(root, '.agent/out'), { recursive: true });
      writeFileSync(join(root, '.agent/out', name), content);
    },
    setCheckPass: (fp) => {
      mkdirSync(state, { recursive: true });
      writeFileSync(join(state, 'check-pass'), `${fp}\n`);
    },
  };
}

const ticketBody = renderTicketBody({
  problem: 'Sand slows the ball.',
  criteria: ['Sand decelerates 3× (unit test)'],
  outOfScope: ['Water'],
  size: 'S',
  priority: 'P1',
  type: 'feature',
  dependencies: [],
});

// ---------- tests ----------

describe('parseArgs and helpers', () => {
  it('parses commands and flags', () => {
    expect(parseArgs(['worker-start', '--issue', '12', '--mode', 'fix', '--dry'])).toEqual({
      command: 'worker-start',
      args: { issue: '12', mode: 'fix', dry: 'true' },
    });
  });

  it('links PRs to tickets and maps changed files (renames = delete + add)', () => {
    expect(ticketNumberOfPr({ body: 'Fixes #9', headRef: 'agent/3-x' })).toBe(9);
    expect(ticketNumberOfPr({ body: '', headRef: 'agent/3-x' })).toBe(3);
    expect(
      toFileChanges([
        { filename: 'b.ts', status: 'renamed', previous_filename: 'a.ts' },
        { filename: 'c.ts', status: 'removed' },
      ]),
    ).toEqual([
      { path: 'a.ts', status: 'D' },
      { path: 'b.ts', status: 'A' },
      { path: 'c.ts', status: 'D' },
    ]);
  });

  it('exports the verdict schemas as step outputs', () => {
    const h = harness();
    cmdSchema(h.ctx, { name: 'pr-verdict' });
    expect(JSON.parse(h.outputs['json'] ?? '')).toMatchObject({ type: 'object' });
    expect(() => {
      cmdSchema(h.ctx, { name: 'nope' });
    }).toThrow();
  });
});

describe('prompt and config', () => {
  it('outputs a prompt with run context, from the trusted prompt files', () => {
    const h = harness();
    mkdirSync(join(h.root, '.agent/prompts'), { recursive: true });
    writeFileSync(join(h.root, '.agent/prompts/worker.md'), 'You are the WORKER.\n');
    cmdPrompt(h.ctx, { name: 'worker', issue: '12', attempt: '1' });
    expect(h.outputs['text']).toBe('You are the WORKER.\n\n---\nTicket: #12\nAttempt: 1/2');
    expect(() => {
      cmdPrompt(h.ctx, { name: '../../etc/passwd' });
    }).toThrow();
  });

  it('outputs per-role model and turn limits', () => {
    const h = harness();
    cmdConfig(h.ctx, { role: 'worker' });
    expect(h.outputs).toMatchObject({ model: 'opus', max_turns: '80', max_attempts: '2' });
  });
});

describe('pick', () => {
  it('writes the pick as step outputs', async () => {
    const h = harness();
    h.tracker.seed({ number: 12, labels: ['status:ready', 'size:S', 'priority:P1'] });
    await cmdPick(h.ctx, {});
    expect(h.outputs).toMatchObject({ issue: '12', mode: 'implement', pr: '' });
  });
});

describe('worker-start', () => {
  it('labels, comments, records the ticket and outputs the branch', async () => {
    const h = harness();
    h.tracker.seed({
      number: 12,
      title: 'Sand friction',
      body: ticketBody,
      labels: ['status:ready', 'size:S'],
    });
    await cmdWorkerStart(h.ctx, { issue: '12', mode: 'implement' });
    expect(h.tracker.labels(12).sort()).toEqual([
      'agent:attempt-1',
      'size:S',
      'status:in-progress',
    ]);
    expect(h.tracker.commentsOn(12)[0]).toContain('🤖 picked up');
    expect(h.outputs).toMatchObject({
      branch: 'agent/12-sand-friction',
      attempt: '1',
      allow_golden: '0',
      size: 'S',
    });
    expect(readFileSync(join(h.root, '.agent/out/ticket.md'), 'utf8')).toContain(
      'Sand decelerates 3×',
    );
  });

  it('hands the latest review feedback to a fix pass', async () => {
    const h = harness();
    h.tracker.seed({ number: 12, labels: ['status:in-review', 'size:S', 'agent:attempt-2'] });
    h.prs.reviewList = [
      {
        body: 'old',
        author: 'github-actions[bot]',
        state: 'CHANGES_REQUESTED',
        commitId: 'a',
        submittedAt: '2026-10-19T00:00:00Z',
      },
      {
        body: 'Please rename X',
        author: 'github-actions[bot]',
        state: 'CHANGES_REQUESTED',
        commitId: 'b',
        submittedAt: '2026-10-20T00:00:00Z',
      },
    ];
    await cmdWorkerStart(h.ctx, { issue: '12', mode: 'fix', pr: '30' });
    expect(readFileSync(join(h.root, '.agent/out/review-feedback.md'), 'utf8')).toBe(
      'Please rename X',
    );
    expect(h.outputs['branch']).toBe('agent/12-sand-friction');
  });
});

describe('worker-finish', () => {
  function readyToFinish(
    labels = ['status:in-progress', 'size:S', 'type:feature', 'priority:P1', 'agent:attempt-1'],
  ) {
    const h = harness();
    h.tracker.seed({ number: 12, title: 'Sand friction', body: ticketBody, labels });
    return h;
  }
  const finish = (h: Harness, extra: Record<string, string> = {}) =>
    cmdWorkerFinish(h.ctx, {
      issue: '12',
      mode: 'implement',
      branch: 'agent/12-sand-friction',
      attempt: '1',
      ...extra,
    });

  it('pushes, opens a PR that closes the ticket, copies labels and logs the run', async () => {
    const h = readyToFinish();
    h.setCheckPass('fp-current');
    h.writeOut('pr-body.md', '| criterion | test |');
    h.writeOut(
      'follow-ups.json',
      JSON.stringify([{ title: 'Add rough terrain', why: 'Natural next step' }, { bad: true }]),
    );
    await finish(h);
    expect(h.pushes).toEqual(['agent/12-sand-friction']);
    expect(h.prs.calls).toContain(
      'create agent/12-sand-friction -> main: feat: sand friction (#12)',
    );
    expect(h.prs.pr.body).toContain('Closes #12');
    expect(h.tracker.labels(31).sort()).toEqual(['priority:P1', 'size:S', 'type:feature']);
    expect(h.tracker.labels(12)).toContain('status:in-review');
    expect(h.tracker.labels(12)).not.toContain('status:in-progress');
    const followUp = h.tracker.tickets.get(100);
    expect(followUp?.labels).toEqual(['source:agent', 'status:proposed']);
    expect(h.outputs).toMatchObject({ outcome: 'pr-opened', pr: '31' });
    expect(h.tracker.runLog()).toMatchObject([
      { role: 'worker', outcome: 'pr-opened', issue: 12, pr: 31, size: 'S' },
    ]);
  });

  it('commits work the agent left uncommitted before deciding', async () => {
    const h = readyToFinish();
    h.setCheckPass('fp-current');
    h.git['status'] = ' M src/core/rng.ts\n';
    await finish(h);
    expect(h.gitCalls).toContainEqual(['add', '-A']);
    expect(h.gitCalls.find((c) => c[0] === 'commit')).toBeDefined();
  });

  it('refuses to push changes to protected paths (same rules as agent-guard) and burns an attempt', async () => {
    const h = readyToFinish();
    h.setCheckPass('fp-current');
    h.git['diff'] = 'M\tsrc/core/rng.ts\nM\tCLAUDE.md\n';
    await finish(h);
    expect(h.pushes).toEqual([]);
    expect(h.prs.calls.some((c) => c.startsWith('create'))).toBe(false);
    expect(h.tracker.labels(12).sort()).toEqual([
      'agent:attempt-2',
      'priority:P1',
      'size:S',
      'status:ready',
      'type:feature',
    ]);
    expect(h.tracker.commentsOn(12).at(-1)).toContain('protected path CLAUDE.md');
    expect(h.outputs['outcome']).toBe('failed');
  });

  it('fails when npm run check did not pass on the final files', async () => {
    const h = readyToFinish();
    h.setCheckPass('fp-older');
    await finish(h);
    expect(h.tracker.commentsOn(12).at(-1)).toContain('`npm run check` had not passed');
    expect(h.tracker.runLog()[0]).toMatchObject({ outcome: 'failed' });
  });

  it('hands the ticket to the owner when attempts are exhausted, with a lesson draft', async () => {
    const h = readyToFinish(['status:in-progress', 'size:S', 'agent:attempt-2']);
    h.git['rev-list'] = '0';
    await finish(h, { attempt: '2' });
    expect(h.tracker.labels(12)).toContain('status:needs-human');
    expect(h.tracker.commentsOn(12).at(-1)).toContain('No attempts left');
    expect(h.tracker.runLog()[0]).toMatchObject({
      outcome: 'needs-human',
      note: expect.stringContaining('LESSON DRAFT') as string,
    });
  });

  it('escalates: posts the reason, pushes work in progress, needs-human', async () => {
    const h = readyToFinish();
    h.writeOut('escalation.md', '### Escalated\n\nCriterion 2 needs a product decision.');
    await finish(h);
    expect(h.pushes).toEqual(['agent/12-sand-friction']);
    expect(h.tracker.labels(12)).toContain('status:needs-human');
    expect(h.tracker.commentsOn(12).at(-1)).toContain('Criterion 2 needs a product decision.');
  });

  it('posts a plan for M tickets and waits for its review', async () => {
    const h = readyToFinish(['status:in-progress', 'size:M', 'agent:attempt-1']);
    h.writeOut('plan.md', `## Approach\n${'Detailed steps. '.repeat(10)}`);
    await finish(h, { mode: 'plan' });
    expect(h.tracker.commentsOn(12).at(-1)).toMatch(/^<!-- mm:plan -->/);
    expect(h.tracker.labels(12).sort()).toEqual([
      'agent:attempt-1',
      'plan:proposed',
      'size:M',
      'status:ready',
    ]);
    expect(h.pushes).toEqual([]);
  });

  it('treats a missing guardrail canary as an infrastructure failure: no push, no attempt burned', async () => {
    const h = readyToFinish();
    h.setCheckPass('fp-current');
    h.ctx = { ...h.ctx, env: { ...h.ctx.env, HOOKS_LOADED: 'false' } };
    await finish(h);
    expect(h.pushes).toEqual([]);
    expect(h.tracker.labels(12).sort()).toEqual([
      'agent:attempt-1',
      'priority:P1',
      'size:S',
      'status:ready',
      'type:feature',
    ]);
    expect(h.tracker.commentsOn(12).at(-1)).toContain('Infrastructure problem');
  });

  it('pushes a fix pass to the existing PR branch and returns the ticket to review', async () => {
    const h = readyToFinish(['status:in-progress', 'size:S', 'agent:attempt-2']);
    h.setCheckPass('fp-current');
    await finish(h, { mode: 'fix', pr: '30', attempt: '2' });
    expect(h.gitCalls).toContainEqual([
      'rev-list',
      '--count',
      'origin/agent/12-sand-friction..HEAD',
    ]);
    expect(h.pushes).toEqual(['agent/12-sand-friction']);
    expect(h.tracker.labels(12)).toContain('status:in-review');
    expect(h.tracker.commentsOn(30).at(-1)).toContain('Pushed fixes');
  });
});

describe('review', () => {
  const verdict = {
    verdict: 'approve',
    summary: 'All criteria tested.',
    criteria: [{ criterion: 'Sand decelerates 3×', test: 'step.test.ts › sand', satisfied: true }],
    issues: [],
    scopeCreep: false,
    testsWeakened: false,
    layerViolation: false,
  };

  function reviewHarness(env: Record<string, string>) {
    const h = harness({ env });
    h.tracker.seed({ number: 12, labels: ['status:in-review', 'size:S', 'agent:attempt-1'] });
    h.tracker.seed({ number: 30, labels: ['size:S', 'agent-approved'] });
    return h;
  }

  it('skips stale or non-agent PRs and collects context for current ones', async () => {
    const stale = harness({ env: { CHECK_WAIT_MS: '0' } });
    stale.tracker.seed({ number: 12, labels: ['status:in-review'] });
    await cmdReviewContext(stale.ctx, { pr: '30', sha: 'something-else' });
    expect(stale.outputs['skip']).toBe('true');

    const fresh = harness({ env: { CHECK_WAIT_MS: '0' } });
    fresh.tracker.seed({ number: 12, labels: ['status:in-review'] });
    await cmdReviewContext(fresh.ctx, { pr: '30', sha: SHA });
    expect(fresh.outputs).toMatchObject({
      skip: 'false',
      issue: '12',
      ci_green: 'true',
      head_sha: SHA,
    });
    expect(readFileSync(join(fresh.root, '.agent/out/review/ci.md'), 'utf8')).toContain(
      'agent-guard: success',
    );
  });

  it('approves as github-actions[bot] and labels the PR agent-approved', async () => {
    const h = reviewHarness({ CI_GREEN: 'true', VERDICT_JSON: JSON.stringify(verdict) });
    await cmdReviewFinish(h.ctx, { pr: '30', issue: '12' });
    expect(h.reviewer.calls).toEqual([`review 30 APPROVE @${SHA} ## 🤖 Review: ✅ approved`]);
    expect(h.prs.calls.filter((c) => c.startsWith('review'))).toEqual([]);
    expect(h.tracker.labels(30)).toContain('agent-approved');
    expect(h.outputs['approved']).toBe('true');
    expect(h.tracker.runLog()[0]).toMatchObject({ role: 'reviewer', outcome: 'approved' });
  });

  it('requests changes without an LLM verdict when CI is red, and counts an attempt', async () => {
    const h = reviewHarness({ CI_GREEN: 'false', CI_FAILING: 'check' });
    await cmdReviewFinish(h.ctx, { pr: '30', issue: '12' });
    expect(h.reviewer.calls[0]).toContain('REQUEST_CHANGES');
    expect(h.tracker.labels(30)).not.toContain('agent-approved');
    expect(h.tracker.labels(12)).toContain('agent:attempt-2');
    expect(h.outputs['approved']).toBe('false');
  });

  it('downgrades an inconsistent approval and escalates when attempts run out', async () => {
    const h = reviewHarness({
      CI_GREEN: 'true',
      VERDICT_JSON: JSON.stringify({ ...verdict, testsWeakened: true }),
    });
    await h.tracker.addLabels(12, ['agent:attempt-2']);
    await h.tracker.removeLabel(12, 'agent:attempt-1');
    await cmdReviewFinish(h.ctx, { pr: '30', issue: '12' });
    expect(h.reviewer.calls[0]).toContain('REQUEST_CHANGES');
    expect(h.tracker.labels(12)).toContain('status:needs-human');
  });

  it('never approves on a missing or malformed verdict', async () => {
    for (const bad of ['', '{oops', JSON.stringify({ verdict: 'approve' })]) {
      const h = reviewHarness({ CI_GREEN: 'true', VERDICT_JSON: bad });
      await cmdReviewFinish(h.ctx, { pr: '30', issue: '12' });
      expect(h.reviewer.calls).toEqual([]);
      expect(h.tracker.commentsOn(30).at(-1)).toContain('did not return a valid verdict');
    }
  });

  it('approves a plan, or sends it back as a new attempt', async () => {
    const ok = harness({
      env: { VERDICT_JSON: JSON.stringify({ verdict: 'approve', summary: 'Solid.', issues: [] }) },
    });
    ok.tracker.seed({
      number: 12,
      labels: ['status:ready', 'size:M', 'plan:proposed', 'agent:attempt-1'],
    });
    await cmdPlanReviewFinish(ok.ctx, { issue: '12' });
    expect(ok.tracker.labels(12)).toContain('plan:approved');
    expect(ok.tracker.labels(12)).not.toContain('plan:proposed');

    const no = harness({
      env: {
        VERDICT_JSON: JSON.stringify({
          verdict: 'request_changes',
          summary: 'Missing tests.',
          issues: [{ file: null, problem: 'No e2e', requiredChange: 'Add one' }],
        }),
      },
    });
    no.tracker.seed({
      number: 12,
      labels: ['status:ready', 'size:M', 'plan:proposed', 'agent:attempt-1'],
    });
    await cmdPlanReviewFinish(no.ctx, { issue: '12' });
    expect(no.tracker.labels(12).sort()).toEqual(['agent:attempt-2', 'size:M', 'status:ready']);
  });
});

describe('merge', () => {
  it('comments "Ready for human merge" once per head commit at level 1', async () => {
    const h = harness();
    h.tracker.seed({ number: 30, labels: ['size:S', 'agent-approved'] });
    await cmdMerge(h.ctx, { pr: '30' });
    await cmdMerge(h.ctx, { pr: '30' });
    expect(
      h.tracker.commentsOn(30).filter((c) => c.includes('Ready for human merge')),
    ).toHaveLength(1);
    expect(h.prs.calls.some((c) => c.startsWith('merge'))).toBe(false);
    expect(h.outputs['action']).toBe('human');
  });

  it('squash-merges at level 2 for S, pinned to the reviewed head', async () => {
    const h = harness({ config: { autonomyLevel: 2 } });
    await cmdMerge(h.ctx, { pr: '30' });
    expect(h.prs.calls).toContain(`merge 30 @${SHA}`);
    expect(h.tracker.runLog()[0]).toMatchObject({ role: 'merger', outcome: 'merged', pr: 30 });
  });

  it('does nothing while CI is red or approval is missing', async () => {
    const h = harness({ config: { autonomyLevel: 3 } });
    h.prs.runs = [{ name: 'check', status: 'completed', conclusion: 'failure' }];
    await cmdMerge(h.ctx, { pr: '30' });
    expect(h.outputs['action']).toBe('wait');
    expect(h.tracker.commentsOn(30)).toEqual([]);
  });
});

describe('close', () => {
  it('summarizes, strips status labels, logs, and opens an architecture review every N merges', async () => {
    const h = harness({ config: { architectureReviewEveryNMerges: 2 } });
    h.tracker.seed({
      number: 12,
      state: 'closed',
      labels: ['status:in-review', 'agent:attempt-1', 'size:S'],
    });
    h.prs.closing = { number: 30, title: 'feat: sand', url: 'https://x/30' };
    h.prs.merged = [prInfo(), prInfo({ number: 29 })];
    await cmdClose(h.ctx, { issue: '12' });
    expect(h.tracker.labels(12)).toEqual(['size:S']);
    expect(h.tracker.commentsOn(12)[0]).toContain('Shipped in [#30');
    expect(h.tracker.runLog()[0]).toMatchObject({
      role: 'closer',
      outcome: 'closed',
      issue: 12,
      pr: 30,
      size: 'S',
    });
    const review = [...h.tracker.tickets.values()].find(
      (t) => t.title === 'Architecture & drift review',
    );
    expect(review?.labels).toEqual(['type:refactor', 'status:needs-human']);
  });

  it('only strips labels for issues not closed by a PR', async () => {
    const h = harness();
    h.tracker.seed({ number: 12, state: 'closed', labels: ['status:ready'] });
    await cmdClose(h.ctx, { issue: '12' });
    expect(h.tracker.labels(12)).toEqual([]);
    expect(h.tracker.commentsOn(12)).toEqual([]);
  });
});

describe('refine', () => {
  it('asks strangers to wait for triage (once), and lets the owner through', async () => {
    const h = harness();
    h.tracker.seed({
      number: 40,
      labels: ['status:needs-refinement'],
      author: 'stranger',
      authorAssociation: 'NONE',
    });
    await cmdRefineGate(h.ctx, { issue: '40', sender: 'stranger' });
    await cmdRefineGate(h.ctx, { issue: '40', sender: 'stranger' });
    expect(h.outputs['proceed']).toBe('false');
    expect(
      h.tracker.commentsOn(40).filter((c) => c.includes('maintainer will take a look')),
    ).toHaveLength(1);

    await cmdRefineGate(h.ctx, { issue: '40', sender: 'hezrie' });
    expect(h.outputs).toMatchObject({ proceed: 'true', non_write_actor: '' });
    expect(readFileSync(join(h.root, '.agent/out/issue.md'), 'utf8')).toContain(
      'Author: @stranger',
    );
  });

  it('lets trusted family members through as the only non-write actor', async () => {
    const h = harness({ config: { trustedSubmitters: ['grandma-g'] } });
    h.tracker.seed({
      number: 41,
      labels: ['status:needs-refinement'],
      author: 'grandma-g',
      authorAssociation: 'NONE',
    });
    await cmdRefineGate(h.ctx, { issue: '41', sender: 'grandma-g' });
    expect(h.outputs).toMatchObject({ proceed: 'true', non_write_actor: 'grandma-g' });
  });

  it('splits an L idea into linked children and closes the parent', async () => {
    const child = (title: string, deps: number[]) => ({
      title,
      problem: 'A meaningful slice of work.',
      criteria: ['Does X (unit test)'],
      outOfScope: ['Rough terrain'],
      size: 'S',
      priority: 'P2',
      type: 'feature',
      dependencies: [],
      notes: '',
      dependsOnChildren: deps,
    });
    const h = harness({
      env: {
        REFINEMENT_JSON: JSON.stringify({
          decision: 'split',
          summary: 'Too big.',
          ticket: null,
          children: [child('Daily seed generator', []), child('Solvability bot', [0])],
          questions: [],
        }),
      },
    });
    h.tracker.seed({
      number: 50,
      title: 'Daily course',
      body: 'make a daily course',
      labels: ['status:needs-refinement'],
    });
    await cmdRefineFinish(h.ctx, { issue: '50' });
    expect(h.tracker.tickets.get(100)?.labels).toContain('status:ready');
    expect(h.tracker.tickets.get(101)?.body).toContain('Blocked by #100');
    expect(h.tracker.tickets.get(50)?.state).toBe('closed');
    expect(h.tracker.commentsOn(50)[0]).toContain('Original request');
    expect(h.tracker.runLog()[0]).toMatchObject({ role: 'refiner', outcome: 'split' });
  });

  it('turns malformed refiner output into a needs-human hand-off', async () => {
    const h = harness({ env: { REFINEMENT_JSON: '{"decision":"ready"' } });
    h.tracker.seed({ number: 51, labels: ['status:needs-refinement'] });
    await cmdRefineFinish(h.ctx, { issue: '51' });
    expect(h.tracker.labels(51)).toEqual(['status:needs-human']);
  });
});

beforeEach(() => {
  // Each harness gets its own temp root; nothing shared between tests.
});
