/**
 * CI `agent-guard`: fails an agent PR (head branch `agent/*`) that touches a protected path, or
 * that modifies/deletes an existing golden replay without the `physics-change` label.
 *
 * Runs from a checkout of the BASE commit (see .github/workflows/agent-guard.yml), with the base
 * branch's agent.config.json, so a PR can't weaken the guard that judges it. Dependency-free and
 * erasable-TypeScript only, so plain `node` runs it without installing the PR's packages.
 * PROTECTED: agents may not edit this file.
 *
 *   node <trusted>/scripts/agent/agent-guard.ts   (env: HEAD_REF, BASE_SHA, PR_LABELS, TRUSTED_DIR)
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyChange, type FileChange, type PathRules } from './protected.ts';

export function isAgentBranch(headRef: string): boolean {
  return headRef.startsWith('agent/');
}

/**
 * Parses `git diff --name-status -M` output. A rename counts as deleting the old path and adding
 * the new one; a copy as adding the new path.
 */
export function parseNameStatus(text: string): FileChange[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      const [status = '', first = '', second] = line.split('\t');
      const letter = status.charAt(0);
      if ((letter === 'R' || letter === 'C') && second !== undefined) {
        return letter === 'R'
          ? [
              { path: first, status: 'D' },
              { path: second, status: 'A' },
            ]
          : [{ path: second, status: 'A' }];
      }
      return [{ path: first, status: letter }];
    });
}

/**
 * Symlinks and submodules in `git diff --raw` output. A symlink is a single path, so it slips past
 * directory globs (e.g. `scripts/node_modules -> ../vendor` vs `**\/node_modules/**`) and can make
 * Node or Claude Code load files from anywhere. Agents never need either.
 */
export function modeViolations(raw: string): string[] {
  return raw
    .split('\n')
    .filter((line) => line.startsWith(':'))
    .flatMap((line) => {
      const [meta = '', ...paths] = line.split('\t');
      const newMode = meta.slice(1).split(' ')[1] ?? '';
      const path = paths.at(-1) ?? '';
      if (newMode === '120000') return [`symlink ${path} (agents may not add symlinks)`];
      if (newMode === '160000') return [`submodule ${path} (agents may not add submodules)`];
      return [];
    });
}

export function findViolations(
  changes: readonly FileChange[],
  rules: PathRules,
  physicsChange: boolean,
): string[] {
  return changes
    .map((change) => classifyChange(change, rules, physicsChange))
    .filter((verdict) => !verdict.allowed)
    .map((verdict) => verdict.reason);
}

function main(): void {
  const headRef = process.env['HEAD_REF'] ?? '';
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  const report = (line: string): void => {
    console.log(line);
    if (summary) appendFileSync(summary, `${line}\n`);
  };

  if (!isAgentBranch(headRef)) {
    report(`agent-guard: \`${headRef}\` is not an agent branch, so there is nothing to guard.`);
    return;
  }
  const baseSha = process.env['BASE_SHA'];
  const trusted = process.env['TRUSTED_DIR'];
  if (!baseSha || !trusted) throw new Error('BASE_SHA and TRUSTED_DIR are required');

  const config = JSON.parse(readFileSync(join(trusted, 'agent.config.json'), 'utf8')) as PathRules;
  const labels = JSON.parse(process.env['PR_LABELS'] ?? '[]') as string[];
  const physicsChange = labels.includes('physics-change');
  const diff = execFileSync('git', ['diff', '--name-status', '-M', `${baseSha}...HEAD`], {
    encoding: 'utf8',
  });
  const raw = execFileSync('git', ['diff', '--raw', '-M', `${baseSha}...HEAD`], {
    encoding: 'utf8',
  });
  const changes = parseNameStatus(diff);
  const violations = [...findViolations(changes, config, physicsChange), ...modeViolations(raw)];

  if (violations.length === 0) {
    report(`agent-guard ✅: ${String(changes.length)} changed paths, none protected.`);
    return;
  }
  report('agent-guard ❌: this agent PR touches paths only the owner may change:');
  for (const v of violations) report(`- ${v}`);
  report(
    '\nThe agent must escalate instead (status:needs-human). See CLAUDE.md, "Protected paths".',
  );
  process.exitCode = 1;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) main();
