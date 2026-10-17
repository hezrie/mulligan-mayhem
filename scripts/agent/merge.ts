/**
 * The merge gate. Auto-merges (squash) only when ALL hold: CI green, the reviewer approved the
 * current head, the ticket size is allowed at the current autonomy level, and no protected path
 * (or existing golden replay) is in the diff. Otherwise: "Ready for human merge". PROTECTED.
 */
import type { AgentConfig } from './config.ts';
import type { PrInfo, Review } from './github-pr.ts';
import { AGENT_APPROVED } from './labels.ts';
import { classifyChange, type FileChange } from './protected.ts';
import type { CiStatus } from './review.ts';
import { sizeOf } from './tickets.ts';

export const REVIEWER_LOGIN = 'github-actions[bot]';

export interface MergeInput {
  readonly pr: PrInfo;
  readonly ci: CiStatus;
  readonly reviews: readonly Review[];
  readonly files: readonly FileChange[];
  readonly config: Pick<
    AgentConfig,
    'autonomyLevel' | 'autoMergeSizes' | 'protectedPaths' | 'goldenPaths'
  >;
}

export interface MergeDecision {
  readonly action: 'merge' | 'human' | 'wait';
  readonly reasons: readonly string[];
}

export function reviewerApprovedHead(reviews: readonly Review[], headSha: string): boolean {
  const mine = reviews.filter(
    (r) =>
      r.author === REVIEWER_LOGIN && (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED'),
  );
  const latest = [...mine].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).at(-1);
  return latest?.state === 'APPROVED' && latest.commitId === headSha;
}

export function decideMerge(input: MergeInput): MergeDecision {
  const { pr, ci, config } = input;
  if (pr.state !== 'open' || pr.merged) return { action: 'wait', reasons: ['PR is not open'] };
  if (!pr.headRef.startsWith('agent/') || pr.draft)
    return { action: 'wait', reasons: ['not a ready agent PR'] };
  if (!ci.green)
    return {
      action: 'wait',
      reasons: [
        `CI not green (failing: ${ci.failing.join(', ') || '-'}, pending: ${ci.pending.join(', ') || '-'})`,
      ],
    };
  if (!reviewerApprovedHead(input.reviews, pr.headSha) || !pr.labels.includes(AGENT_APPROVED)) {
    return { action: 'wait', reasons: ['the reviewer has not approved the current head commit'] };
  }

  const reasons: string[] = [];
  const size = sizeOf(pr.labels);
  const allowed = config.autoMergeSizes[String(config.autonomyLevel) as '1' | '2' | '3'];
  if (size === null) reasons.push('the PR has no size label');
  else if (!allowed.includes(size)) {
    reasons.push(
      `autonomy level ${String(config.autonomyLevel)} auto-merges ${allowed.length ? allowed.join(' and ') : 'nothing'}; this is size ${size}`,
    );
  }
  for (const change of input.files) {
    // Golden replay changes always need a human, even with physics-change.
    const verdict = classifyChange(change, config, false);
    if (!verdict.allowed) reasons.push(verdict.reason);
  }
  return reasons.length === 0
    ? { action: 'merge', reasons: ['all merge conditions hold'] }
    : { action: 'human', reasons };
}

export const HUMAN_MERGE_MARKER = '<!-- mm:ready-for-human -->';

export function humanMergeComment(headSha: string, reasons: readonly string[]): string {
  return `${HUMAN_MERGE_MARKER}<!-- sha:${headSha} -->\n## ✅ Ready for human merge\n\nCI is green and the reviewer approved \`${headSha.slice(0, 7)}\`. Not auto-merged because:\n${reasons.map((r) => `- ${r}`).join('\n')}\n\nMerge with **Squash and merge** when you're happy.`;
}
