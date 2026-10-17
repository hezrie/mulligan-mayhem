import { describe, expect, it } from 'vitest';
import {
  isTrusted,
  originalTextComment,
  planRefinement,
  RefinementSchema,
  type Refinement,
} from '../../scripts/agent/refine.ts';
import { jsonSchemaFor } from '../../scripts/agent/review.ts';

const ticket = {
  title: 'Sand and rough friction zones',
  problem: 'Terrain should change how far the ball rolls.',
  criteria: ['A ball on sand decelerates at 3× the fairway rate (unit test)'],
  outOfScope: ['Water hazards'],
  size: 'S' as const,
  priority: 'P1' as const,
  type: 'feature' as const,
  dependencies: [],
  notes: '',
};

const base: Refinement = {
  decision: 'ready',
  summary: 'Clear and testable.',
  ticket,
  children: [],
  questions: [],
};

describe('trust gate', () => {
  const who = {
    author: 'stranger',
    authorAssociation: 'NONE',
    sender: 'stranger',
    senderPermission: 'read',
    trustedSubmitters: ['Grandma-G'],
  };
  it('trusts the owner, collaborators and listed family handles', () => {
    expect(isTrusted({ ...who, authorAssociation: 'OWNER' })).toBe(true);
    expect(isTrusted({ ...who, authorAssociation: 'COLLABORATOR' })).toBe(true);
    expect(isTrusted({ ...who, author: 'grandma-g' })).toBe(true);
  });
  it('trusts a stranger’s issue once the owner re-applies the label', () => {
    expect(isTrusted(who)).toBe(false);
    expect(isTrusted({ ...who, sender: 'hezrie', senderPermission: 'admin' })).toBe(true);
  });
});

describe('planRefinement', () => {
  it('rewrites a good ticket, sets metadata labels and queues it', () => {
    const action = planRefinement(base, ['status:needs-refinement', 'size:M']);
    expect(action.kind).toBe('ready');
    if (action.kind !== 'ready') return;
    expect(action.labels.add).toEqual(['size:S', 'priority:P1', 'type:feature', 'status:ready']);
    expect(action.labels.remove).toEqual(['status:needs-refinement', 'size:M']);
    expect(action.body).toContain('### Acceptance Criteria\n\n- [ ] A ball on sand');
  });

  it('asks the human when the refiner says so, or when its ticket fails the DoR check', () => {
    expect(
      planRefinement(
        { ...base, decision: 'needs-human', ticket: null, questions: ['UTC or local midnight?'] },
        [],
      ).kind,
    ).toBe('needs-human');
    expect(planRefinement({ ...base, ticket: null }, []).kind).toBe('needs-human');
  });

  it('splits into children that may only depend on earlier children', () => {
    const child = (title: string, deps: number[]) => ({
      ...ticket,
      title,
      dependsOnChildren: deps,
    });
    const ok = planRefinement(
      {
        ...base,
        decision: 'split',
        ticket: null,
        children: [child('Part one of it', []), child('Part two of it', [0])],
      },
      [],
    );
    expect(ok.kind).toBe('split');
    const cyclic = planRefinement(
      {
        ...base,
        decision: 'split',
        ticket: null,
        children: [child('Part one of it', [1]), child('Part two of it', [])],
      },
      [],
    );
    expect(cyclic.kind).toBe('needs-human');
    const single = planRefinement(
      { ...base, decision: 'split', ticket: null, children: [child('Only one', [])] },
      [],
    );
    expect(single.kind).toBe('needs-human');
  });

  it('validates the schema strictly (e.g. no L size) and exports a JSON Schema', () => {
    expect(RefinementSchema.safeParse({ ...base, ticket: { ...ticket, size: 'L' } }).success).toBe(
      false,
    );
    expect(JSON.parse(jsonSchemaFor(RefinementSchema))).toMatchObject({ type: 'object' });
  });

  it('preserves the original request in a collapsed quote', () => {
    expect(originalTextComment('Idea', 'line 1\nline 2')).toContain('> line 1\n> line 2');
  });
});
