/**
 * Pull-request operations on GitHub, used by the worker, reviewer, merger and closer steps.
 * Code-host specific on purpose (the Tracker interface is only about tickets). PROTECTED.
 */
import type { GhClient } from './tracker/gh-client.ts';

export interface PrInfo {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  readonly merged: boolean;
  readonly draft: boolean;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly labels: readonly string[];
  readonly author: string;
  readonly url: string;
  readonly mergeable: boolean | null;
}

export interface CheckRun {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
}

export interface Review {
  readonly body: string;
  readonly author: string;
  readonly state: string;
  readonly commitId: string;
  readonly submittedAt: string;
}

interface RestPr {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged?: boolean;
  merged_at?: string | null;
  draft?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  labels: { name: string }[];
  user: { login: string } | null;
  html_url: string;
  mergeable?: boolean | null;
}

export function toPrInfo(pr: RestPr): PrInfo {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? '',
    state: pr.state === 'closed' ? 'closed' : 'open',
    merged: pr.merged === true || Boolean(pr.merged_at),
    draft: pr.draft === true,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    labels: pr.labels.map((l) => l.name),
    author: pr.user?.login ?? 'ghost',
    url: pr.html_url,
    mergeable: pr.mergeable ?? null,
  };
}

export class GitHubPullRequests {
  constructor(
    private readonly gh: GhClient,
    private readonly repo: string,
  ) {}

  async get(number: number): Promise<PrInfo> {
    return toPrInfo(
      await this.gh.rest<RestPr>('GET', `repos/${this.repo}/pulls/${String(number)}`),
    );
  }

  async create(input: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<PrInfo> {
    return toPrInfo(await this.gh.rest<RestPr>('POST', `repos/${this.repo}/pulls`, input));
  }

  async files(
    number: number,
  ): Promise<{ filename: string; status: string; previous_filename?: string }[]> {
    return this.gh.restAll(`repos/${this.repo}/pulls/${String(number)}/files?per_page=100`);
  }

  async checkRuns(sha: string): Promise<CheckRun[]> {
    const data = await this.gh.rest<{ check_runs: CheckRun[] }>(
      'GET',
      `repos/${this.repo}/commits/${sha}/check-runs?per_page=100`,
    );
    return data.check_runs.map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
    }));
  }

  async reviews(number: number): Promise<Review[]> {
    const raw = await this.gh.restAll<{
      body: string | null;
      user: { login: string } | null;
      state: string;
      commit_id: string;
      submitted_at: string;
    }>(`repos/${this.repo}/pulls/${String(number)}/reviews?per_page=100`);
    return raw.map((r) => ({
      body: r.body ?? '',
      author: r.user?.login ?? 'ghost',
      state: r.state,
      commitId: r.commit_id,
      submittedAt: r.submitted_at,
    }));
  }

  async submitReview(
    number: number,
    sha: string,
    event: 'APPROVE' | 'REQUEST_CHANGES',
    body: string,
  ): Promise<void> {
    await this.gh.rest('POST', `repos/${this.repo}/pulls/${String(number)}/reviews`, {
      commit_id: sha,
      event,
      body,
    });
  }

  /** Squash-merges, pinned to the reviewed head SHA so nothing unreviewed sneaks in. */
  async squashMerge(number: number, sha: string, title: string): Promise<void> {
    await this.gh.rest('PUT', `repos/${this.repo}/pulls/${String(number)}/merge`, {
      merge_method: 'squash',
      sha,
      commit_title: `${title} (#${String(number)})`,
    });
  }

  /** The merged PR that closed an issue, if any. */
  async closingPullRequest(
    issue: number,
  ): Promise<{ number: number; title: string; url: string } | null> {
    const [owner = '', name = ''] = this.repo.split('/');
    const data = await this.gh.graphql<{
      repository: {
        issue: {
          timelineItems: {
            nodes: {
              closer: {
                __typename: string;
                number?: number;
                title?: string;
                url?: string;
                merged?: boolean;
              } | null;
            }[];
          };
        };
      };
    }>(
      `query($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $number) {
            timelineItems(itemTypes: CLOSED_EVENT, last: 5) {
              nodes { ... on ClosedEvent { closer { __typename ... on PullRequest { number title url merged } } } }
            }
          }
        }
      }`,
      { owner, name, number: issue },
    );
    const closer = [...data.repository.issue.timelineItems.nodes]
      .reverse()
      .map((n) => n.closer)
      .find((c) => c?.__typename === 'PullRequest' && c.merged);
    return closer?.number && closer.title && closer.url
      ? { number: closer.number, title: closer.title, url: closer.url }
      : null;
  }

  /** Merged PRs from agent/* branches, newest first (for the architecture-review counter). */
  async mergedAgentPrsSince(sinceIso: string): Promise<PrInfo[]> {
    const raw = await this.gh.restAll<RestPr>(
      `repos/${this.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
    );
    return raw
      .map(toPrInfo)
      .filter((pr) => pr.merged && pr.headRef.startsWith('agent/'))
      .filter((pr) => {
        const mergedAt = raw.find((r) => r.number === pr.number)?.merged_at;
        return mergedAt !== null && mergedAt !== undefined && mergedAt > sinceIso;
      });
  }

  /** Logins of everyone who authored a commit on the PR (to detect human edits on agent PRs). */
  async commitAuthors(number: number): Promise<string[]> {
    const commits = await this.gh.restAll<{ author: { login: string } | null }>(
      `repos/${this.repo}/pulls/${String(number)}/commits?per_page=100`,
    );
    return [...new Set(commits.map((c) => c.author?.login ?? 'unknown'))];
  }

  /** Commits on the default branch since a date whose message starts with "Revert". */
  async revertsSince(sinceIso: string): Promise<number> {
    const commits = await this.gh.restAll<{ commit: { message: string } }>(
      `repos/${this.repo}/commits?since=${encodeURIComponent(sinceIso)}&per_page=100`,
    );
    return commits.filter((c) => c.commit.message.startsWith('Revert')).length;
  }
}
