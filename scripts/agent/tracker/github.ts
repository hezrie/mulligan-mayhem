/** GitHub Issues adapter for the Tracker interface. PROTECTED. */
import { GhApiError, type GhClient } from './gh-client.ts';
import type {
  IssueComment,
  NewTicket,
  PullRequest,
  ReviewDecision,
  Ticket,
  TicketPatch,
  Tracker,
} from './types.ts';

interface RestIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  created_at: string;
  user: { login: string } | null;
  author_association: string;
  labels: ({ name: string } | string)[];
  pull_request?: unknown;
}

interface RestComment {
  id: number;
  body: string | null;
  user: { login: string } | null;
  created_at: string;
}

interface GqlActor {
  login: string;
  __typename: string;
}

interface GqlPullRequests {
  repository: {
    pullRequests: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        number: number;
        title: string;
        headRefName: string;
        isDraft: boolean;
        isCrossRepository: boolean;
        createdAt: string;
        reviewDecision: ReviewDecision;
        author: GqlActor | null;
        labels: { nodes: { name: string }[] };
        closingIssuesReferences: { nodes: { number: number }[] };
        commits: { nodes: { commit: { committedDate: string } }[] };
        latestOpinionatedReviews: {
          nodes: {
            state: string;
            submittedAt: string | null;
            authorAssociation: string;
            author: GqlActor | null;
          }[];
        };
      }[];
    };
  };
}

