import { describe, expect, it } from 'vitest';
import {
  pickNext,
  pickSpecific,
  ticketOfPr,
  type Snapshot,
} from '../../scripts/agent/pick-next.ts';
import type { RunLogEntry } from '../../scripts/agent/run-log.ts';
import type { PullRequest, Ticket } from '../../scripts/agent/tracker/types.ts';

const NOW = new Date('2026-10-20T15:00:00Z');
const config = { wipLimit: 1, maxTicketsStartedPerDay: 6 };

let seq = 0;
function ticket(number: number, labels: string[], extra: Partial<Ticket> = {}): Ticket {
  seq++;
  return {
    number,
    title: `Ticket ${String(number)}`,
    body: '',
    labels,
    state: 'open',
    createdAt: `2026-10-01T00:00:${String(seq).padStart(2, '0')}Z`,
    author: 'hezrie',
    authorAssociation: 'OWNER',
    ...extra,
  };
}

function pr(number: number, headRef: string, extra: Partial<PullRequest> = {}): PullRequest {
  return {
    number,
    title: `PR ${String(number)}`,
    headRef,
    isDraft: false,
    createdAt: '2026-10-10T00:00:00Z',
    labels: [],
    reviewDecision: 'REVIEW_REQUIRED',
    closesIssues: [],
    ...extra,
  };
}

function snap(partial: Partial<Snapshot>): Snapshot {
  return { tickets: [], pullRequests: [], issueStates: new Map(), runLog: [], ...partial };
}

function started(
  n: number,
  at = NOW.toISOString(),
  mode: RunLogEntry['mode'] = 'implement',
): RunLogEntry {
  return {
    v: 1,
    role: 'worker',
    issue: n,
    pr: null,
    mode,
    outcome: 'pr-opened',
    attempt: 1,
    turns: 10,
    durationSec: 60,
    costUsd: 0.5,
    startedAt: at,
    runUrl: null,
    note: null,
  };
}

const READY_S = ['status:ready', 'size:S', 'type:feature'];

describe('pickNext ordering', () => {
  it('picks by priority (P0 first), then oldest first', () => {
    const s = snap({
      tickets: [
        ticket(1, [...READY_S, 'priority:P2']),
        ticket(2, [...READY_S, 'priority:P1']),
        ticket(3, [...READY_S, 'priority:P1']),
        ticket(4, [...READY_S, 'priority:P0']),
      ],
    });
    expect(pickNext(s, config, NOW)).toMatchObject({ issue: 4, mode: 'implement' });
    const withoutP0 = snap({ tickets: s.tickets.filter((t) => t.number !== 4) });
    expect(pickNext(withoutP0, config, NOW)).toMatchObject({ issue: 2 });
  });

  it('puts tickets without a priority last', () => {
    const s = snap({ tickets: [ticket(1, READY_S), ticket(2, [...READY_S, 'priority:P3'])] });
    expect(pickNext(s, config, NOW).issue).toBe(2);
  });

  it('prefers M tickets with an approved plan over everything else ready', () => {
    const s = snap({
      tickets: [
        ticket(1, [...READY_S, 'priority:P0']),
        ticket(2, ['status:ready', 'size:M', 'priority:P3', 'plan:approved']),
      ],
    });
    expect(pickNext(s, config, NOW)).toMatchObject({ issue: 2, mode: 'implement' });
  });

  it('asks for a plan first on M tickets without an approved plan', () => {
    const s = snap({ tickets: [ticket(5, ['status:ready', 'size:M', 'priority:P1'])] });
    expect(pickNext(s, config, NOW)).toMatchObject({ issue: 5, mode: 'plan' });
  });

  it('skips tickets whose plan is awaiting review, and tickets without a size', () => {
    const s = snap({
      tickets: [
        ticket(1, ['status:ready', 'size:M', 'priority:P0', 'plan:proposed']),
        ticket(2, ['status:ready', 'priority:P0']),
        ticket(3, [...READY_S, 'priority:P3']),
      ],
    });
    expect(pickNext(s, config, NOW).issue).toBe(3);
  });

  it('only considers status:ready tickets', () => {
    const s = snap({
      tickets: [
        ticket(1, ['status:proposed', 'size:S', 'priority:P0']),
        ticket(2, ['status:needs-refinement', 'size:S']),
        ticket(3, ['status:needs-human', 'size:S']),
      ],
    });
    expect(pickNext(s, config, NOW)).toMatchObject({
      issue: null,
      reason: 'no status:ready tickets',
    });
  });
});

describe('pickNext blockers', () => {
  it('skips tickets blocked by open issues and explains why', () => {
    const s = snap({
      tickets: [
        ticket(7, [...READY_S, 'priority:P0'], { body: 'Blocked by #3' }),
        ticket(3, ['status:proposed']),
      ],
      issueStates: new Map([[3, 'open']]),
    });
    expect(pickNext(s, config, NOW)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('#7 blocked by #3') as string,
    });
  });

  it('starts a ticket once all its blockers are closed', () => {
    const s = snap({
      tickets: [ticket(7, READY_S, { body: '### Dependencies\n\nBlocked by #3\nBlocked by #4' })],
      issueStates: new Map([
        [3, 'closed'],
        [4, 'closed'],
      ]),
    });
    expect(pickNext(s, config, NOW).issue).toBe(7);
  });

  it('treats blockers with unknown state as open (conservative)', () => {
    const s = snap({ tickets: [ticket(7, READY_S, { body: 'Blocked by #99' })] });
    expect(pickNext(s, config, NOW).issue).toBeNull();
  });
});

