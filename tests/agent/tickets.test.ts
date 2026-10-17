import { describe, expect, it } from 'vitest';
import { LABELS, STATUS_LABELS } from '../../scripts/agent/labels.ts';
import {
  attemptOf,
  blockers,
  priorityRank,
  sizeOf,
  statusOf,
} from '../../scripts/agent/tickets.ts';

describe('labels', () => {
  it('defines every label the brief requires, exactly once, with valid colours', () => {
    const names = LABELS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const required of [
      ...STATUS_LABELS,
      'priority:P0',
      'priority:P3',
      'size:S',
      'size:M',
      'type:feature',
      'type:bug',
      'type:chore',
      'type:refactor',
      'type:test',
      'plan:proposed',
      'plan:approved',
      'agent:attempt-1',
      'agent:attempt-2',
      'agent-approved',
      'source:agent',
      'physics-change',
    ]) {
      expect(names).toContain(required);
    }
    for (const label of LABELS) {
      expect(label.color).toMatch(/^[0-9a-f]{6}$/);
      expect(label.description.length).toBeLessThanOrEqual(100); // GitHub's limit
    }
  });
});

describe('ticket helpers', () => {
  it('finds "Blocked by #N" references anywhere, deduplicated and sorted', () => {
    const body = '### Dependencies\n\nBlocked by #12\nblocked BY #3\n\nAlso Blocked by #12';
    expect(blockers(body)).toEqual([3, 12]);
    expect(blockers('### Dependencies\n\nNone')).toEqual([]);
  });

  it('reads status, size, priority and attempt from labels', () => {
    const labels = [
      'type:feature',
      'status:ready',
      'size:M',
      'priority:P1',
      'agent:attempt-2',
      'agent:attempt-1',
    ];
    expect(statusOf(labels)).toBe('status:ready');
    expect(sizeOf(labels)).toBe('M');
    expect(priorityRank(labels)).toBe(1);
    expect(attemptOf(labels)).toBe(2);
  });

  it('handles missing metadata', () => {
    expect(statusOf([])).toBeNull();
    expect(sizeOf(['size:L'])).toBeNull();
    expect(priorityRank([])).toBe(4);
    expect(attemptOf([])).toBe(0);
  });
});
