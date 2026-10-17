/**
 * Protected-path rules, shared by CI `agent-guard` and the tests. The edit hook
 * (.claude/hooks/lib.sh) implements the SAME glob semantics in jq, and
 * tests/guardrails/hooks.test.ts checks that both agree.
 *
 * Glob semantics: the pattern is matched against a repo-relative POSIX path, anchored at both
 * ends. `**` matches anything (including `/`), `*` matches anything except `/`, and every other
 * character is literal. PROTECTED: agents may not edit this file.
 */

export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === '*' && glob.charAt(i + 1) === '*') {
      source += '.*';
      i++;
    } else if (ch === '*') {
      source += '[^/]*';
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

export interface FileChange {
  readonly path: string;
  /** git name-status letter: A(dded), M(odified), D(eleted), R(enamed), C(opied), T(ype). */
  readonly status: string;
}

export interface PathRules {
  readonly protectedPaths: readonly string[];
  readonly goldenPaths: readonly string[];
}

export interface Verdict {
  readonly allowed: boolean;
  readonly reason: string;
}

/** Decides whether an agent PR may contain this change. */
export function classifyChange(
  change: FileChange,
  rules: PathRules,
  physicsChange: boolean,
): Verdict {
  if (matchesAny(change.path, rules.protectedPaths)) {
    return { allowed: false, reason: `protected path ${change.path}` };
  }
  if (matchesAny(change.path, rules.goldenPaths)) {
    if (physicsChange || change.status === 'A') return { allowed: true, reason: 'ok' };
    return {
      allowed: false,
      reason: `golden replay ${change.path} changed (${change.status}) without the physics-change label`,
    };
  }
  return { allowed: true, reason: 'ok' };
}
