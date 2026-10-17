import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkConfigSync,
  npmRunSequence,
  workflowCrons,
  workflowJobNpmSteps,
} from '../../scripts/agent/config-sync.ts';

const YAML = `name: CI
jobs:
  check:
    steps:
      - uses: actions/checkout@v7
      - run: npm ci
      - run: npm run typecheck
      - name: Lint
        run: npm run lint
  other:
    steps:
      - run: npm run build
`;

describe('config sync', () => {
  it('extracts npm run steps from a script chain, ignoring non-npm steps', () => {
    expect(npmRunSequence('bash x.sh start && npm run a && npm run b:c && bash x.sh pass')).toEqual(
      ['a', 'b:c'],
    );
  });

  it('extracts one job’s npm run steps in order, and nothing from other jobs', () => {
    expect(workflowJobNpmSteps(YAML, 'check')).toEqual(['typecheck', 'lint']);
    expect(workflowJobNpmSteps(YAML, 'missing')).toEqual([]);
  });

  it('extracts cron expressions', () => {
    expect(workflowCrons("on:\n  schedule:\n    - cron: '0 */2 * * *'\n")).toEqual(['0 */2 * * *']);
  });

  it('the real repository is in sync', () => {
    expect(checkConfigSync(resolve(import.meta.dirname, '../..'))).toEqual([]);
  });
});
