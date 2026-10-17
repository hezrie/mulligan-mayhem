/** Thin, injectable wrapper around the `gh api` CLI (works locally and in Actions via GH_TOKEN). PROTECTED. */
import { execFile } from 'node:child_process';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface GhClient {
  rest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T>;
  /** GET every page of a list endpoint and concatenate the results. */
  restAll<T>(path: string): Promise<T[]>;
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export class GhApiError extends Error {
  override readonly name = 'GhApiError';
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function gh(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      const status = /HTTP (\d{3})/.exec(stderr)?.[1];
      reject(
        new GhApiError(
          `gh ${args.slice(0, 3).join(' ')} failed: ${stderr.trim()}`,
          status ? Number(status) : null,
        ),
      );
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

export function execGhClient(): GhClient {
  return {
    async rest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
      const args = ['api', '-X', method, path, '-H', 'Accept: application/vnd.github+json'];
      const out =
        body === undefined
          ? await gh(args)
          : await gh([...args, '--input', '-'], JSON.stringify(body));
      return (out.trim() ? JSON.parse(out) : null) as T;
    },
    async restAll<T>(path: string): Promise<T[]> {
      const out = await gh(['api', '--paginate', '--slurp', path]);
      return (JSON.parse(out) as T[][]).flat();
    },
    async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      const out = await gh(
        ['api', 'graphql', '--input', '-'],
        JSON.stringify({ query, variables }),
      );
      const parsed = JSON.parse(out) as { data: T; errors?: { message: string }[] };
      if (parsed.errors?.length)
        throw new GhApiError(parsed.errors.map((e) => e.message).join('; '), null);
      return parsed.data;
    },
  };
}

/** owner/name from GITHUB_REPOSITORY (set in Actions) or an explicit override. */
export function repoFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const repo = env['GITHUB_REPOSITORY'];
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error('Set GITHUB_REPOSITORY=owner/name (Actions sets it automatically).');
  }
  return repo;
}
