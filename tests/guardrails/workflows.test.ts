/**
 * Security invariants of the GitHub workflows, checked structurally. These are the properties the
 * whole "permissions over instructions" design rests on, so they are tests, not conventions.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const DIR = resolve(import.meta.dirname, '../../.github/workflows');

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean | number>;
  'continue-on-error'?: boolean;
}
interface Job {
  if?: string;
  needs?: string | string[];
  uses?: string;
  permissions?: Record<string, string> | string;
  'timeout-minutes'?: number;
  steps?: Step[];
}
interface Workflow {
  on: Record<string, unknown> | string[] | string;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflows: [string, Workflow][] = readdirSync(DIR)
  .filter((f) => f.endsWith('.yml'))
  .map((f) => [f, parse(readFileSync(join(DIR, f), 'utf8')) as Workflow]);
const agentWorkflows = workflows.filter(([f]) => f.startsWith('agent-') && f !== 'agent-guard.yml');
const CLAUDE = 'anthropics/claude-code-action@v1';
const isClaude = (s: Step): boolean => (s.uses ?? '').startsWith('anthropics/claude-code-action');
const claudeSteps = workflows.flatMap(([file, wf]) =>
  Object.entries(wf.jobs).flatMap(([jobName, job]) =>
    (job.steps ?? [])
      .map((step, index) => ({ file, jobName, job, step, index }))
      .filter(({ step }) => isClaude(step)),
  ),
);
const needsOf = (job: Job): string[] =>
  job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];

describe('agent workflows', () => {
  it('exist for every role in the loop', () => {
    expect(agentWorkflows.map(([f]) => f).sort()).toEqual([
      'agent-close.yml',
      'agent-digest.yml',
      'agent-merge.yml',
      'agent-refine.yml',
      'agent-review.yml',
      'agent-worker.yml',
    ]);
    expect(claudeSteps.length).toBeGreaterThanOrEqual(5);
  });

  it.each(agentWorkflows)('%s: every job honours the AGENT_PAUSED kill switch', (_file, wf) => {
    const paused = (name: string, seen = new Set<string>()): boolean => {
      const job = wf.jobs[name];
      if (!job || seen.has(name)) return false;
      seen.add(name);
      return (
        (job.if ?? '').includes("vars.AGENT_PAUSED != 'true'") ||
        needsOf(job).some((n) => paused(n, seen))
      );
    };
    for (const name of Object.keys(wf.jobs)) expect(paused(name), name).toBe(true);
  });

  it.each(agentWorkflows)('%s: top-level token permissions are read-only', (_file, wf) => {
    for (const value of Object.values(wf.permissions ?? {})) expect(value).not.toBe('write');
  });

  it.each(agentWorkflows)('%s: checkouts never persist credentials', (_file, wf) => {
    for (const job of Object.values(wf.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/checkout'))
          expect(step.with?.['persist-credentials'], step.name).toBe(false);
      }
    }
  });
});

describe.each(
  claudeSteps.map(
    (c) => [`${c.file} › ${c.jobName} › ${c.step.name ?? String(c.index)}`, c] as const,
  ),
)('Claude step %s', (_label, { file, job, step, index }) => {
  const text = JSON.stringify({ env: step.env, with: step.with });

  it('uses the pinned action major and the read-only GITHUB_TOKEN, never the bot App token', () => {
    expect(step.uses).toBe(CLAUDE);
    expect(step.with?.['github_token']).toBe('${{ secrets.GITHUB_TOKEN }}');
    expect(text).not.toMatch(/steps\.app\.outputs\.token|AGENT_BOT_TOKEN|AGENT_APP_PRIVATE_KEY/);
  });

  it('runs in a job without any write permission', () => {
    expect(typeof job.permissions).toBe('object');
    for (const value of Object.values(job.permissions as Record<string, string>))
      expect(value).not.toBe('write');
  });

  it('runs under AGENT_MODE (env and settings agree), tolerating failure for bookkeeping', () => {
    const mode = step.env?.['AGENT_MODE'];
    expect(['worker', 'reviewer', 'refiner', 'digest', 'preflight']).toContain(mode);
    expect(String(step.with?.['settings'])).toContain(`"AGENT_MODE":"${String(mode)}"`);
    expect(step['continue-on-error']).toBe(true);
  });

  it('is followed by a canary check for that exact mode', () => {
    const mode = String(step.env?.['AGENT_MODE']);
    const later = (job.steps ?? []).slice(index + 1);
    expect(
      later.some((s) => (s.run ?? '').includes(`'^${mode} ' .agent/.state/hooks-active`)),
    ).toBe(true);
  });

  it('re-checks the kill switch in its own job (it may be pulled while earlier jobs run)', () => {
    // Preflight is the by-hand check you run while paused, before unpausing.
    if (file === 'preflight.yml') return;
    expect(job.if ?? '').toContain("vars.AGENT_PAUSED != 'true'");
  });

  it('caps turns from config and denies GitHub CLI, network and web tools', () => {
    const args = String(step.with?.['claude_args']);
    expect(args).toMatch(/--max-turns \$\{\{ steps\.\w+\.outputs\.max_turns \}\}/);
    expect(args).toMatch(/--model \$\{\{ steps\.\w+\.outputs\.model \}\}/);
    const denied = /--disallowedTools "([^"]+)"/.exec(args)?.[1] ?? '';
    expect(denied).toMatch(/Bash\(gh:\*\)|(^|,)Bash(,|$)/);
    expect(denied).toContain('WebFetch');
    expect(denied).toContain('WebSearch');
  });
});

describe('all workflows', () => {
  const ALLOWED_ACTIONS = [
    /^actions\/(checkout|setup-node|cache|cache\/restore|upload-artifact|download-artifact|configure-pages|upload-pages-artifact|deploy-pages|create-github-app-token)@v\d+$/,
    /^anthropics\/claude-code-action@v1$/,
    /^docker:\/\/rhysd\/actionlint:\d+\.\d+\.\d+$/,
    /^\.\/\.github\/workflows\/agent-merge\.yml$/,
  ];

  it.each(workflows)('%s: never uses pull_request_target', (_file, wf) => {
    const events =
      typeof wf.on === 'string' ? [wf.on] : Array.isArray(wf.on) ? wf.on : Object.keys(wf.on);
    expect(events).not.toContain('pull_request_target');
  });

  it.each(workflows)(
    '%s: only uses allow-listed actions, pinned to a major version',
    (_file, wf) => {
      for (const job of Object.values(wf.jobs)) {
        const uses = [job.uses, ...(job.steps ?? []).map((s) => s.uses)].filter((u): u is string =>
          Boolean(u),
        );
        for (const u of uses)
          expect(
            ALLOWED_ACTIONS.some((re) => re.test(u)),
            u,
          ).toBe(true);
      }
    },
  );

  it('trusted jobs (bot App token) receive LLM artifacts outside the checkout, as data', () => {
    for (const [file, wf] of workflows) {
      for (const [name, job] of Object.entries(wf.jobs)) {
        const steps = job.steps ?? [];
        if (!steps.some((st) => (st.uses ?? '').startsWith('actions/create-github-app-token')))
          continue;
        for (const st of steps.filter((x) =>
          (x.uses ?? '').startsWith('actions/download-artifact'),
        ))
          expect(String(st.with?.['path']), `${file}:${name}`).toMatch(
            /^\$\{\{ runner\.temp \}\}\//,
          );
      }
    }
  });

  it('the PR reviewer stays on main and only unpacks the PR as files (never checks it out)', () => {
    const review = workflows.find(([f]) => f === 'agent-review.yml')?.[1].jobs['review'];
    const steps = review?.steps ?? [];
    expect(steps.find((st) => (st.uses ?? '').startsWith('actions/checkout'))?.with?.['ref']).toBe(
      'main',
    );
    const runs = steps.map((st) => st.run ?? '').join('\n');
    expect(runs).not.toMatch(/git[^\n]*\b(switch|checkout|worktree)\b/);
    expect(runs).toContain('archive --format=tar');
    const unpack = steps.findIndex((st) => (st.run ?? '').includes('archive --format=tar'));
    const prep = steps.findIndex((st) => (st.run ?? '').includes('prompt --name reviewer-pr'));
    expect(prep).toBeGreaterThan(-1);
    expect(prep).toBeLessThan(unpack); // prompt and schema come from main, before the PR lands
  });

  it('only the review submit job may write pull requests, and it runs no LLM', () => {
    const writers = workflows.flatMap(([file, wf]) =>
      Object.entries(wf.jobs)
        .filter(
          ([, job]) =>
            typeof job.permissions === 'object' && Object.values(job.permissions).includes('write'),
        )
        .map(([name, job]) => ({ id: `${file}:${name}`, job })),
    );
    expect(writers.map((w) => w.id).sort()).toEqual([
      'agent-review.yml:submit',
      'deploy.yml:deploy',
    ]);
    for (const w of writers) expect((w.job.steps ?? []).some(isClaude)).toBe(false);
  });
});
