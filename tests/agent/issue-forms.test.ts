import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { LABELS, STATUS } from '../../scripts/agent/labels.ts';
import { SECTIONS } from '../../scripts/agent/ticket-format.ts';

const ROOT = resolve(import.meta.dirname, '../..');

interface FormField {
  type: string;
  id?: string;
  attributes: { label?: string; options?: string[] };
  validations?: { required?: boolean };
}

interface IssueForm {
  name: string;
  labels: string[];
  body: FormField[];
}

const load = (name: string): IssueForm =>
  parse(readFileSync(join(ROOT, '.github/ISSUE_TEMPLATE', name), 'utf8')) as IssueForm;

const labelNames = new Set(LABELS.map((l) => l.name));

describe('issue forms', () => {
  const ticket = load('ticket.yml');
  const idea = load('idea.yml');
  const fields = ticket.body.filter((f) => f.type !== 'markdown');

  it('ticket form fields are exactly the canonical ticket sections, in order', () => {
    expect(fields.map((f) => f.attributes.label)).toEqual(Object.values(SECTIONS));
  });

  it('ticket form requires every Definition of Ready field (notes optional)', () => {
    for (const field of fields) {
      const required = field.attributes.label !== SECTIONS.notes;
      expect(Boolean(field.validations?.required), field.attributes.label).toBe(required);
    }
  });

  it('ticket form dropdowns offer only valid values (no L size)', () => {
    const options = (label: string): string[] | undefined =>
      fields.find((f) => f.attributes.label === label)?.attributes.options;
    expect(options(SECTIONS.size)).toEqual(['S', 'M']);
    expect(options(SECTIONS.priority)).toEqual(['P0', 'P1', 'P2', 'P3']);
    expect(options(SECTIONS.type)).toEqual(['feature', 'bug', 'chore', 'refactor', 'test']);
  });

  it('both forms route new issues to the refiner', () => {
    expect(ticket.labels).toEqual([STATUS.needsRefinement]);
    expect(idea.labels).toEqual([STATUS.needsRefinement]);
  });

  it('only use labels that the label setup creates', () => {
    for (const label of [...ticket.labels, ...idea.labels]) expect(labelNames).toContain(label);
  });

  it('the idea form stays simple for family members', () => {
    const required = idea.body.filter((f) => f.validations?.required);
    expect(required).toHaveLength(1);
    expect(required[0]?.attributes.label).toBe('Describe your idea or bug');
  });
});
