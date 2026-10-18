import { describe, expect, it } from 'vitest';
import { LABELS } from '../../scripts/agent/labels.ts';
import type { GhClient, HttpMethod } from '../../scripts/agent/tracker/gh-client.ts';
import { planLabels, syncLabels } from '../../scripts/setup/labels.ts';
import { ensureRunLogIssue } from '../../scripts/setup/run-log-issue.ts';
import {
  BACKLOG,
  backlogProblems,
  renderSeed,
  seedBacklog,
  seedLabels,
} from '../../scripts/setup/seed-backlog.ts';
import { definitionOfReadyProblems } from '../../scripts/agent/ticket-format.ts';
import { blockers } from '../../scripts/agent/tickets.ts';

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

describe('seed backlog (Phase 8)', () => {
  it('has 10–12 tickets that meet the structural Definition of Ready, in dependency order', () => {
    expect(BACKLOG.length).toBeGreaterThanOrEqual(10);
    expect(BACKLOG.length).toBeLessThanOrEqual(12);
    expect(backlogProblems(BACKLOG)).toEqual([]);
    for (const t of BACKLOG)
      expect(definitionOfReadyProblems(renderSeed(t, () => 7)), t.key).toEqual([]);
  });

  it('queues exactly the first three (unblocked, size S); the rest wait as proposed', () => {
    expect(BACKLOG.map((t) => t.ready)).toEqual(BACKLOG.map((_, i) => i < 3));
    for (const t of BACKLOG.slice(0, 3)) {
      expect(t.blockedBy).toEqual([]);
      expect(t.size).toBe('S');
    }
    expect(seedLabels(BACKLOG[0]!)).toContain('status:ready');
    expect(seedLabels(BACKLOG[5]!)).toContain('status:proposed');
  });

  it('creates every ticket once, resolving "Blocked by" to real issue numbers; re-running creates nothing', async () => {
    const created: { title: string; body: string; labels: string[] }[] = [];
    const issues: { number: number; title: string }[] = [{ number: 2, title: '🤖 Agent Run Log' }];
    const gh: GhClient = {
      rest: <T>(method: HttpMethod, _path: string, body?: unknown): Promise<T> => {
        if (method !== 'POST') return Promise.resolve(null as T);
        const issue = body as { title: string; body: string; labels: string[] };
        const number = 6 + created.length;
        created.push(issue);
        issues.push({ number, title: issue.title });
        return Promise.resolve({ number } as T);
      },
      restAll: <T>(): Promise<T[]> => Promise.resolve([...issues] as T[]),
      graphql: <T>(): Promise<T> => Promise.resolve(null as T),
    };
    const first = await seedBacklog(gh, 'o/r');
    expect(first.filter((r) => r.created)).toHaveLength(BACKLOG.length);
    const numberOf = new Map(first.map((r) => [r.key, r.number]));
    for (const [i, t] of BACKLOG.entries()) {
      expect(blockers(created[i]!.body)).toEqual(
        t.blockedBy.map((k) => numberOf.get(k)).sort((a, b) => (a ?? 0) - (b ?? 0)),
      );
    }
    const second = await seedBacklog(gh, 'o/r');
    expect(second.filter((r) => r.created)).toEqual([]);
    expect(created).toHaveLength(BACKLOG.length);
  });

  it('loads a planned backlog: epic labels (created once), existing-issue blockers, queued chains', async () => {
    const base = BACKLOG[0]!;
    const planned = [
      {
        ...base,
        key: 'feel-a',
        title: 'Feel A',
        ready: true,
        blockedBy: [],
        labels: ['epic:feel'],
      },
      {
        ...base,
        key: 'feel-b',
        title: 'Feel B',
        ready: true,
        blockedBy: ['feel-a'],
        blockedByIssues: [12],
        labels: ['epic:feel'],
      },
      {
        ...base,
        key: 'feel-c',
        title: 'Feel C',
        ready: false,
        blockedBy: ['feel-b'],
        labels: ['epic:feel'],
      },
    ];
    expect(backlogProblems(planned)).toEqual([]);
    expect(
      backlogProblems([
        planned[2]!,
        { ...planned[1]!, key: 'x', title: 'X', blockedBy: ['feel-c'] },
      ]),
    ).toContainEqual(expect.stringContaining('can only wait on ready tickets'));
    expect(backlogProblems([{ ...planned[0]!, labels: ['status:ready'] }])).toContainEqual(
      expect.stringContaining('unexpected label'),
    );

    const posts: { path: string; body: unknown }[] = [];
    const gh: GhClient = {
      rest: <T>(_method: HttpMethod, path: string, body?: unknown): Promise<T> => {
        posts.push({ path, body });
        return Promise.resolve({ number: 100 + posts.length } as T);
      },
      restAll: <T>(): Promise<T[]> => Promise.resolve([] as T[]),
      graphql: <T>(): Promise<T> => Promise.resolve(null as T),
    };
    await seedBacklog(gh, 'o/r', planned);
    expect(posts.filter((p) => p.path === 'repos/o/r/labels')).toHaveLength(1);
    const issues = posts.filter((p) => p.path === 'repos/o/r/issues');
    const b = issues[1]!.body as { body: string; labels: string[] };
    expect(blockers(b.body)).toEqual([12, 102]);
    expect(b.labels).toContain('epic:feel');
    expect(b.labels).toContain('status:ready');
  });
});
