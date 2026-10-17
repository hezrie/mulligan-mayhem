/**
 * Refiner bookkeeping: the trust gate (this is a public repo), the structured output the LLM
 * must return, and turning it into issue edits. The deterministic Definition-of-Ready check
 * re-validates whatever the LLM produced before anything enters the queue. PROTECTED.
 */
import { z } from 'zod';
import { PRIORITIES, SIZES, STATUS, TYPES } from './labels.ts';
import { definitionOfReadyProblems, renderTicketBody, type TicketSpec } from './ticket-format.ts';

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** May the refiner process this issue automatically? */
export function isTrusted(input: {
  readonly author: string;
  readonly authorAssociation: string;
  /** Who triggered this run (e.g. the owner re-applying the label on a stranger's idea). */
  readonly sender: string;
  readonly senderPermission: string;
  readonly trustedSubmitters: readonly string[];
}): boolean {
  const trusted = new Set(input.trustedSubmitters.map((h) => h.toLowerCase()));
  return (
    TRUSTED_ASSOCIATIONS.has(input.authorAssociation) ||
    trusted.has(input.author.toLowerCase()) ||
    ['admin', 'maintain', 'write'].includes(input.senderPermission)
  );
}

export const AWAITING_TRIAGE_MARKER = '<!-- mm:awaiting-triage -->';
export const AWAITING_TRIAGE_COMMENT = `${AWAITING_TRIAGE_MARKER}\nThanks for the idea! 🙏 The maintainer will take a look and send it to the refiner.`;

const TicketJson = z.strictObject({
  title: z.string().min(5).max(90),
  problem: z.string().min(10),
  criteria: z.array(z.string().min(5)).min(1).max(10),
  outOfScope: z.array(z.string().min(2)).min(1).max(10),
  size: z.enum(['S', 'M']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  type: z.enum(['feature', 'bug', 'chore', 'refactor', 'test']),
  dependencies: z.array(z.int().positive()).max(10),
  notes: z.string().max(2000),
});

export const RefinementSchema = z.strictObject({
  decision: z.enum(['ready', 'split', 'needs-human']),
  summary: z.string().min(1).max(1000),
  ticket: TicketJson.nullable(),
  children: z
    .array(TicketJson.extend({ dependsOnChildren: z.array(z.int().min(0)).max(5) }))
    .max(5),
  questions: z.array(z.string().min(5)).max(3),
});
export type Refinement = z.infer<typeof RefinementSchema>;

export type RefineAction =
  | {
      kind: 'ready';
      title: string;
      body: string;
      labels: { add: string[]; remove: string[] };
      comment: string;
    }
  | {
      kind: 'split';
      children: { title: string; spec: TicketSpec; dependsOnChildren: number[] }[];
      comment: string;
    }
  | { kind: 'needs-human'; comment: string };

function toSpec(t: z.infer<typeof TicketJson>): TicketSpec {
  return {
    problem: t.problem,
    criteria: t.criteria,
    outOfScope: t.outOfScope,
    size: t.size,
    priority: t.priority,
    type: t.type,
    dependencies: t.dependencies,
    notes: t.notes,
  };
}

export function metadataLabels(spec: TicketSpec): string[] {
  return [`size:${spec.size}`, `priority:${spec.priority}`, `type:${spec.type}`];
}

/** Every size/priority/type label, for replacing stale ones. */
const METADATA = [...SIZES, ...PRIORITIES, ...TYPES] as readonly string[];

export function planRefinement(r: Refinement, currentLabels: readonly string[]): RefineAction {
  const askHuman = (why: string[], questions: string[]): RefineAction => ({
    kind: 'needs-human',
    comment: `## 🤖 Refiner: needs your input\n\n${r.summary}\n\n${[...why.map((w) => `- ⚠️ ${w}`), ...questions.map((q, i) => `${String(i + 1)}. ${q}`)].join('\n')}\n\nAnswer here, then re-apply \`${STATUS.needsRefinement}\`.`,
  });

  if (r.decision === 'needs-human')
    return askHuman([], r.questions.length ? r.questions : ['What should this ticket achieve?']);

  if (r.decision === 'split') {
    if (r.children.length < 2)
      return askHuman(['A split needs at least two child tickets.'], r.questions);
    const children = r.children.map((c) => ({
      title: c.title,
      spec: toSpec(c),
      dependsOnChildren: c.dependsOnChildren,
    }));
    const problems = children.flatMap((c, i) =>
      [
        ...definitionOfReadyProblems(renderTicketBody(c.spec)),
        ...c.dependsOnChildren
          .filter((d) => d >= i)
          .map(() => 'children may only depend on earlier children'),
      ].map((p) => `child ${String(i + 1)}: ${p}`),
    );
    if (problems.length) return askHuman(problems, r.questions);
    return {
      kind: 'split',
      children,
      comment: `## 🤖 Refiner: split into smaller tickets\n\n${r.summary}`,
    };
  }

  if (!r.ticket) return askHuman(['The refiner returned no ticket.'], r.questions);
  const spec = toSpec(r.ticket);
  const body = renderTicketBody(spec);
  const problems = definitionOfReadyProblems(body);
  if (problems.length) return askHuman(problems, r.questions);
  return {
    kind: 'ready',
    title: r.ticket.title,
    body,
    labels: {
      add: [...metadataLabels(spec), STATUS.ready],
      remove: [
        STATUS.needsRefinement,
        ...currentLabels.filter((l) => METADATA.includes(l) && !metadataLabels(spec).includes(l)),
      ],
    },
    comment: `## 🤖 Refiner: ready\n\n${r.summary}\n\nRewritten to the Definition of Ready and queued as \`${STATUS.ready}\`. The original text is preserved in the comment above.`,
  };
}

export function originalTextComment(title: string, body: string): string {
  const quoted = body.trim()
    ? body
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')
    : '> _(empty)_';
  return `<details><summary>📝 Original request (before refinement)</summary>\n\n**${title}**\n\n${quoted}\n</details>`;
}