const OPEN_PRS = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title headRefName isDraft isCrossRepository createdAt reviewDecision
        author { login __typename }
        labels(first: 30) { nodes { name } }
        closingIssuesReferences(first: 10) { nodes { number } }
        commits(last: 1) { nodes { commit { committedDate } } }
        latestOpinionatedReviews(first: 20) { nodes { state submittedAt authorAssociation author { login __typename } } }
      }
    }
  }
}`;

/** GraphQL drops the "[bot]" suffix that REST logins carry; normalize to the REST form. */
export function restLogin(actor: GqlActor | null): string {
  if (!actor) return 'ghost';
  return actor.__typename === 'Bot' && !actor.login.endsWith('[bot]')
    ? `${actor.login}[bot]`
    : actor.login;
}

export function toTicket(issue: RestIssue): Ticket {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name)),
    state: issue.state === 'closed' ? 'closed' : 'open',
    createdAt: issue.created_at,
    author: issue.user?.login ?? 'ghost',
    authorAssociation: issue.author_association,
  };
}

export class GitHubTracker implements Tracker {
  constructor(
    private readonly gh: GhClient,
    private readonly repo: string,
  ) {}

  async listOpenTickets(): Promise<Ticket[]> {
    const issues = await this.gh.restAll<RestIssue>(
      `repos/${this.repo}/issues?state=open&per_page=100`,
    );
    return issues.filter((i) => i.pull_request === undefined).map(toTicket);
  }

  async getTicket(number: number): Promise<Ticket> {
    return toTicket(
      await this.gh.rest<RestIssue>('GET', `repos/${this.repo}/issues/${String(number)}`),
    );
  }

  /**
   * A reference that doesn't resolve (typo, deleted or transferred issue) counts as open, so the
   * ticket shows as blocked instead of one bad "Blocked by #N" failing every picker run.
   */
  async issueStates(numbers: readonly number[]): Promise<Map<number, 'open' | 'closed'>> {
    const states = new Map<number, 'open' | 'closed'>();
    for (const n of new Set(numbers)) {
      try {
        states.set(n, (await this.getTicket(n)).state);
      } catch (error) {
        if (!(error instanceof GhApiError) || ![404, 410].includes(error.status ?? 0)) throw error;
        states.set(n, 'open');
      }
    }
    return states;
  }

  async listOpenPullRequests(): Promise<PullRequest[]> {
    const [owner = '', name = ''] = this.repo.split('/');
    const nodes: GqlPullRequests['repository']['pullRequests']['nodes'] = [];
    let after: string | null = null;
    do {
      const page: GqlPullRequests = await this.gh.graphql<GqlPullRequests>(OPEN_PRS, {
        owner,
        name,
        after,
      });
      nodes.push(...page.repository.pullRequests.nodes);
      const { hasNextPage, endCursor } = page.repository.pullRequests.pageInfo;
      after = hasNextPage ? endCursor : null;
    } while (after);
    return nodes.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRef: pr.headRefName,
      isDraft: pr.isDraft,
      createdAt: pr.createdAt,
      reviewDecision: pr.reviewDecision,
      labels: pr.labels.nodes.map((l) => l.name),
      closesIssues: pr.closingIssuesReferences.nodes.map((i) => i.number),
      author: restLogin(pr.author),
      isCrossRepository: pr.isCrossRepository,
      lastCommitAt: pr.commits.nodes[0]?.commit.committedDate ?? null,
      // Opinionated = approve / request changes: a later plain comment doesn't hide a request.
      latestReviews: pr.latestOpinionatedReviews.nodes.map((r) => ({
        author: restLogin(r.author),
        authorAssociation: r.authorAssociation,
        state: r.state,
        submittedAt: r.submittedAt,
      })),
    }));
  }

  async listComments(number: number): Promise<IssueComment[]> {
    const comments = await this.gh.restAll<RestComment>(
      `repos/${this.repo}/issues/${String(number)}/comments?per_page=100`,
    );
    return comments.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      author: c.user?.login ?? 'ghost',
      createdAt: c.created_at,
    }));
  }

  /** Lowest-numbered open issue with the label, so every caller agrees even if duplicates exist. */
  async findOpenTicketByLabel(label: string): Promise<Ticket | null> {
    const issues = await this.gh.rest<RestIssue[]>(
      'GET',
      `repos/${this.repo}/issues?state=open&per_page=100&labels=${encodeURIComponent(label)}`,
    );
    const first = issues
      .filter((i) => i.pull_request === undefined)
      .sort((a, b) => a.number - b.number)[0];
    return first ? toTicket(first) : null;
  }

  async createTicket(ticket: NewTicket): Promise<number> {
    const created = await this.gh.rest<RestIssue>('POST', `repos/${this.repo}/issues`, {
      title: ticket.title,
      body: ticket.body,
      labels: ticket.labels,
    });
    return created.number;
  }

  async addLabels(number: number, labels: readonly string[]): Promise<void> {
    if (labels.length === 0) return;
    await this.gh.rest('POST', `repos/${this.repo}/issues/${String(number)}/labels`, { labels });
  }

  async removeLabel(number: number, label: string): Promise<void> {
    try {
      await this.gh.rest(
        'DELETE',
        `repos/${this.repo}/issues/${String(number)}/labels/${encodeURIComponent(label)}`,
      );
    } catch (error) {
      if (error instanceof GhApiError && error.status === 404) return;
      throw error;
    }
  }

  async comment(number: number, body: string): Promise<void> {
    await this.gh.rest('POST', `repos/${this.repo}/issues/${String(number)}/comments`, { body });
  }

  async updateTicket(number: number, patch: TicketPatch): Promise<void> {
    const body: Record<string, string> = {};
    if (patch.title !== undefined) body['title'] = patch.title;
    if (patch.body !== undefined) body['body'] = patch.body;
    if (patch.state !== undefined) body['state'] = patch.state;
    if (patch.stateReason !== undefined) body['state_reason'] = patch.stateReason;
    await this.gh.rest('PATCH', `repos/${this.repo}/issues/${String(number)}`, body);
  }

  async listTicketsByLabel(label: string): Promise<Ticket[]> {
    const issues = await this.gh.restAll<RestIssue>(
      `repos/${this.repo}/issues?state=all&per_page=100&labels=${encodeURIComponent(label)}`,
    );
    return issues
      .filter((i) => i.pull_request === undefined)
      .map(toTicket)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
