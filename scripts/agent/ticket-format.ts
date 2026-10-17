/**
 * The canonical ticket body. The issue form (.github/ISSUE_TEMPLATE/ticket.yml) renders its
 * fields as "### <Label>" sections with exactly these headings, and the refiner and seed
 * scripts render the same format, so every ticket can be parsed the same way. PROTECTED.
 */

export const SECTIONS = {
  problem: 'Problem / Goal',
  criteria: 'Acceptance Criteria',
  outOfScope: 'Out of Scope',
  size: 'Size',
  priority: 'Priority',
  type: 'Type',
  dependencies: 'Dependencies',
  notes: 'Notes / Visual reference',
} as const;

export interface TicketSpec {
  readonly problem: string;
  readonly criteria: readonly string[];
  readonly outOfScope: readonly string[];
  readonly size: 'S' | 'M';
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3';
  readonly type: 'feature' | 'bug' | 'chore' | 'refactor' | 'test';
  /** Issue numbers this ticket is blocked by. */
  readonly dependencies: readonly number[];
  readonly notes?: string;
}

export function renderTicketBody(spec: TicketSpec): string {
  const section = (title: string, content: string): string => `### ${title}\n\n${content.trim()}\n`;
  return [
    section(SECTIONS.problem, spec.problem),
    section(SECTIONS.criteria, spec.criteria.map((c) => `- [ ] ${c}`).join('\n')),
    section(SECTIONS.outOfScope, spec.outOfScope.map((o) => `- ${o}`).join('\n')),
    section(SECTIONS.size, spec.size),
    section(SECTIONS.priority, spec.priority),
    section(SECTIONS.type, spec.type),
    section(
      SECTIONS.dependencies,
      spec.dependencies.length
        ? spec.dependencies.map((n) => `Blocked by #${String(n)}`).join('\n')
        : 'None',
    ),
    section(SECTIONS.notes, spec.notes?.trim() ? spec.notes : '_No response_'),
  ].join('\n');
}

/** Splits a ticket body into its "### Heading" sections (heading → trimmed content). */
export function parseSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = body.split(/^### +/m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? '' : part.slice(newline + 1).trim();
    sections.set(heading, content);
  }
  return sections;
}

/** The acceptance criteria as plain statements (checkbox markers removed). */
export function acceptanceCriteria(body: string): string[] {
  const content = parseSections(body).get(SECTIONS.criteria) ?? '';
  return content
    .split('\n')
    .map((l) => /^\s*[-*]\s*(\[[ xX]\]\s*)?(.+)$/.exec(l)?.[2]?.trim() ?? '')
    .filter((l) => l !== '');
}

const EMPTY = new Set(['', '_no response_', 'n/a', 'tbd', 'todo']);

/**
 * The structural part of the Definition of Ready that a script can check. Whether each
 * criterion is truly testable is judged by the refiner and reviewer, not here.
 */
export function definitionOfReadyProblems(body: string): string[] {
  const s = parseSections(body);
  const problems: string[] = [];
  const filled = (key: keyof typeof SECTIONS): boolean =>
    !EMPTY.has((s.get(SECTIONS[key]) ?? '').trim().toLowerCase());
  if (!filled('problem')) problems.push('Problem / Goal is missing');
  if (acceptanceCriteria(body).length === 0)
    problems.push('Acceptance Criteria has no checklist items');
  if (!filled('outOfScope')) problems.push('Out of Scope is missing');
  if (!/^(S|M)$/.test(s.get(SECTIONS.size) ?? ''))
    problems.push('Size must be S or M (split anything larger)');
  if (!/^P[0-3]$/.test(s.get(SECTIONS.priority) ?? '')) problems.push('Priority must be P0–P3');
  if (!/^(feature|bug|chore|refactor|test)$/.test(s.get(SECTIONS.type) ?? ''))
    problems.push('Type is missing');
  const deps = s.get(SECTIONS.dependencies) ?? '';
  if (!/^none$/i.test(deps) && !/blocked by #\d+/i.test(deps)) {
    problems.push('Dependencies must be "None" or "Blocked by #N" lines');
  }
  return problems;
}
