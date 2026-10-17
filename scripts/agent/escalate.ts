/**
 * Escalate the current ticket to the owner. The agent runs this when it must stop (see the
 * escalation rules in CLAUDE.md):
 *
 *   npx tsx scripts/agent/escalate.ts "<one-paragraph reason>"
 *
 * It records the reason in .agent/out/escalation.md and marks the run as escalated, which lets
 * the worker stop without a passing check. The workflow then labels the ticket
 * status:needs-human and posts the reason. PROTECTED.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './config.ts';

export interface EscalateOptions {
  readonly root?: string;
  readonly stateDir?: string;
  readonly now?: Date;
}

export function escalate(reason: string, options: EscalateOptions = {}): string {
  const root = options.root ?? REPO_ROOT;
  const now = options.now ?? new Date();
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    throw new Error('Give a real reason (at least a sentence) so the owner can act on it.');
  }
  const stateDir =
    options.stateDir ?? process.env['AGENT_STATE_DIR'] ?? join(root, '.agent', '.state');
  const outDir = join(root, '.agent', 'out');
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'escalation.md');
  appendFileSync(file, `### Escalated ${now.toISOString()}\n\n${trimmed}\n\n`);
  writeFileSync(join(stateDir, 'escalated'), `${now.toISOString()}\n`);
  return file;
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  try {
    const file = escalate(process.argv.slice(2).join(' '));
    console.log(
      `Escalation recorded in ${file}. Stop now; the workflow will hand the ticket to the owner.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
