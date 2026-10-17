/**
 * Every label the agent loop uses, in one place. `npm run setup:labels` creates them on GitHub,
 * and all agent code refers to these constants, never to string literals. PROTECTED.
 */

export interface LabelDef {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export const STATUS = {
  proposed: 'status:proposed',
  needsRefinement: 'status:needs-refinement',
  ready: 'status:ready',
  inProgress: 'status:in-progress',
  inReview: 'status:in-review',
  needsHuman: 'status:needs-human',
} as const;
export type StatusLabel = (typeof STATUS)[keyof typeof STATUS];
export const STATUS_LABELS: readonly StatusLabel[] = Object.values(STATUS);

export const PRIORITIES = ['priority:P0', 'priority:P1', 'priority:P2', 'priority:P3'] as const;
export const SIZES = ['size:S', 'size:M'] as const;
export const TYPES = [
  'type:feature',
  'type:bug',
  'type:chore',
  'type:refactor',
  'type:test',
] as const;

export const PLAN = { proposed: 'plan:proposed', approved: 'plan:approved' } as const;
export const ATTEMPT_PREFIX = 'agent:attempt-';
export const AGENT_APPROVED = 'agent-approved';
export const SOURCE_AGENT = 'source:agent';
export const PHYSICS_CHANGE = 'physics-change';
export const META = { runLog: 'meta:run-log', digest: 'meta:digest' } as const;

export const LABELS: readonly LabelDef[] = [
  {
    name: STATUS.proposed,
    color: 'd4c5f9',
    description: 'Idea exists; not in the queue until the owner promotes it',
  },
  {
    name: STATUS.needsRefinement,
    color: 'fbca04',
    description: 'Raw idea: the refiner rewrites it to the Definition of Ready',
  },
  {
    name: STATUS.ready,
    color: '0e8a16',
    description: 'Meets the Definition of Ready: in the worker queue',
  },
  { name: STATUS.inProgress, color: '1d76db', description: 'The worker is on it' },
  { name: STATUS.inReview, color: '5319e7', description: 'PR open: CI, reviewer, then merge' },
  {
    name: STATUS.needsHuman,
    color: 'b60205',
    description: 'Blocked on the owner: read the latest comment',
  },
  { name: 'priority:P0', color: 'b60205', description: 'Broken or blocking: do first' },
  { name: 'priority:P1', color: 'd93f0b', description: 'Important' },
  { name: 'priority:P2', color: 'fbca04', description: 'Normal' },
  { name: 'priority:P3', color: 'c2e0c6', description: 'Nice to have' },
  { name: 'size:S', color: 'bfdadc', description: '≤ ~150 changed lines, one area' },
  {
    name: 'size:M',
    color: '7fc8cf',
    description: '≤ ~400 changed lines, at most two areas; needs an approved plan',
  },
  { name: 'type:feature', color: 'a2eeef', description: 'New player-facing capability' },
  { name: 'type:bug', color: 'd73a4a', description: 'Something is broken' },
  { name: 'type:chore', color: 'ededed', description: 'Maintenance, tooling, dependencies' },
  { name: 'type:refactor', color: 'c5def5', description: 'Restructure without behaviour change' },
  { name: 'type:test', color: 'e4e669', description: 'Tests only' },
  { name: PLAN.proposed, color: 'f9d0c4', description: 'M ticket: plan posted, awaiting review' },
  {
    name: PLAN.approved,
    color: '0e8a16',
    description: 'M ticket: plan approved, ready to implement',
  },
  { name: `${ATTEMPT_PREFIX}1`, color: 'eeeeee', description: 'Worker attempt 1' },
  { name: `${ATTEMPT_PREFIX}2`, color: 'cccccc', description: 'Worker attempt 2' },
  { name: AGENT_APPROVED, color: '0e8a16', description: 'The reviewer agent approved this PR' },
  { name: SOURCE_AGENT, color: 'bfd4f2', description: 'Proposed by an agent (capped per day)' },
  {
    name: PHYSICS_CHANGE,
    color: 'ff7619',
    description: 'Allows changing existing golden replays. Owner-only.',
  },
  { name: META.runLog, color: '000000', description: 'The pinned agent run log' },
  { name: META.digest, color: '000000', description: 'Weekly agent digest' },
];
