import { describe, expect, it } from 'vitest';
import { LABELS } from '../../scripts/agent/labels.ts';
import type { GhClient, HttpMethod } from '../../scripts/agent/tracker/gh-client.ts';
import { planLabels, syncLabels } from '../../scripts/setup/labels.ts';
import { ensureRunLogIssue } from '../../scripts/setup/run-log-issue.ts';

describe('label setup', () => {
  it('creates missing labels, updates changed ones, and leaves matching ones alone', () => {
    const [a, b, c] = LABELS;
    if (!a || !b || !c) throw new Error('need labels');
    const existing = [
      { ...a },
      { ...b, color: '000000' },
      { name: 'bug', color: 'd73a4a', description: 'GitHub default' },
    ];
    const plan = planLabels(existing, [a, b, c]);
    expect(plan.create).toEqual([c]);
    expect(plan.update).toEqual([b]);
    expect(plan.unchanged).toBe(1);
  });

  it('is idempotent: a second sync changes nothing', async () => {
    const store = new Map<string, { name: string; color: string; description: string }>();
    const gh: GhClient = {
      rest: <T>(method: HttpMethod, path: string, body?: unknown): Promise<T> => {
        const label = body as { name?: string; color: string; description: string };
        if (method === 'POST')
          store.set(label.name ?? '', {
            name: label.name ?? '',
            color: label.color,
            description: label.description,
          });
        if (method === 'PATCH') {
          const name = decodeURIComponent(path.split('/').pop() ?? '');
          store.set(name, { name, color: label.color, description: label.description });
        }
        return Promise.resolve(null as T);
      },
      restAll: <T>(): Promise<T[]> => Promise.resolve([...store.values()] as T[]),
      graphql: <T>(): Promise<T> => Promise.resolve(null as T),
    };
    const first = await syncLabels(gh, 'o/r');
    expect(first.create).toHaveLength(LABELS.length);
    const second = await syncLabels(gh, 'o/r');
    expect(second).toEqual({ create: [], update: [], unchanged: LABELS.length });
  });
});

describe('run log issue setup', () => {
  it('finds the pinned run log first (immediately consistent), without listing or creating', async () => {
    const calls: string[] = [];
    const gh: GhClient = {
      rest: <T>(method: HttpMethod, path: string): Promise<T> => {
        calls.push(`${method} ${path}`);
        return Promise.resolve([] as T);
      },
      restAll: <T>(): Promise<T[]> => Promise.resolve([]),
      graphql: <T>(): Promise<T> => {
        calls.push('graphql');
        const node = (number: number, label: string) => ({
          issue: { number, labels: { nodes: [{ name: label }] } },
        });
        return Promise.resolve({
          repository: {
            pinnedIssues: {
              nodes: [node(9, 'meta:run-log'), node(2, 'meta:run-log'), node(1, 'other')],
            },
          },
        } as T);
      },
    };
    expect(await ensureRunLogIssue(gh, 'o/r')).toEqual({ number: 2, created: false });
    expect(calls).toEqual(['graphql']);
  });

  it('reuses an existing run log issue instead of creating a second one', async () => {
    const calls: string[] = [];
    const gh: GhClient = {
      rest: <T>(method: HttpMethod, path: string): Promise<T> => {
        calls.push(`${method} ${path}`);
        return Promise.resolve([
          {
            number: 7,
            title: 'log',
            body: '',
            state: 'open',
            created_at: '',
            user: null,
            author_association: 'OWNER',
            labels: [],
          },
        ] as T);
      },
      restAll: <T>(): Promise<T[]> => Promise.resolve([]),
      graphql: <T>(): Promise<T> => {
        calls.push('graphql');
        return Promise.resolve(null as T);
      },
    };
    expect(await ensureRunLogIssue(gh, 'o/r')).toEqual({ number: 7, created: false });
    expect(calls).toEqual([
      'graphql',
      'GET repos/o/r/issues?state=open&per_page=100&labels=meta%3Arun-log',
    ]);
  });
});
