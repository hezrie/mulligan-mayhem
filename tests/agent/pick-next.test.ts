import { describe, expect, it } from 'vitest';
import {
  circuitOpen,
  loadSnapshot,
  orphanedTickets,
  pickNext,
  pickSpecific,
  promotionCandidates,
  ticketOfPr,
  type Snapshot,
} from '../../scripts/agent/pick-next.ts';
import { formatRunLogComment, type RunLogEntry } from '../../scripts/agent/run-log.ts';
import type { PullRequest, Ticket, Tracker } from '../../scripts/agent/tracker/types.ts';

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
    author: 'mm-agent[bot]',
    isCrossRepository: false,
    lastCommitAt: '2026-10-10T00:00:00Z',
    latestReviews: [],
    ...extra,
  };
}

/** The reviewer agent's standing "changes requested" (after the PR's last commit). */
const BOT_CHANGES = {
  latestReviews: [
    {
      author: 'github-actions[bot]',
      authorAssociation: 'NONE',
      state: 'CHANGES_REQUESTED',
      submittedAt: '2026-10-11T00:00:00Z',
    },
  ],
};

function snap(partial: Partial<Snapshot>): Snapshot {
  return {
    tickets: [],
    pullRequests: [],
    issueStates: new Map(),
    runLog: [],
    runLogFound: true,
    agentLogin: 'mm-agent[bot]',
    ...partial,
  };
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
    size: 'S',
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
        pr(20, 'agent/4-sand', { reviewDecision: 'CHANGES_REQUESTED', ...BOT_CHANGES }),
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
        pr(30, 'agent/2-x', { ...BOT_CHANGES, createdAt: '2026-10-01T00:00:00Z' }),
        pr(31, 'feature/human', { ...BOT_CHANGES, closesIssues: [1] }),
        pr(32, 'agent/1-y', { ...BOT_CHANGES, isDraft: true }),
        pr(34, 'agent/1-w', { ...BOT_CHANGES, isCrossRepository: true, author: 'stranger' }),
        pr(35, 'agent/1-v', { ...BOT_CHANGES, author: 'other-app[bot]' }),
        pr(33, 'agent/3-z', { ...BOT_CHANGES, createdAt: '2026-10-05T00:00:00Z' }),
      ],
    });
    expect(pickNext(s, { ...config, wipLimit: 5 }, NOW)).toMatchObject({
      issue: 3,
      mode: 'fix',
      pr: 33,
    });
  });

  it('does not start a second fix pass while pushed fixes await re-review', () => {
    const s = snap({
      tickets: [ticket(4, ['status:in-review', 'size:S']), ticket(5, READY_S)],
      pullRequests: [
        pr(20, 'agent/4-sand', { ...BOT_CHANGES, lastCommitAt: '2026-10-11T00:30:00Z' }),
      ],
    });
    expect(pickNext(s, config, NOW)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('WIP limit') as string,
    });
  });

  it('links PRs to tickets by the agent/<N>-slug branch only (the body is LLM-written)', () => {
    expect(ticketOfPr(pr(1, 'agent/12-sand', { closesIssues: [2] }))).toBe(12);
    expect(ticketOfPr(pr(1, 'random', { closesIssues: [12] }))).toBeNull();
  });

  it('starts fix passes for the reviewer agent and maintainers, never for strangers', () => {
    const review = (author: string, authorAssociation: string) => ({
      latestReviews: [
        {
          author,
          authorAssociation,
          state: 'CHANGES_REQUESTED',
          submittedAt: '2026-10-11T00:00:00Z',
        },
      ],
    });
    const tickets = [ticket(4, ['status:in-review', 'size:S'])];
    const pick = (extra: Partial<PullRequest>) =>
      pickNext(snap({ tickets, pullRequests: [pr(20, 'agent/4-sand', extra)] }), config, NOW);
    expect(pick(review('hezrie', 'OWNER'))).toMatchObject({ issue: 4, mode: 'fix' });
    expect(pick(review('github-actions[bot]', 'NONE'))).toMatchObject({ issue: 4, mode: 'fix' });
    expect(pick(review('drive-by', 'NONE'))).toMatchObject({ issue: null });
    expect(pick(review('drive-by', 'CONTRIBUTOR'))).toMatchObject({ issue: null });
  });

  it('never starts a second PR for a ticket that already has an open agent PR', () => {
    const s = snap({
      tickets: [ticket(4, READY_S)],
      pullRequests: [pr(20, 'agent/4-sand')],
    });
    expect(pickNext(s, { ...config, wipLimit: 5 }, NOW)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('already has an open agent PR #20') as string,
    });
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
      pullRequests: [pr(20, 'agent/4-x', BOT_CHANGES)],
    });
    expect(pickSpecific(s, 4)).toMatchObject({ mode: 'fix', pr: 20 });
  });
});

