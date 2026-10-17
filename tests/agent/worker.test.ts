import { describe, expect, it } from 'vitest';
import {
  decideWorkerOutcome,
  finalizePrBody,
  planAttemptBump,
  planComment,
  planWorkerStart,
  prLabelsFromTicket,
  slugify,
  type WorkerFinishInput,
} from '../../scripts/agent/worker.ts';

const RUN = 'https://github.com/hezrie/mulligan-mayhem/actions/runs/1';

describe('slugify', () => {
  it('makes short, safe branch slugs', () => {
    expect(slugify('[Ticket] Sand + rough friction zones!')).toBe('sand-rough-friction-zones');
    expect(slugify('A'.repeat(80))).toHaveLength(40);
    expect(slugify('!!!')).toBe('ticket');
  });
});

describe('planWorkerStart', () => {
  const base = {
    issue: 12,
    title: 'Sand friction',
    labels: ['status:ready', 'size:S'],
    mode: 'implement' as const,
    prHeadRef: null,
    maxAttempts: 2,
    runUrl: RUN,
  };

  it('first pickup: in-progress, attempt 1, fresh agent branch', () => {
    expect(planWorkerStart(base)).toEqual({
      attempt: 1,
      branch: 'agent/12-sand-friction',
      allowGolden: false,
      labels: { add: ['status:in-progress', 'agent:attempt-1'], remove: ['status:ready'] },
      comment: `🤖 picked up: implementing this ticket (attempt 1/2). [Run log](${RUN})`,
    });
  });

  it('a retry keeps its attempt label and uses a distinct branch (no force-pushes ever needed)', () => {
    const plan = planWorkerStart({
      ...base,
      labels: ['status:ready', 'size:S', 'agent:attempt-2'],
    });
    expect(plan.attempt).toBe(2);
    expect(plan.branch).toBe('agent/12-sand-friction-a2');
    expect(plan.labels.add).toEqual(['status:in-progress']);
  });

  it('a fix pass works on the existing PR branch', () => {
    const plan = planWorkerStart({
      ...base,
      mode: 'fix',
      prHeadRef: 'agent/12-sand-friction',
      labels: ['status:in-review', 'size:S', 'agent:attempt-2'],
    });
    expect(plan.branch).toBe('agent/12-sand-friction');
    expect(plan.labels.remove).toEqual(['status:in-review']);
  });

  it('allows golden replay changes only for physics-change tickets', () => {
    expect(
      planWorkerStart({ ...base, labels: [...base.labels, 'physics-change'] }).allowGolden,
    ).toBe(true);
  });
});

describe('decideWorkerOutcome', () => {
  const ok: WorkerFinishInput = {
    mode: 'implement',
    escalated: false,
    planText: null,
    hasChanges: true,
    checkPassed: true,
    claudeSubtype: 'success',
  };

  it.each([
    [
      'escalation wins over everything',
      { ...ok, escalated: true, checkPassed: false },
      'escalated',
    ],
    ['implemented and checked', ok, 'pr-opened'],
    ['fix pass checked', { ...ok, mode: 'fix' as const }, 'fix-pushed'],
    ['no changes', { ...ok, hasChanges: false }, 'failed'],
    ['check not passed', { ...ok, checkPassed: false }, 'failed'],
    [
      'plan written',
      { ...ok, mode: 'plan' as const, planText: 'x'.repeat(200), hasChanges: false },
      'plan-posted',
    ],
    ['plan missing', { ...ok, mode: 'plan' as const, planText: null }, 'failed'],
    ['plan too short', { ...ok, mode: 'plan' as const, planText: 'do it' }, 'failed'],
  ])('%s', (_label, input, outcome) => {
    expect(decideWorkerOutcome(input).outcome).toBe(outcome);
  });

  it('explains a max-turns failure', () => {
    expect(
      decideWorkerOutcome({ ...ok, hasChanges: false, claudeSubtype: 'error_max_turns' }).reason,
    ).toContain('turn limit');
  });
});

describe('planAttemptBump', () => {
  it('moves to the next attempt and back to the queue while attempts remain', () => {
    expect(
      planAttemptBump({
        labels: ['status:in-progress', 'agent:attempt-1'],
        maxAttempts: 2,
        backToStatus: 'status:ready',
      }),
    ).toEqual({
      exhausted: false,
      nextAttempt: 2,
      labels: {
        add: ['agent:attempt-2', 'status:ready'],
        remove: ['agent:attempt-1', 'status:in-progress'],
      },
    });
  });

  it('keeps a PR in review after a changes-requested round', () => {
    const bump = planAttemptBump({
      labels: ['status:in-review', 'agent:attempt-1'],
      maxAttempts: 2,
      backToStatus: 'status:in-review',
    });
    expect(bump.labels).toEqual({
      add: ['agent:attempt-2', 'status:in-review'],
      remove: ['agent:attempt-1'],
    });
  });

  it('hands the ticket to the owner when attempts are exhausted', () => {
    expect(
      planAttemptBump({
        labels: ['status:in-progress', 'agent:attempt-2'],
        maxAttempts: 2,
        backToStatus: 'status:ready',
      }),
    ).toEqual({
      exhausted: true,
      nextAttempt: 2,
      labels: { add: ['status:needs-human'], remove: ['status:in-progress'] },
    });
  });
});

describe('PR helpers', () => {
  it('copies only size, type, priority and physics-change labels to the PR', () => {
    expect(
      prLabelsFromTicket([
        'status:in-progress',
        'size:S',
        'type:feature',
        'priority:P1',
        'agent:attempt-1',
        'physics-change',
      ]),
    ).toEqual(['size:S', 'type:feature', 'priority:P1', 'physics-change']);
  });

  it('always closes the ticket, without duplicating an existing Closes line', () => {
    expect(finalizePrBody('Did it.\n\nCloses #12', 12, RUN).match(/Closes #12/g)).toHaveLength(1);
    expect(finalizePrBody('Did it.', 12, RUN)).toContain('Closes #12');
    expect(finalizePrBody(null, 12, RUN)).toContain('did not write a PR description');
  });

  it('marks plan comments so the reviewer can find them', () => {
    expect(planComment('1. Do X\n2. Test Y')).toMatch(
      /^<!-- mm:plan -->\n## 🤖 Implementation plan/,
    );
  });
});
