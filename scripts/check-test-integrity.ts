/**
 * Test-integrity gate. Runs as `npm run check:integrity`, both in CI and inside `npm run check`.
 * PROTECTED FILE: agents may not edit it.
 *
 * Fails when:
 *  1. test code contains a focus/skip/todo/expected-failure marker, or
 *  2. the Vitest or Playwright test count is lower than at the comparison base. The base is the
 *     merge-base with origin/main, or the parent commit when HEAD already is main.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Violation {
  file: string;
  line: number;
  marker: string;
  text: string;
}

export interface Counts {
  vitest: number;
  playwright: number;
}

// Marker names carry no leading dot so the integrity tests can name them without tripping the scan.
const FORBIDDEN_MARKERS: readonly { marker: string; pattern: RegExp }[] = [
  { marker: 'only', pattern: /\.only\b/ },
  { marker: 'skip', pattern: /\.skip\b/ },
  { marker: 'skipIf', pattern: /\.skipIf\b/ },
  { marker: 'runIf', pattern: /\.runIf\b/ },
  { marker: 'todo', pattern: /\.todo\b/ },
  { marker: 'fails', pattern: /\.fails\b/ },
  { marker: 'fixme', pattern: /\.fixme\b/ },
  { marker: 'xit', pattern: /\bxit\s*\(/ },
  { marker: 'xtest', pattern: /\bxtest\s*\(/ },
  { marker: 'xdescribe', pattern: /\bxdescribe\s*\(/ },
];

const TEST_DIRS = ['tests', 'e2e'];
const TEST_FILE = /\.(c|m)?(t|j)s$/;

export function scanContent(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  source.split('\n').forEach((text, index) => {
    for (const { marker, pattern } of FORBIDDEN_MARKERS) {
      if (pattern.test(text)) violations.push({ file, line: index + 1, marker, text });
    }
  });
  return violations;
}

interface PlaywrightSuite {
  specs?: { tests?: unknown[] }[];
  suites?: PlaywrightSuite[];
}

export function countPlaywrightReport(report: PlaywrightSuite): number {
  const own = (report.specs ?? []).reduce((sum, spec) => sum + (spec.tests?.length ?? 0), 0);
  const nested = (report.suites ?? []).reduce((sum, s) => sum + countPlaywrightReport(s), 0);
  return own + nested;
}

export function compareCounts(current: Counts, base: Counts): string[] {
  const problems: string[] = [];
  for (const suite of ['vitest', 'playwright'] as const) {
    if (current[suite] < base[suite]) {
      problems.push(
        `${suite} test count dropped from ${String(base[suite])} to ${String(current[suite])}`,
      );
    }
  }
  return problems;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(path).isDirectory() ? walk(path) : TEST_FILE.test(name) ? [path] : [];
  });
}

function git(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function countAt(cwd: string, scratch: string): Counts {
  let vitest = 0;
  if (existsSync(join(cwd, 'vitest.config.ts'))) {
    // A real run, not `vitest list`: the list collapses each `it.each` table into one entry,
    // which would let a table of cases shrink to a single case unnoticed.
    const out = join(scratch, `vitest-${String(Date.now())}.json`);
    try {
      execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], {
        cwd,
        stdio: 'ignore',
      });
    } catch {
      // Failing tests still count; the report is written either way. Pass/fail is CI's job.
    }
    vitest = (JSON.parse(readFileSync(out, 'utf8')) as { numTotalTests: number }).numTotalTests;
  }
  let playwright = 0;
  if (existsSync(join(cwd, 'playwright.config.ts'))) {
    const stdout = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    playwright = countPlaywrightReport(JSON.parse(stdout) as PlaywrightSuite);
  }
  return { vitest, playwright };
}

function resolveBase(): { sha: string; label: string } | null {
  const explicit = process.env['INTEGRITY_BASE'];
  if (explicit) return { sha: git(['rev-parse', explicit]), label: explicit };
  const head = tryGit(['rev-parse', 'HEAD']);
  if (!head) return null;
  if (tryGit(['rev-parse', '--verify', 'origin/main'])) {
    const mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
    if (mergeBase !== head) return { sha: mergeBase, label: 'merge-base with origin/main' };
  }
  const parent = tryGit(['rev-parse', '--verify', 'HEAD^']);
  return parent ? { sha: parent, label: 'parent commit (HEAD^)' } : null;
}

function countBase(sha: string, scratch: string): Counts {
  const dir = join(scratch, 'base');
  git(['worktree', 'add', '--detach', '--force', dir, sha]);
  try {
    if (!existsSync(join(dir, 'package.json'))) return { vitest: 0, playwright: 0 };
    symlinkSync(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'), 'dir');
    return countAt(dir, scratch);
  } finally {
    git(['worktree', 'remove', '--force', dir]);
  }
}

function main(): void {
  const isCI = Boolean(process.env['CI']);
  let failed = false;

  const files = TEST_DIRS.flatMap((d) => walk(join(process.cwd(), d)));
  const violations = files.flatMap((f) =>
    scanContent(readFileSync(f, 'utf8'), relative(process.cwd(), f)),
  );
  if (violations.length > 0) {
    failed = true;
    console.error('✖ Forbidden test markers (tests must not be focused, skipped or weakened):');
    for (const v of violations)
      console.error(`  ${v.file}:${String(v.line)}  ${v.marker}  ${v.text.trim()}`);
  } else {
    console.log(`✔ No focus/skip/todo markers in ${String(files.length)} test files`);
  }

  const scratch = mkdtempSync(join(tmpdir(), 'mm-integrity-'));
  try {
    const current = countAt(process.cwd(), scratch);
    console.log(
      `  current: ${String(current.vitest)} vitest, ${String(current.playwright)} playwright tests`,
    );
    const base = resolveBase();
    if (!base) {
      const msg = 'No comparison base (no origin/main and no parent commit); count check skipped.';
      if (isCI) {
        failed = true;
        console.error(`✖ ${msg} CI needs history: use actions/checkout with fetch-depth: 0.`);
      } else {
        console.warn(`⚠ ${msg}`);
      }
    } else {
      let baseCounts: Counts | null = null;
      try {
        baseCounts = countBase(base.sha, scratch);
      } catch (error) {
        const msg = `Could not count tests at ${base.label} (${base.sha.slice(0, 7)}): ${String(error)}`;
        if (isCI) {
          failed = true;
          console.error(`✖ ${msg}`);
        } else {
          console.warn(`⚠ ${msg}`);
        }
      }
      if (baseCounts) {
        console.log(
          `  base (${base.label}, ${base.sha.slice(0, 7)}): ${String(baseCounts.vitest)} vitest, ${String(baseCounts.playwright)} playwright tests`,
        );
        const problems = compareCounts(current, baseCounts);
        if (problems.length > 0) {
          failed = true;
          for (const p of problems) console.error(`✖ ${p}. Removing tests needs human approval.`);
        } else {
          console.log('✔ Test counts did not decrease');
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  process.exit(failed ? 1 : 0);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
