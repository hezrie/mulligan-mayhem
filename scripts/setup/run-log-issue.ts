/**
 * Creates and pins the "🤖 Agent Run Log" issue (label meta:run-log) if it doesn't exist yet.
 * Idempotent. Every agent run appends one JSON comment to it (scripts/agent/run-log.ts).
 *
 *   GITHUB_REPOSITORY=hezrie/mulligan-mayhem npm run setup:run-log
 *
 * PROTECTED.
 */
import { pathToFileURL } from 'node:url';
import { META } from '../agent/labels.ts';
import { execGhClient, repoFromEnv, type GhClient } from '../agent/tracker/gh-client.ts';
import { GitHubTracker } from '../agent/tracker/github.ts';

export const RUN_LOG_TITLE = '🤖 Agent Run Log';

export const RUN_LOG_BODY = `Every agent run (refiner, worker, reviewer, merger, closer, digest) appends **one JSON comment** here:
role, issue, PR, mode, outcome, attempt, turns, duration and cost.

- The picker reads it to enforce the daily cap on tickets started.
- The weekly digest reads it to compute first-pass success, the needs-human rate, turns and cost.

Please don't close or unpin this issue. Human comments are fine; they're ignored by the parsers.`;

interface PinnedIssues {
  repository: {
    pinnedIssues: {
      nodes: { issue: { number: number; labels: { nodes: { name: string }[] } } }[];
    };
  };
}

const PINNED = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pinnedIssues(first: 3) { nodes { issue { number labels(first: 20) { nodes { name } } } } }
  }
}`;

export async function ensureRunLogIssue(
  gh: GhClient,
  repo: string,
): Promise<{ number: number; created: boolean }> {
  const [owner = '', name = ''] = repo.split('/');
  // Pinned issues are consistent immediately. The label-filtered issue list can lag by seconds
  // after an issue is created, which once produced a duplicate log.
  const pinned = await gh.graphql<PinnedIssues | null>(PINNED, { owner, name });
  const pinnedLog = pinned?.repository.pinnedIssues.nodes
    .map((n) => n.issue)
    .filter((i) => i.labels.nodes.some((l) => l.name === META.runLog))
    .sort((a, b) => a.number - b.number)[0];
  if (pinnedLog) return { number: pinnedLog.number, created: false };

  const tracker = new GitHubTracker(gh, repo);
  const existing = await tracker.findOpenTicketByLabel(META.runLog);
  if (existing) return { number: existing.number, created: false };

  const number = await tracker.createTicket({
    title: RUN_LOG_TITLE,
    body: RUN_LOG_BODY,
    labels: [META.runLog],
  });
  const { repository } = await gh.graphql<{ repository: { issue: { id: string } } }>(
    'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { id } } }',
    { owner, name, number },
  );
  await gh.graphql(
    'mutation($id: ID!) { pinIssue(input: { issueId: $id }) { issue { number } } }',
    {
      id: repository.issue.id,
    },
  );
  return { number, created: true };
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  ensureRunLogIssue(execGhClient(), repoFromEnv())
    .then(({ number, created }) => {
      console.log(
        `${created ? 'created and pinned' : 'found existing'} run log issue #${String(number)}`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
