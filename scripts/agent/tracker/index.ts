/** Chooses the tracker adapter. Only GitHub exists today; TRACKER=jira would plug in here. PROTECTED. */
import { execGhClient, repoFromEnv } from './gh-client.ts';
import { GitHubTracker } from './github.ts';
import type { Tracker } from './types.ts';

export function createTracker(env: NodeJS.ProcessEnv = process.env): Tracker {
  const kind = env['TRACKER'] ?? 'github';
  if (kind !== 'github') throw new Error(`Unsupported TRACKER "${kind}" (only "github" exists)`);
  return new GitHubTracker(execGhClient(), repoFromEnv(env));
}

export type { Tracker } from './types.ts';
