/**
 * Reviewer bookkeeping: the verdict schemas the LLM must return (via --json-schema), CI
 * evaluation, consistency guards, and the review text. The worker never grades its own work;
 * this module never lets an inconsistent "approve" through. PROTECTED.
 */
import { z } from 'zod';
import type { CheckRun } from './github-pr.ts';

export const REQUIRED_CHECKS = ['check', 'agent-guard'] as const;

const Issue = z.strictObject({
  file: z.string().nullable(),
  problem: z.string().min(1),
  requiredChange: z.string().min(1),
});

export const PrVerdictSchema = z.strictObject({
  verdict: z.enum(['approve', 'request_changes']),
  summary: z.string().min(1).max(1500),
  criteria: z.array(
    z.strictObject({ criterion: z.string(), test: z.string().nullable(), satisfied: z.boolean() }),
  ),
  issues: z.array(Issue).max(15),
  scopeCreep: z.boolean(),
  testsWeakened: z.boolean(),
  layerViolation: z.boolean(),
});
export type PrVerdict = z.infer<typeof PrVerdictSchema>;

export const PlanVerdictSchema = z.strictObject({
  verdict: z.enum(['approve', 'request_changes']),
  summary: z.string().min(1).max(1500),
  issues: z.array(Issue).max(10),
});
export type PlanVerdict = z.infer<typeof PlanVerdictSchema>;

export interface CiStatus {
  readonly green: boolean;
  readonly failing: readonly string[];
  readonly pending: readonly string[];
}

export function evaluateChecks(
  runs: readonly CheckRun[],
  required: readonly string[] = REQUIRED_CHECKS,
): CiStatus {
  const failing: string[] = [];
  const pending: string[] = [];
  for (const name of required) {
    const latest = runs.filter((r) => r.name === name);
    if (latest.length === 0 || latest.some((r) => r.status !== 'completed')) pending.push(name);
    else if (latest.some((r) => r.conclusion !== 'success')) failing.push(name);
  }
  for (const r of runs) {
    if (!required.includes(r.name) && r.status === 'completed' && r.conclusion === 'failure')
      failing.push(r.name);
  }
  return { green: failing.length === 0 && pending.length === 0, failing, pending };
}

/** An "approve" that contradicts its own findings is turned into "request changes". */
export function enforceConsistency(v: PrVerdict): PrVerdict {
  const contradictions: string[] = [];
  if (v.criteria.length === 0) contradictions.push('no acceptance criteria were checked');
  if (v.criteria.some((c) => !c.satisfied || !c.test))
    contradictions.push('a criterion lacks a satisfying test');
  if (v.issues.length > 0) contradictions.push('issues were listed');
  if (v.scopeCreep) contradictions.push('scope creep was flagged');
  if (v.testsWeakened) contradictions.push('weakened tests were flagged');
  if (v.layerViolation) contradictions.push('a layer violation was flagged');
  if (v.verdict === 'approve' && contradictions.length > 0) {
    return {
      ...v,
      verdict: 'request_changes',
      summary: `${v.summary}\n\n(Auto-corrected to request changes: ${contradictions.join('; ')}.)`,
    };
  }
  return v;
}

function issueList(issues: readonly z.infer<typeof Issue>[]): string {
  return issues
    .map(
      (i, n) =>
        `${String(n + 1)}. ${i.file ? `\`${i.file}\`: ` : ''}${i.problem}\n   → **Change:** ${i.requiredChange}`,
    )
    .join('\n');
}

export function prReviewBody(v: PrVerdict, attempt: number, maxAttempts: number): string {
  const rows = v.criteria
    .map(
      (c) =>
        `| ${c.satisfied ? '✅' : '❌'} | ${c.criterion.replace(/\|/g, '\\|')} | ${c.test ? `\`${c.test.replace(/\|/g, '\\|')}\`` : '—'} |`,
    )
    .join('\n');
  const flags = [
    v.scopeCreep && '⚠️ scope creep',
    v.testsWeakened && '⚠️ tests weakened or removed',
    v.layerViolation && '⚠️ layer violation',
  ].filter(Boolean);
  return [
    `## 🤖 Review: ${v.verdict === 'approve' ? '✅ approved' : '🔁 changes requested'}`,
    v.summary,
    rows ? `| | Acceptance criterion | Test |\n|---|---|---|\n${rows}` : '',
    flags.length ? flags.join(' · ') : '',
    v.issues.length ? `### Required changes\n${issueList(v.issues)}` : '',
    v.verdict === 'request_changes'
      ? `_Attempt ${String(attempt)}/${String(maxAttempts)}. The worker will address these on its next run._`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function ciFailureVerdict(ci: CiStatus): PrVerdict {
  return {
    verdict: 'request_changes',
    summary: `CI is not green, so this can't be approved. Failing: ${ci.failing.join(', ') || 'none'}; pending: ${ci.pending.join(', ') || 'none'}.`,
    criteria: [],
    issues: ci.failing.map((name) => ({
      file: null,
      problem: `The \`${name}\` check failed.`,
      requiredChange: `Reproduce with \`npm run check\` locally, fix the cause (never weaken a test), and push.`,
    })),
    scopeCreep: false,
    testsWeakened: false,
    layerViolation: false,
  };
}

export function planReviewComment(v: PlanVerdict): string {
  return [
    `## 🤖 Plan review: ${v.verdict === 'approve' ? '✅ approved, implementation can start' : '🔁 changes requested'}`,
    v.summary,
    v.issues.length ? `### Required changes\n${issueList(v.issues)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** JSON Schema for claude --json-schema. Single-quote free so it can sit inside claude_args. */
export function jsonSchemaFor(schema: z.ZodType): string {
  const json = JSON.stringify(z.toJSONSchema(schema));
  if (json.includes("'")) throw new Error('schema text must not contain single quotes');
  return json;
}
