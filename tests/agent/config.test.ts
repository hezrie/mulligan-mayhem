import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentConfigSchema, loadAgentConfig } from '../../scripts/agent/config.ts';

describe('agent.config.json', () => {
  const config = loadAgentConfig();

  it('is valid; level 1 auto-merges nothing, and the current level is the one PLAN.md records', () => {
    expect([1, 2, 3]).toContain(config.autonomyLevel);
    expect(config.autoMergeSizes['1']).toEqual([]);
    // Changing the level is a deliberate owner decision, so it must be recorded in the plan too.
    const plan = readFileSync(resolve(import.meta.dirname, '../../PLAN.md'), 'utf8');
    expect(plan).toMatch(
      new RegExp(
        `\\| 8 +\\| Seed backlog & dry run \\|[^|\\n]*level ${String(config.autonomyLevel)}\\b`,
      ),
    );
  });

  it('allows auto-merge only for S and M, and only more as the level rises', () => {
    expect(config.autoMergeSizes['2']).toEqual(['S']);
    expect(config.autoMergeSizes['3']).toEqual(['S', 'M']);
  });

  it('protects itself, the rulebook, CI and the guardrail scripts', () => {
    for (const p of [
      'agent.config.json',
      'CLAUDE.md',
      '.github/**',
      '.claude/**',
      'scripts/agent/**',
    ]) {
      expect(config.protectedPaths).toContain(p);
    }
    expect(config.goldenPaths).toEqual(['tests/replays/**']);
  });

  it('rejects malformed configs', () => {
    const bad = { ...config, autonomyLevel: 4 };
    expect(AgentConfigSchema.safeParse(bad).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ ...config, wipLimit: 0 }).success).toBe(false);
    expect(AgentConfigSchema.safeParse({ ...config, autoMergeSizes: { 1: ['L'] } }).success).toBe(
      false,
    );
  });
});
