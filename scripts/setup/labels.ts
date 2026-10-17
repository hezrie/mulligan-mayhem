/**
 * Creates or updates every label in scripts/agent/labels.ts on GitHub. Idempotent: safe to run
 * any number of times. Labels not in the list are left alone.
 *
 *   GITHUB_REPOSITORY=hezrie/mulligan-mayhem npm run setup:labels
 *
 * PROTECTED.
 */
import { pathToFileURL } from 'node:url';
import { LABELS, type LabelDef } from '../agent/labels.ts';
import { execGhClient, repoFromEnv, type GhClient } from '../agent/tracker/gh-client.ts';

export interface LabelPlan {
  readonly create: readonly LabelDef[];
  readonly update: readonly LabelDef[];
  readonly unchanged: number;
}

export function planLabels(existing: readonly LabelDef[], desired: readonly LabelDef[]): LabelPlan {
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const create: LabelDef[] = [];
  const update: LabelDef[] = [];
  for (const label of desired) {
    const current = byName.get(label.name.toLowerCase());
    if (!current) create.push(label);
    else if (
      current.color.toLowerCase() !== label.color ||
      (current.description || '') !== label.description
    ) {
      update.push(label);
    }
  }
  return { create, update, unchanged: desired.length - create.length - update.length };
}

export async function syncLabels(gh: GhClient, repo: string): Promise<LabelPlan> {
  const existing = await gh.restAll<LabelDef>(`repos/${repo}/labels?per_page=100`);
  const plan = planLabels(existing, LABELS);
  for (const l of plan.create) await gh.rest('POST', `repos/${repo}/labels`, l);
  for (const l of plan.update) {
    await gh.rest('PATCH', `repos/${repo}/labels/${encodeURIComponent(l.name)}`, {
      color: l.color,
      description: l.description,
    });
  }
  return plan;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  syncLabels(execGhClient(), repoFromEnv())
    .then((plan) => {
      console.log(
        `labels: ${String(plan.create.length)} created, ${String(plan.update.length)} updated, ${String(plan.unchanged)} unchanged`,
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
