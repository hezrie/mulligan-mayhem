import { describe, expect, it } from 'vitest';
import { loadAgentConfig } from '../../scripts/agent/config.ts';
import { classifyChange, globToRegExp, matchesAny } from '../../scripts/agent/protected.ts';

const config = loadAgentConfig();

describe('globToRegExp', () => {
  it.each([
    ['.github/**', '.github/workflows/ci.yml', true],
    ['.github/**', '.github', false],
    ['.github/**', 'src/.github/x', false],
    ['tsconfig*.json', 'tsconfig.app.json', true],
    ['tsconfig*.json', 'tsconfig.json', true],
    ['tsconfig*.json', 'src/tsconfig.json', false],
    ['tsconfig*.json', 'tsconfig/evil.json', false],
    ['CLAUDE.md', 'CLAUDE.md', true],
    ['CLAUDE.md', 'docs/CLAUDE.md', false],
    ['CLAUDE.md', 'CLAUDExmd', false],
    ['scripts/agent/**', 'scripts/agent/tracker/github.ts', true],
  ])('%s vs %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe('matchesAny with the real config', () => {
  it.each([
    'CLAUDE.md',
    'PLAN.md',
    'agent.config.json',
    '.github/workflows/agent-worker.yml',
    '.claude/settings.json',
    '.claude/hooks/guard-bash.sh',
    '.agent/prompts/worker.md',
    '.agent/LESSONS.md',
    'scripts/agent/pick-next.ts',
    'scripts/check-test-integrity.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.node.json',
    'vitest.config.ts',
    'eslint.config.js',
    '.dependency-cruiser.cjs',
    'e2e/fixtures.ts',
    'docs/DEFINITION_OF_DONE.md',
    'docs/decisions/0001-custom-deterministic-physics.md',
  ])('%s is protected', (path) => {
    expect(matchesAny(path, config.protectedPaths)).toBe(true);
  });

  it.each([
    'src/core/physics/step.ts',
    'src/core/course/holes/skeleton-01.json',
    'tests/unit/core/rng.test.ts',
    'e2e/skeleton-hole.spec.ts',
    'docs/GAME_DESIGN.md',
    'docs/ARCHITECTURE.md',
    'scripts/record-replay.ts',
    'index.html',
  ])('%s is editable by agents', (path) => {
    expect(matchesAny(path, config.protectedPaths)).toBe(false);
  });
});

describe('classifyChange', () => {
  const rules = { protectedPaths: config.protectedPaths, goldenPaths: config.goldenPaths };

  it('blocks any change to a protected path', () => {
    expect(classifyChange({ path: 'CLAUDE.md', status: 'M' }, rules, false)).toMatchObject({
      allowed: false,
    });
    expect(classifyChange({ path: '.github/x.yml', status: 'A' }, rules, false)).toMatchObject({
      allowed: false,
    });
  });

  it('allows adding a new golden replay, but not modifying or deleting one', () => {
    const replay = 'tests/replays/new-hole.json';
    expect(classifyChange({ path: replay, status: 'A' }, rules, false)).toMatchObject({
      allowed: true,
    });
    expect(classifyChange({ path: replay, status: 'M' }, rules, false)).toMatchObject({
      allowed: false,
    });
    expect(classifyChange({ path: replay, status: 'D' }, rules, false)).toMatchObject({
      allowed: false,
    });
    expect(classifyChange({ path: replay, status: 'R' }, rules, false)).toMatchObject({
      allowed: false,
    });
  });

  it('allows golden replay changes when the ticket carries physics-change', () => {
    expect(
      classifyChange({ path: 'tests/replays/skeleton-01-par.json', status: 'M' }, rules, true),
    ).toMatchObject({ allowed: true });
  });

  it('allows ordinary source changes', () => {
    expect(classifyChange({ path: 'src/core/rng.ts', status: 'M' }, rules, false)).toEqual({
      allowed: true,
      reason: 'ok',
    });
  });
});