describe('pickNext WIP and caps', () => {
  it('starts nothing new while a ticket is in progress or in review (WIP limit 1)', () => {
    for (const status of ['status:in-progress', 'status:in-review']) {
      const s = snap({
        tickets: [ticket(1, [status, 'size:S']), ticket(2, [...READY_S, 'priority:P0'])],
      });
      expect(pickNext(s, config, NOW)).toMatchObject({
        issue: null,
        reason: expect.stringContaining('WIP limit') as string,
      });
    }
  });

  it('honours a higher WIP limit', () => {
    const s = snap({ tickets: [ticket(1, ['status:in-review', 'size:S']), ticket(2, READY_S)] });
    expect(pickNext(s, { ...config, wipLimit: 2 }, NOW).issue).toBe(2);
  });

  it('does not count escalated (needs-human) tickets toward WIP', () => {
    const s = snap({ tickets: [ticket(1, ['status:needs-human', 'size:S']), ticket(2, READY_S)] });
    expect(pickNext(s, config, NOW).issue).toBe(2);
  });

  it('stops at the daily cap of tickets started today (UTC), not counting fix passes or other days', () => {
    const tickets = [ticket(9, READY_S)];
    const six = Array.from({ length: 6 }, (_, i) => started(i + 1));
    expect(pickNext(snap({ tickets, runLog: six }), config, NOW)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('daily cap') as string,
    });
    const notToday = [...six.slice(0, 5), started(6, '2026-10-19T23:59:59Z')];
    expect(pickNext(snap({ tickets, runLog: notToday }), config, NOW).issue).toBe(9);
    const withFix = [...six.slice(0, 5), started(6, NOW.toISOString(), 'fix')];
    expect(pickNext(snap({ tickets, runLog: withFix }), config, NOW).issue).toBe(9);
  });
});

describe('pickNext finish-before-start', () => {
  it('gives a changes-requested agent PR a fix pass before anything else, even at the WIP limit', () => {
    const s = snap({
      tickets: [ticket(4, ['status:in-review', 'size:S']), ticket(5, [...READY_S, 'priority:P0'])],
      pullRequests: [
        pr(20, 'agent/4-sand', { reviewDecision: 'CHANGES_REQUESTED', closesIssues: [4] }),
      ],
    });
    expect(pickNext(s, config, NOW)).toEqual({
      issue: 4,
      mode: 'fix',
      pr: 20,
      reason: 'finish before starting: PR #20 has changes requested',
    });
  });

  it('fixes the oldest such PR first and ignores drafts, non-agent branches and escalated tickets', () => {
    const s = snap({
      tickets: [
        ticket(1, ['status:in-review', 'size:S']),
        ticket(2, ['status:needs-human', 'size:S']),
        ticket(3, ['status:in-review', 'size:S']),
      ],
      pullRequests: [
        pr(30, 'agent/2-x', {
          reviewDecision: 'CHANGES_REQUESTED',
          createdAt: '2026-10-01T00:00:00Z',
        }),
        pr(31, 'feature/human', { reviewDecision: 'CHANGES_REQUESTED', closesIssues: [1] }),
        pr(32, 'agent/1-y', { reviewDecision: 'CHANGES_REQUESTED', isDraft: true }),
        pr(33, 'agent/3-z', {
          reviewDecision: 'CHANGES_REQUESTED',
          createdAt: '2026-10-05T00:00:00Z',
        }),
      ],
    });
    expect(pickNext(s, { ...config, wipLimit: 5 }, NOW)).toMatchObject({
      issue: 3,
      mode: 'fix',
      pr: 33,
    });
  });

  it('links PRs to tickets by "Closes #N", falling back to the agent/<N>-slug branch', () => {
    expect(ticketOfPr(pr(1, 'agent/12-sand', { closesIssues: [12] }))).toBe(12);
    expect(ticketOfPr(pr(1, 'agent/12-sand'))).toBe(12);
    expect(ticketOfPr(pr(1, 'random'))).toBeNull();
  });
});

describe('pickSpecific (manual dispatch)', () => {
  it('starts the requested ticket even when it is not next, ignoring WIP and cap', () => {
    const s = snap({
      tickets: [ticket(1, ['status:in-review', 'size:S']), ticket(2, [...READY_S, 'priority:P3'])],
      runLog: Array.from({ length: 6 }, (_, i) => started(i)),
    });
    expect(pickSpecific(s, 2)).toMatchObject({ issue: 2, mode: 'implement' });
  });

  it('refuses tickets that are blocked, not ready or missing', () => {
    const s = snap({
      tickets: [
        ticket(1, READY_S, { body: 'Blocked by #8' }),
        ticket(2, ['status:proposed', 'size:S']),
      ],
    });
    expect(pickSpecific(s, 1)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('blocked by #8') as string,
    });
    expect(pickSpecific(s, 2)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('status is status:proposed') as string,
    });
    expect(pickSpecific(s, 99)).toMatchObject({ issue: null });
  });

  it('runs a fix pass when the requested ticket has changes requested', () => {
    const s = snap({
      tickets: [ticket(4, ['status:in-review', 'size:S'])],
      pullRequests: [pr(20, 'agent/4-x', { reviewDecision: 'CHANGES_REQUESTED' })],
    });
    expect(pickSpecific(s, 4)).toMatchObject({ mode: 'fix', pr: 20 });
  });
});
