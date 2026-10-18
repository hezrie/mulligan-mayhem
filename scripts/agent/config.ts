/**
 * Loads and validates agent.config.json, the single source of truth for the agent loop:
 * autonomy level, caps, models, protected paths. PROTECTED: agents may not edit this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const Size = z.enum(['S', 'M']);
const PerRole = <T extends z.ZodType>(t: T) =>
  z.strictObject({ refiner: t, worker: t, reviewer: t, digest: t });

export const AgentConfigSchema = z.strictObject({
  autonomyLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  autoMergeSizes: z.strictObject({ '1': z.array(Size), '2': z.array(Size), '3': z.array(Size) }),
  wipLimit: z.int().min(1),
  maxTicketsStartedPerDay: z.int().min(1),
  /**
   * Keep at least this many startable tickets queued by promoting planned backlog tickets
   * (status:proposed with an epic:* label, never agent proposals) in priority order. 0 = off.
   */
  autoPromoteMinReady: z.int().min(0),
  maxAttemptsPerTicket: z.int().min(1),
  maxAgentProposedTicketsPerDay: z.int().min(0),
  maxTurns: PerRole(z.int().min(1)),
  workerCron: z.string().regex(/^(\S+\s+){4}\S+$/, 'five-field cron expression'),
  architectureReviewEveryNMerges: z.int().min(1),
  models: PerRole(z.string().min(1)),
  workflowTimeoutMinutes: PerRole(z.int().min(1)),
  trustedSubmitters: z.array(z.string().regex(/^[A-Za-z0-9-]+$/)),
  protectedPaths: z.array(z.string().min(1)).min(1),
  /** Never in a git diff (so not in CODEOWNERS/agent-guard), but agents must not touch them. */
  workspaceProtectedPaths: z.array(z.string().min(1)),
  goldenPaths: z.array(z.string().min(1)),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const REPO_ROOT = join(import.meta.dirname, '..', '..');

export function loadAgentConfig(path = join(REPO_ROOT, 'agent.config.json')): AgentConfig {
  return AgentConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
