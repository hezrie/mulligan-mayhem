/**
 * Config-sync checks, run by `npm run check:integrity` (so in CI too). Things that must agree
 * but live in different files:
 *  - CI's `check` job runs exactly the `npm run …` steps of `npm run check`, in the same order;
 *  - the worker workflow's cron equals `workerCron` in agent.config.json (GitHub can't read
 *    cron from JSON at runtime, so the YAML holds a literal copy);
 *  - every job that runs Claude has `timeout-minutes` equal to workflowTimeoutMinutes for its role.
 * PROTECTED: agents may not edit this file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** The `npm run <x>` names in a shell chain, in order. Non-npm steps (stamps) are ignored. */
export function npmRunSequence(script: string): string[] {
  return [...script.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1] ?? '');
}

/** The `npm run <x>` steps of one job in a workflow file, in order (line-based; we own the format). */
export function workflowJobNpmSteps(yaml: string, job: string): string[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^  ${job}:\\s*$`).test(l));
  if (start === -1) return [];
  const steps: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break; // next job
    const m = /^\s+(?:- )?run: npm run ([\w:-]+)\s*$/.exec(line);
    if (m?.[1]) steps.push(m[1]);
  }
  return steps;
}

export function workflowCrons(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*- cron: ['"]([^'"]+)['"]/gm)].map((m) => m[1] ?? '');
}

export function checkConfigSync(root: string): string[] {
  const problems: string[] = [];
  const read = (p: string): string => readFileSync(join(root, p), 'utf8');
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  const expected = npmRunSequence(pkg.scripts['check'] ?? '');
  const ci = workflowJobNpmSteps(read('.github/workflows/ci.yml'), 'check');
  if (expected.join(' → ') !== ci.join(' → ')) {
    problems.push(
      `ci.yml "check" job runs [${ci.join(', ')}] but \`npm run check\` runs [${expected.join(', ')}]`,
    );
  }

  const config = JSON.parse(read('agent.config.json')) as {
    workerCron: string;
    workflowTimeoutMinutes: Record<string, number>;
  };
  const workerPath = '.github/workflows/agent-worker.yml';
  if (!existsSync(join(root, workerPath))) {
    problems.push(`${workerPath} is missing`);
  } else {
    const crons = workflowCrons(read(workerPath));
    if (crons.length !== 1 || crons[0] !== config.workerCron) {
      problems.push(
        `${workerPath} cron [${crons.join(', ')}] must equal agent.config.json workerCron "${config.workerCron}"`,
      );
    }
  }
  problems.push(...claudeJobTimeoutProblems(root, config.workflowTimeoutMinutes));
  return problems;
}

interface WorkflowYaml {
  jobs?: Record<
    string,
    { 'timeout-minutes'?: number; steps?: { uses?: string; env?: Record<string, string> }[] }
  >;
}

/** Jobs that run Claude must time out after workflowTimeoutMinutes[role] (role = AGENT_MODE). */
export function claudeJobTimeoutProblems(root: string, timeouts: Record<string, number>): string[] {
  const dir = join(root, '.github', 'workflows');
  const problems: string[] = [];
  for (const file of [
    'agent-worker.yml',
    'agent-review.yml',
    'agent-refine.yml',
    'agent-digest.yml',
  ]) {
    if (!existsSync(join(dir, file))) continue;
    const wf = parse(readFileSync(join(dir, file), 'utf8')) as WorkflowYaml;
    for (const [name, job] of Object.entries(wf.jobs ?? {})) {
      const claude = (job.steps ?? []).find((s) =>
        s.uses?.startsWith('anthropics/claude-code-action'),
      );
      const role = claude?.env?.['AGENT_MODE'];
      if (!role || !(role in timeouts)) continue;
      if (job['timeout-minutes'] !== timeouts[role]) {
        problems.push(
          `${file} job "${name}" timeout-minutes ${String(job['timeout-minutes'])} must equal workflowTimeoutMinutes.${role} (${String(timeouts[role])})`,
        );
      }
    }
  }
  return problems;
}
