import { describe, expect, it } from 'vitest';
import {
  GhApiError,
  repoFromEnv,
  type GhClient,
  type HttpMethod,
} from '../../scripts/agent/tracker/gh-client.ts';
import { GitHubTracker } from '../../scripts/agent/tracker/github.ts';

interface Call {
  kind: 'rest' | 'restAll' | 'graphql';
  method?: HttpMethod;
  path?: string;
  body?: unknown;
}

function fakeClient(responses: Record<string, unknown>, failures: Record<string, GhApiError> = {}) {
  const calls: Call[] = [];
  const respond = (key: string): unknown => {
    const failure = failures[key];
    if (failure) throw failure;
    return responses[key];
  };
  const client: GhClient = {
    rest: <T>(method: HttpMethod, path: string, body?: unknown): Promise<T> => {
      calls.push({ kind: 'rest', method, path, body });
      return Promise.resolve(respond(`${method} ${path}`) as T);
    },
    restAll: <T>(path: string): Promise<T[]> => {
      calls.push({ kind: 'restAll', path });
      return Promise.resolve((respond(`ALL ${path}`) ?? []) as T[]);
    },
    graphql: <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
      calls.push({ kind: 'graphql', body: { query, variables } });
      return Promise.resolve(respond('graphql') as T);
    },
  };
  return { client, calls };
}

const R = 'hezrie/mulligan-mayhem';
const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `T${String(number)}`,
  body: null,
  state: 'open',
  created_at: '2026-10-01T00:00:00Z',
  user: { login: 'hezrie' },
  author_association: 'OWNER',
  labels: [{ name: 'status:ready' }, 'size:S'],
  ...extra,
});

describe('GitHubTracker', () => {
  it('lists open tickets, excluding pull requests, and normalizes fields', async () => {
    const { client } = fakeClient({
      [`ALL repos/${R}/issues?state=open&per_page=100`]: [issue(1), issue(2, { pull_request: {} })],
    });
    expect(await new GitHubTracker(client, R).listOpenTickets()).toEqual([
      {
        number: 1,
        title: 'T1',
        body: '',
        labels: ['status:ready', 'size:S'],
        state: 'open',
        createdAt: '2026-10-01T00:00:00Z',
        author: 'hezrie',
        authorAssociation: 'OWNER',
      },
    ]);
  });

  it('maps open PRs from GraphQL, including review decision and closing issues', async () => {
    const { client, calls } = fakeClient({
      graphql: {
        repository: {
          pullRequests: {
            nodes: [
              {
                number: 9,
                title: 'feat',
                headRefName: 'agent/1-x',
                isDraft: false,
                createdAt: '2026-10-02T00:00:00Z',
                reviewDecision: 'CHANGES_REQUESTED',
                labels: { nodes: [{ name: 'size:S' }] },
                closingIssuesReferences: { nodes: [{ number: 1 }] },
              },
            ],
          },
        },
      },
    });
    const prs = await new GitHubTracker(client, R).listOpenPullRequests();
    expect(prs).toEqual([
      {
        number: 9,
        title: 'feat',
        headRef: 'agent/1-x',
        isDraft: false,
        createdAt: '2026-10-02T00:00:00Z',
        labels: ['size:S'],
        reviewDecision: 'CHANGES_REQUESTED',
        closesIssues: [1],
      },
    ]);
    expect(calls[0]?.body).toMatchObject({
      variables: { owner: 'hezrie', name: 'mulligan-mayhem' },
    });
  });

  it('writes labels, comments and tickets through the REST API', async () => {
    const { client, calls } = fakeClient({ [`POST repos/${R}/issues`]: issue(42) });
    const tracker = new GitHubTracker(client, R);
    expect(await tracker.createTicket({ title: 't', body: 'b', labels: ['status:proposed'] })).toBe(
      42,
    );
    await tracker.addLabels(42, ['status:ready']);
    await tracker.addLabels(42, []);
    await tracker.comment(42, 'hello');
    expect(calls.map((c) => `${c.method ?? ''} ${c.path ?? ''}`)).toEqual([
      `POST repos/${R}/issues`,
      `POST repos/${R}/issues/42/labels`,
      `POST repos/${R}/issues/42/comments`,
    ]);
  });

  it('treats removing an absent label as a no-op, but surfaces other errors', async () => {
    const path = `repos/${R}/issues/5/labels/${encodeURIComponent('status:in-review')}`;
    const missing = fakeClient({}, { [`DELETE ${path}`]: new GhApiError('Not Found', 404) });
    await expect(
      new GitHubTracker(missing.client, R).removeLabel(5, 'status:in-review'),
    ).resolves.toBeUndefined();
    const broken = fakeClient({}, { [`DELETE ${path}`]: new GhApiError('Server error', 500) });
    await expect(
      new GitHubTracker(broken.client, R).removeLabel(5, 'status:in-review'),
    ).rejects.toThrow('Server error');
  });

  it('finds the lowest-numbered open issue with a label (so duplicates never split the log)', async () => {
    const { client } = fakeClient({
      [`GET repos/${R}/issues?state=open&per_page=100&labels=meta%3Arun-log`]: [
        issue(3, { pull_request: {} }),
        issue(6),
        issue(4),
      ],
      [`GET repos/${R}/issues/8`]: issue(8, { state: 'closed' }),
    });
    const tracker = new GitHubTracker(client, R);
    expect((await tracker.findOpenTicketByLabel('meta:run-log'))?.number).toBe(4);
    expect(await tracker.issueStates([8, 8])).toEqual(new Map([[8, 'closed']]));
  });

  it('reads the repository from GITHUB_REPOSITORY', () => {
    expect(repoFromEnv({ GITHUB_REPOSITORY: R })).toBe(R);
    expect(() => repoFromEnv({})).toThrow(/GITHUB_REPOSITORY/);
  });
});