describe('auto-promotion from the roadmap', () => {
  const planned = (n: number, prio: string, extra: Partial<Ticket> = {}) =>
    ticket(n, ['status:proposed', 'size:S', prio, 'epic:juice'], extra);

  it('tops the queue up to the minimum with startable planned tickets, by priority then age', () => {
    const s = snap({
      tickets: [
        ticket(1, READY_S),
        planned(10, 'priority:P2'),
        planned(11, 'priority:P0'),
        planned(12, 'priority:P0'),
        planned(13, 'priority:P1'),
      ],
    });
    expect(promotionCandidates(s, 3).map((t) => t.number)).toEqual([11, 12]);
    expect(promotionCandidates(s, 1)).toEqual([]);
    expect(promotionCandidates(s, 0)).toEqual([]);
  });

  it('never promotes agent proposals, unplanned tickets or tickets still blocked by an open issue', () => {
    const s = snap({
      tickets: [
        ticket(20, ['status:proposed', 'size:S', 'priority:P0', 'source:agent', 'epic:juice']),
        ticket(21, ['status:proposed', 'size:S', 'priority:P0']),
        planned(22, 'priority:P0', { body: 'Blocked by #23' }),
        planned(23, 'priority:P1'),
        planned(24, 'priority:P1', { body: 'Blocked by #5' }), // #5 is closed (not in the open list)
      ],
    });
    expect(promotionCandidates(s, 5).map((t) => t.number)).toEqual([23, 24]);
  });

  it('counts only startable ready tickets: a blocked ready ticket does not fill the queue', () => {
    const s = snap({
      tickets: [ticket(1, READY_S, { body: 'Blocked by #2' }), planned(2, 'priority:P1')],
    });
    expect(promotionCandidates(s, 1).map((t) => t.number)).toEqual([2]);
  });
});

describe('safety stops', () => {
  it('fails closed when the run log issue is missing (the daily cap could not be enforced)', () => {
    const s = snap({ tickets: [ticket(1, READY_S)], runLogFound: false });
    expect(pickNext(s, config, NOW)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('run log issue') as string,
    });
  });

  it('opens the circuit after 3 consecutive infrastructure failures, and closes after a real run', () => {
    const infra = (n: number): RunLogEntry => ({ ...started(n), outcome: 'infra-failure' });
    expect(circuitOpen([infra(1), infra(2)])).toBe(false);
    expect(circuitOpen([started(1), infra(2), infra(3), infra(4)])).toBe(true);
    expect(circuitOpen([infra(2), infra(3), infra(4), started(5)])).toBe(false);
    const s = snap({ tickets: [ticket(9, READY_S)], runLog: [infra(1), infra(2), infra(3)] });
    expect(pickNext(s, config, NOW)).toMatchObject({
      issue: null,
      reason: expect.stringContaining('circuit breaker') as string,
    });
    expect(pickSpecific(s, 9).issue).toBe(9); // a manual dispatch is the owner's reset
  });

  it('finds tickets orphaned in status:in-progress', () => {
    const s = { tickets: [ticket(1, ['status:in-progress', 'size:S']), ticket(2, READY_S)] };
    expect(orphanedTickets(s).map((t) => t.number)).toEqual([1]);
  });
});

describe('loadSnapshot trusts only the bot in the public run log', () => {
  it('ignores run-log entries posted by anyone else', async () => {
    const entry = formatRunLogComment(started(1));
    const tracker = {
      listOpenTickets: () => Promise.resolve([]),
      listOpenPullRequests: () => Promise.resolve([]),
      findOpenTicketByLabel: () => Promise.resolve(ticket(500, ['meta:run-log'])),
      issueStates: () => Promise.resolve(new Map()),
      listComments: () =>
        Promise.resolve([
          { id: 1, body: entry, author: 'mulligan-mayhem-agent[bot]', createdAt: '' },
          { id: 2, body: entry, author: 'random-stranger', createdAt: '' },
          { id: 3, body: entry, author: 'other-app[bot]', createdAt: '' },
        ]),
    } as unknown as Tracker;
    const s = await loadSnapshot(tracker, 'meta:run-log', ['mulligan-mayhem-agent[bot]']);
    expect(s.runLog).toHaveLength(1);
    expect(s.runLogFound).toBe(true);
  });
});
