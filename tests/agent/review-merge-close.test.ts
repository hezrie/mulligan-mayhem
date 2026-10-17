import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  closeSummary,
  labelsToStrip,
  shouldOpenArchitectureReview,
} from '../../scripts/agent/close.ts';
import { loadAgentConfig } from '../../scripts/agent/config.ts';
import type { PrInfo, Review } from '../../scripts/agent/github-pr.ts';
import {
  decideMerge,
  humanMergeComment,
  reviewerApprovedHead,
  type MergeInput,
} from '../../scripts/agent/merge.ts';
import {
  ciFailureVerdict,
  enforceConsistency,
  evaluateChecks,
  jsonSchemaFor,
  PlanVerdictSchema,
  prReviewBody,
  PrVerdictSchema,
  type PrVerdict,
} from '../../scripts/agent/review.ts';
import { RefinementSchema } from '../../scripts/agent/refine.ts';

const SHA = 'abc1234def';
const green = [
  { name: 'check', status: 'completed', conclusion: 'success' },
  { name: 'agent-guard', status: 'completed', conclusion: 'success' },
  { name: 'actionlint', status: 'completed', conclusion: 'success' },
];

describe('evaluateChecks', () => {
  it('is green only when every required check succeeded', () => {
    expect(evaluateChecks(green)).toEqual({ green: true, failing: [], pending: [] });
    expect(evaluateChecks(green.slice(1))).toMatchObject({ green: false, pending: ['check'] });
    expect(evaluateChecks([{ ...green[0]!, conclusion: 'failure' }, green[1]!])).toMatchObject({
      green: false,
      failing: ['check'],
    });
    expect(
      evaluateChecks([green[0]!, { name: 'agent-guard', status: 'in_progress', conclusion: null }]),
    ).toMatchObject({ pending: ['agent-guard'] });
  });

  it('judges each check by its newest run (a re-run or a label-triggered run replaces the old one)', () => {
    const guard = (id: number, startedAt: string, conclusion: string) => ({
      id,
      name: 'agent-guard',
      status: 'completed',
      conclusion,
      startedAt,
    });
    const runs = [
      green[0]!,
      guard(5, '2026-10-20T10:00:00Z', 'failure'), // `opened`, before the PR labels existed
      guard(6, '2026-10-20T10:01:00Z', 'success'), // `labeled`, with physics-change
    ];
    expect(evaluateChecks(runs)).toEqual({ green: true, failing: [], pending: [] });
    expect(evaluateChecks([...runs, guard(7, '2026-10-20T10:02:00Z', 'failure')]).failing).toEqual([
      'agent-guard',
    ]);
    expect(
      evaluateChecks([
        ...runs,
        {
          id: 8,
          name: 'agent-guard',
          status: 'in_progress',
          conclusion: null,
          startedAt: '2026-10-20T10:03:00Z',
        },
      ]).pending,
    ).toEqual(['agent-guard']);
  });

  it('also treats any other failed check as red', () => {
    expect(
      evaluateChecks([
        ...green.slice(0, 2),
        { name: 'actionlint', status: 'completed', conclusion: 'failure' },
      ]).green,
    ).toBe(false);
  });
});

const approve: PrVerdict = {
  verdict: 'approve',
  summary: 'Looks good.',
  criteria: [
    {
      criterion: 'Sand decelerates 3×',
      test: 'tests/unit/core/physics/step.test.ts › sand',
      satisfied: true,
    },
  ],
  issues: [],
  scopeCreep: false,
  testsWeakened: false,
  layerViolation: false,
};

describe('reviewer verdicts', () => {
  it('keeps a consistent approval', () => {
    expect(enforceConsistency(approve)).toEqual(approve);
  });

  it.each([
    ['an unsatisfied criterion', { criteria: [{ criterion: 'x', test: 't', satisfied: false }] }],
    ['a criterion without a test', { criteria: [{ criterion: 'x', test: null, satisfied: true }] }],
    ['no criteria checked', { criteria: [] }],
    ['listed issues', { issues: [{ file: null, problem: 'p', requiredChange: 'c' }] }],
    ['weakened tests', { testsWeakened: true }],
    ['scope creep', { scopeCreep: true }],
    ['a layer violation', { layerViolation: true }],
  ])('turns an approval with %s into request changes', (_label, change) => {
    const v = enforceConsistency({ ...approve, ...change });
    expect(v.verdict).toBe('request_changes');
    expect(v.summary).toContain('Auto-corrected');
  });

  it('writes a readable review with the criterion → test table and attempt counter', () => {
    const body = prReviewBody(
      {
        ...approve,
        verdict: 'request_changes',
        issues: [
          { file: 'src/a.ts', problem: 'Magic number', requiredChange: 'Move it to constants.ts' },
        ],
      },
      1,
      2,
    );
    expect(body).toContain('🔁 changes requested');
    expect(body).toContain('| ✅ | Sand decelerates 3× |');
    expect(body).toContain('`src/a.ts`: Magic number');
    expect(body).toContain('Attempt 1/2');
  });

  it('requests changes deterministically when CI is red, without spending an LLM call', () => {
    const v = ciFailureVerdict({ green: false, failing: ['check'], pending: [] });
    expect(v.verdict).toBe('request_changes');
    expect(v.issues[0]?.problem).toContain('`check`');
  });

  it('exports JSON Schemas that fit inside claude_args', () => {
    for (const schema of [PrVerdictSchema, PlanVerdictSchema, RefinementSchema]) {
      const json = jsonSchemaFor(schema);
      expect(JSON.parse(json)).toMatchObject({ type: 'object' });
      expect(json).not.toContain("'");
    }
  });

  it('exports schemas a default (draft-07) validator accepts, as Claude Code requires', () => {
    for (const schema of [PrVerdictSchema, PlanVerdictSchema, RefinementSchema]) {
      const parsed = JSON.parse(jsonSchemaFor(schema)) as Record<string, unknown>;
      expect(parsed['$schema']).toBeUndefined();
      expect(() => new Ajv().compile(parsed)).not.toThrow();
    }
    // A verdict the reviewer would return validates against its own schema.
    const validate = new Ajv().compile(
      JSON.parse(jsonSchemaFor(PrVerdictSchema)) as Record<string, unknown>,
    );
    expect(validate(approve)).toBe(true);
  });
});

