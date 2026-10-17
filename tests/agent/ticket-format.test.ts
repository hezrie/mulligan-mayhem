import { describe, expect, it } from 'vitest';
import {
  acceptanceCriteria,
  definitionOfReadyProblems,
  parseSections,
  renderTicketBody,
  type TicketSpec,
} from '../../scripts/agent/ticket-format.ts';
import { blockers } from '../../scripts/agent/tickets.ts';

const spec: TicketSpec = {
  problem: 'Sand should slow the ball much more than fairway.',
  criteria: [
    'A ball on sand decelerates at 3× the fairway rate (unit test on stepBall)',
    'Sand renders in a sand colour (e2e screenshot)',
  ],
  outOfScope: ['Rough terrain', 'Sound effects'],
  size: 'S',
  priority: 'P1',
  type: 'feature',
  dependencies: [3, 4],
};

describe('ticket format', () => {
  it('renders the same "### Heading" sections the issue form produces', () => {
    const body = renderTicketBody(spec);
    expect([...parseSections(body).keys()]).toEqual([
      'Problem / Goal',
      'Acceptance Criteria',
      'Out of Scope',
      'Size',
      'Priority',
      'Type',
      'Dependencies',
      'Notes / Visual reference',
    ]);
    expect(blockers(body)).toEqual([3, 4]);
  });

  it('round-trips the acceptance criteria', () => {
    expect(acceptanceCriteria(renderTicketBody(spec))).toEqual(spec.criteria);
  });

  it('accepts a well-formed ticket under the Definition of Ready', () => {
    expect(definitionOfReadyProblems(renderTicketBody(spec))).toEqual([]);
    expect(definitionOfReadyProblems(renderTicketBody({ ...spec, dependencies: [] }))).toEqual([]);
  });

  it('lists every structural Definition of Ready problem', () => {
    const body =
      '### Problem / Goal\n\n_No response_\n\n### Size\n\nL\n\n### Dependencies\n\nsome stuff';
    expect(definitionOfReadyProblems(body)).toEqual([
      'Problem / Goal is missing',
      'Acceptance Criteria has no checklist items',
      'Out of Scope is missing',
      'Size must be S or M (split anything larger)',
      'Priority must be P0–P3',
      'Type is missing',
      'Dependencies must be "None" or "Blocked by #N" lines',
    ]);
  });
});
