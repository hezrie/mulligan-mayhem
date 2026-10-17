/** Closer: summary comment and label cleanup when a ticket closes, plus the architecture-review counter. PROTECTED. */
import { ATTEMPT_PREFIX, PLAN, STATUS_LABELS } from './labels.ts';

export const PAGES_URL = 'https://hezrie.github.io/mulligan-mayhem/';

export function labelsToStrip(labels: readonly string[]): string[] {
  return labels.filter(
    (l) =>
      (STATUS_LABELS as readonly string[]).includes(l) ||
      l.startsWith(ATTEMPT_PREFIX) ||
      l === PLAN.proposed,
  );
}

export function closeSummary(
  pr: { number: number; title: string; url: string } | null,
  repo: string,
): string | null {
  if (!pr) return null;
  return `## ✅ Done\n\nShipped in [#${String(pr.number)} ${pr.title}](${pr.url}).\n\n- **Play it:** ${PAGES_URL} (live once the [Deploy workflow](https://github.com/${repo}/actions/workflows/deploy.yml) for this merge finishes)\n- Status labels removed.`;
}

export const ARCH_REVIEW_TITLE = 'Architecture & drift review';

export function shouldOpenArchitectureReview(
  mergedSinceLastReview: number,
  everyN: number,
): boolean {
  return mergedSinceLastReview >= everyN;
}

export function architectureReviewBody(mergedCount: number): string {
  return `Automatic checkpoint after ${String(mergedCount)} merged agent PRs. Please spend 20 minutes on:

- [ ] Skim \`git log\` since the last review: any pattern of hacks, duplication or drift from docs/ARCHITECTURE.md?
- [ ] Is \`src/main.ts\` still wiring only? Are layers still clean (\`npm run lint:deps\` passes, but is the *design* still clean)?
- [ ] Are tests still meaningful (not just coverage-padding)? Any slow or flaky tests?
- [ ] Do CLAUDE.md and .agent/LESSONS.md still match reality? Anything to add from recent escalations?
- [ ] Is it time to change \`autonomyLevel\` (see the latest weekly digest)?

File follow-ups as tickets, then close this issue.`;
}
