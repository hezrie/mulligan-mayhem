import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readExecutionFile, summarizeExecution } from '../../scripts/agent/execution.ts';

describe('execution summary', () => {
  it('reads turns, cost, duration and outcome from the final result message', () => {
    const messages = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: {} },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 37,
        total_cost_usd: 1.2345,
        duration_ms: 812345,
      },
    ];
    expect(summarizeExecution(messages)).toEqual({
      turns: 37,
      costUsd: 1.2345,
      durationSec: 812.3,
      subtype: 'success',
      isError: false,
    });
  });

  it('flags max-turns and other error results', () => {
    expect(
      summarizeExecution([{ type: 'result', subtype: 'error_max_turns', num_turns: 80 }]),
    ).toMatchObject({
      turns: 80,
      subtype: 'error_max_turns',
      isError: true,
    });
  });

  it('degrades to unknowns for missing, unreadable or empty files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-exec-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    for (const path of [undefined, join(dir, 'missing.json'), bad]) {
      expect(readExecutionFile(path)).toMatchObject({ turns: null, costUsd: null, isError: true });
    }
    expect(summarizeExecution([])).toMatchObject({ subtype: null, isError: true });
  });
});
