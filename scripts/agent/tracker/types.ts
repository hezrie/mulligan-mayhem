/**
 * The ticket tracker, behind an interface so the agent loop isn't tied to GitHub Issues.
 * A Jira adapter can implement the same interface later. PROTECTED.
 */

export interface Ticket {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly state: 'open' | 'closed';
  readonly createdAt: string;
  readonly author: string;
  /** OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | NONE … (used by the refiner's trust gate). */
  readonly authorAssociation: string;
}

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export interface PullRequest {
  readonly number: number;
  readonly title: string;
  readonly headRef: string;
  readonly isDraft: boolean;
  readonly createdAt: string;
  readonly labels: readonly string[];
  readonly reviewDecision: ReviewDecision;
  /** Issues this PR closes ("Closes #N"). */
  readonly closesIssues: readonly number[];
  /** When the head commit was made, and when the latest "changes requested" review was submitted. */
  readonly lastCommitAt: string | null;
  readonly lastChangesRequestedAt: string | null;
}

export interface IssueComment {
  readonly id: number;
  readonly body: string;
  readonly author: string;
  readonly createdAt: string;
}

export interface NewTicket {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

export interface TicketPatch {
  readonly title?: string;
  readonly body?: string;
  readonly state?: 'open' | 'closed';
  readonly stateReason?: 'completed' | 'not_planned';
}

export interface Tracker {
  listOpenTickets(): Promise<Ticket[]>;
  getTicket(number: number): Promise<Ticket>;
  /** Open/closed state for each issue number (e.g. for "Blocked by #N"). */
  issueStates(numbers: readonly number[]): Promise<Map<number, 'open' | 'closed'>>;
  listOpenPullRequests(): Promise<PullRequest[]>;
  listComments(number: number): Promise<IssueComment[]>;
  findOpenTicketByLabel(label: string): Promise<Ticket | null>;
  createTicket(ticket: NewTicket): Promise<number>;
  addLabels(number: number, labels: readonly string[]): Promise<void>;
  /** Removing a label that isn't there is a no-op. */
  removeLabel(number: number, label: string): Promise<void>;
  comment(number: number, body: string): Promise<void>;
  updateTicket(number: number, patch: TicketPatch): Promise<void>;
  /** All tickets (open and closed) carrying a label, newest first. */
  listTicketsByLabel(label: string): Promise<Ticket[]>;
}