const pr: PrInfo = {
  number: 30,
  title: 'feat: sand',
  body: '',
  state: 'open',
  merged: false,
  draft: false,
  headRef: 'agent/12-sand',
  headSha: SHA,
  headRepo: 'hezrie/mulligan-mayhem',
  baseRef: 'main',
  labels: ['size:S', 'agent-approved'],
  author: 'mulligan-mayhem-agent[bot]',
  url: 'u',
  mergeable: true,
};
const approvedReview: Review = {
  id: 1,
  body: '',
  author: 'github-actions[bot]',
  state: 'APPROVED',
  commitId: SHA,
  submittedAt: '2026-10-20T10:00:00Z',
};
const config = loadAgentConfig();

function input(overrides: Partial<MergeInput> = {}, level: 1 | 2 | 3 = 2): MergeInput {
  return {
    pr,
    ci: { green: true, failing: [], pending: [] },
    reviews: [approvedReview],
    files: [{ path: 'src/core/physics/terrain.ts', status: 'M' }],
    config: { ...config, autonomyLevel: level },
    ...overrides,
  };
}

describe('merge gate', () => {
  it('auto-merges an approved, green S PR at level 2', () => {
    expect(decideMerge(input()).action).toBe('merge');
  });

  it('hands every PR to the human at level 1', () => {
    const d = decideMerge(input({}, 1));
    expect(d.action).toBe('human');
    expect(d.reasons[0]).toContain('autonomy level 1 auto-merges nothing');
  });

  it('needs level 3 for M PRs', () => {
    const m = { ...pr, labels: ['size:M', 'agent-approved'] };
    expect(decideMerge(input({ pr: m }, 2)).action).toBe('human');
    expect(decideMerge(input({ pr: m }, 3)).action).toBe('merge');
  });

  it('never auto-merges protected paths or golden replay changes, even at level 3', () => {
    expect(decideMerge(input({ files: [{ path: 'CLAUDE.md', status: 'M' }] }, 3))).toMatchObject({
      action: 'human',
    });
    expect(
      decideMerge(
        input({ files: [{ path: 'tests/replays/skeleton-01-par.json', status: 'M' }] }, 3),
      ),
    ).toMatchObject({ action: 'human' });
    // CODEOWNERS covers tests/replays/, so even a brand-new replay needs the owner.
    expect(
      decideMerge(input({ files: [{ path: 'tests/replays/new.json', status: 'A' }] }, 3)),
    ).toMatchObject({
      action: 'human',
      reasons: [expect.stringContaining('CODEOWNERS') as string],
    });
  });

  it('waits (no comment) unless CI is green and the reviewer approved the current head', () => {
    expect(
      decideMerge(input({ ci: { green: false, failing: ['check'], pending: [] } })).action,
    ).toBe('wait');
    expect(decideMerge(input({ reviews: [{ ...approvedReview, commitId: 'old' }] })).action).toBe(
      'wait',
    );
    expect(decideMerge(input({ pr: { ...pr, labels: ['size:S'] } })).action).toBe('wait');
    expect(decideMerge(input({ pr: { ...pr, headRef: 'feature/x' } })).action).toBe('wait');
    expect(decideMerge(input({ pr: { ...pr, state: 'closed' } })).action).toBe('wait');
  });

  it('uses the reviewer’s latest decision, ignoring other reviewers', () => {
    const later = {
      ...approvedReview,
      state: 'CHANGES_REQUESTED',
      submittedAt: '2026-10-20T11:00:00Z',
    };
    expect(reviewerApprovedHead([approvedReview, later], SHA)).toBe(false);
    expect(
      reviewerApprovedHead(
        [later, { ...approvedReview, submittedAt: '2026-10-20T12:00:00Z' }],
        SHA,
      ),
    ).toBe(true);
    expect(reviewerApprovedHead([{ ...approvedReview, author: 'someone' }], SHA)).toBe(false);
  });

  it('writes an idempotent "Ready for human merge" comment pinned to the head SHA', () => {
    expect(humanMergeComment(SHA, ['level 1'])).toContain(`<!-- sha:${SHA} -->`);
  });
});

describe('closer', () => {
  it('strips status, attempt and plan-proposed labels but keeps the rest', () => {
    expect(
      labelsToStrip([
        'status:in-review',
        'agent:attempt-2',
        'plan:proposed',
        'plan:approved',
        'size:S',
        'type:feature',
      ]),
    ).toEqual(['status:in-review', 'agent:attempt-2', 'plan:proposed']);
  });

  it('summarizes only issues closed by a merged PR', () => {
    expect(closeSummary(null, 'o/r')).toBeNull();
    const text = closeSummary(
      { number: 30, title: 'feat: sand', url: 'https://x/30' },
      'hezrie/mulligan-mayhem',
    );
    expect(text).toContain('[#30 feat: sand](https://x/30)');
    expect(text).toContain('https://hezrie.github.io/mulligan-mayhem/');
  });

  it('opens an architecture review every N merges', () => {
    expect(shouldOpenArchitectureReview(9, 10)).toBe(false);
    expect(shouldOpenArchitectureReview(10, 10)).toBe(true);
  });
});
