/**
 * The protected-path list lives in agent.config.json. These tests keep every copy of it in sync:
 * CODEOWNERS (GitHub-enforced review), the CLAUDE.md summary, and the "PROTECTED" markers.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAgentConfig } from '../../scripts/agent/config.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const config = loadAgentConfig();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** agent.config.json glob → CODEOWNERS path. "dir/**" becomes "/dir/"; anything else gets a leading "/". */
const toCodeowners = (glob: string): string =>
  glob.endsWith('/**') ? `/${glob.slice(0, -2)}` : `/${glob}`;

function codeownersEntries(): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  for (const line of read('.github/CODEOWNERS').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [path, ...owners] = trimmed.split(/\s+/);
    if (path) entries.set(path, owners);
  }
  return entries;
}

describe('protected paths stay in sync', () => {
  const entries = codeownersEntries();
  const expected = [...config.protectedPaths, ...config.goldenPaths].map(toCodeowners);

  it('CODEOWNERS assigns @hezrie to every protected and golden path', () => {
    for (const path of expected) {
      expect(entries.get(path), `CODEOWNERS is missing ${path}`).toEqual(['@hezrie']);
    }
  });

  it('CODEOWNERS has no entries that are not in agent.config.json', () => {
    expect([...entries.keys()].sort()).toEqual([...expected].sort());
  });

  it('CLAUDE.md mentions every protected path', () => {
    const claude = read('CLAUDE.md');
    for (const glob of config.protectedPaths) {
      const name = glob.replace(/\/\*\*$/, '/');
      const mentioned =
        claude.includes(`\`${name}\``) ||
        (glob.startsWith('.prettier') && claude.includes('Prettier config')) ||
        (glob.startsWith('docs/DEFINITION_OF_') && claude.includes('`docs/DEFINITION_OF_*.md`'));
      expect(mentioned, `CLAUDE.md should list ${glob}`).toBe(true);
    }
  });

  it('files that enforce rules say so in a PROTECTED marker', () => {
    for (const file of [
      'vitest.config.ts',
      'eslint.config.js',
      '.dependency-cruiser.cjs',
      'scripts/check-test-integrity.ts',
      'scripts/agent/config.ts',
      'scripts/agent/protected.ts',
      'scripts/agent/escalate.ts',
      '.claude/hooks/lib.sh',
      'tests/replays/replays.test.ts',
    ]) {
      expect(read(file), file).toMatch(/PROTECTED/);
    }
  });
});
