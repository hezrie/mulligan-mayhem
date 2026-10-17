import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const DOCS = [
  ...readdirSync(ROOT)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(ROOT, f)),
  ...markdownFiles(join(ROOT, 'docs')),
  ...markdownFiles(join(ROOT, '.agent')),
];

/** Relative link targets in a markdown file, without #anchors. Skips URLs and code blocks. */
function relativeLinks(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...withoutCode.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1] ?? '')
    .filter((target) => !/^[a-z]+:/i.test(target) && !target.startsWith('#'))
    .map((target) => target.split('#')[0] ?? '');
}

describe('rulebook', () => {
  it('CLAUDE.md stays concise (≤150 lines) because every agent run reads it', () => {
    const lines = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8').trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(150);
  });

  it('CLAUDE.md links every core document', () => {
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    for (const doc of [
      'docs/ARCHITECTURE.md',
      'docs/GAME_DESIGN.md',
      'docs/DEFINITION_OF_READY.md',
      'docs/DEFINITION_OF_DONE.md',
      'docs/WORKFLOW.md',
      'docs/decisions/0001-custom-deterministic-physics.md',
      '.agent/LESSONS.md',
    ]) {
      expect(claude, `CLAUDE.md should link ${doc}`).toContain(`](${doc})`);
    }
  });

  it.each(DOCS.map((file) => [relative(ROOT, file), file]))(
    '%s has no broken relative links',
    (_name, file) => {
      const broken = relativeLinks(readFileSync(file, 'utf8')).filter(
        (target) => !existsSync(resolve(dirname(file), target)),
      );
      expect(broken).toEqual([]);
    },
  );
});
