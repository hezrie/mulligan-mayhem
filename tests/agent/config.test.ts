import { describe, expect, it } from 'vitest';
import { AgentConfigSchema, loadAgentConfig } from '../../scripts/agent/config.ts';

describe('agent.config.json', () => {
  const config = loadAgentConfig();

  it('is valid and starts at autonomy level 1 (agent opens PRs, human merges)', () => {
    expect(config.autonomyLevel).toBe(1);
    expect(config.autoMergeSizes['1']).toEqual([]);
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
