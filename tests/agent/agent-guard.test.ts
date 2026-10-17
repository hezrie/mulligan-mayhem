import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findViolations,
  isAgentBranch,
  modeViolations,
  parseNameStatus,
} from '../../scripts/agent/agent-guard.ts';
import { loadAgentConfig } from '../../scripts/agent/config.ts';

const rules = loadAgentConfig();

describe('agent-guard', () => {
  it('only guards agent branches', () => {
    expect(isAgentBranch('agent/12-sand-friction')).toBe(true);
    expect(isAgentBranch('foundation/phase-6')).toBe(false);
    expect(isAgentBranch('main')).toBe(false);
  });

  it('parses git name-status output, treating renames as delete + add', () => {
    const text = [
      'M\tsrc/core/rng.ts',
      'A\ttests/replays/new.json',
      'D\told.ts',
      'R087\ttests/replays/skeleton-01-par.json\ttests/replays/renamed.json',
      'C100\tsrc/a.ts\tsrc/b.ts',
      '',
    ].join('\n');
    expect(parseNameStatus(text)).toEqual([
      { path: 'src/core/rng.ts', status: 'M' },
      { path: 'tests/replays/new.json', status: 'A' },
      { path: 'old.ts', status: 'D' },
      { path: 'tests/replays/skeleton-01-par.json', status: 'D' },
      { path: 'tests/replays/renamed.json', status: 'A' },
      { path: 'src/b.ts', status: 'A' },
    ]);
  });

  it('passes a normal feature diff, including a brand-new golden replay', () => {
    const changes = parseNameStatus('M\tsrc/core/physics/step.ts\nA\ttests/replays/sand.json\n');
    expect(findViolations(changes, rules, false)).toEqual([]);
  });

  it('flags protected paths, renamed protected files and changed golden replays', () => {
    const changes = parseNameStatus(
      [
        'M\tvitest.config.ts',
        'R100\tsrc/x.ts\t.github/workflows/sneaky.yml',
        'M\ttests/replays/skeleton-01-par.json',
      ].join('\n'),
    );
    const violations = findViolations(changes, rules, false);
    expect(violations).toHaveLength(3);
    expect(violations.join('\n')).toContain('vitest.config.ts');
    expect(violations.join('\n')).toContain('.github/workflows/sneaky.yml');
    expect(violations.join('\n')).toContain('physics-change');
  });

  it('allows golden replay changes with physics-change, but never protected paths', () => {
    const changes = parseNameStatus('M\ttests/replays/skeleton-01-par.json\nM\tCLAUDE.md\n');
    expect(findViolations(changes, rules, true)).toEqual(['protected path CLAUDE.md']);
  });

  it('runs under plain node (no tsx, no npm install), as CI runs it from the trusted checkout', () => {
    const root = resolve(import.meta.dirname, '../..');
    const r = spawnSync('node', ['scripts/agent/agent-guard.ts'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HEAD_REF: 'foundation/x', GITHUB_STEP_SUMMARY: '' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('not an agent branch');
  });
});

describe('modeViolations (git diff --raw)', () => {
  it('rejects added or changed symlinks and submodules, whatever their path', () => {
    const raw = [
      ':000000 100644 0000000 1111111 A\tsrc/core/sand.ts',
      ':000000 120000 0000000 2222222 A\tscripts/node_modules',
      ':100644 120000 3333333 4444444 T\tsrc/.claude',
      ':000000 160000 0000000 5555555 A\tvendor/lib',
      ':120000 000000 6666666 0000000 D\told-link',
    ].join('\n');
    expect(modeViolations(raw)).toEqual([
      'symlink scripts/node_modules (agents may not add symlinks)',
      'symlink src/.claude (agents may not add symlinks)',
      'submodule vendor/lib (agents may not add submodules)',
    ]);
    expect(modeViolations('M\tsrc/a.ts\n')).toEqual([]);
  });
});
