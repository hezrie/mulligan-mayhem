import { describe, expect, it } from 'vitest';
import {
  compareCounts,
  countPlaywrightReport,
  scanContent,
} from '../../scripts/check-test-integrity.ts';

// Offending lines are assembled at runtime (`${obj}.${marker}${rest}`) so this file's own
// source never contains a marker and does not trip the integrity scan.
const call = (obj: string, marker: string, rest: string): string => [obj, marker].join('.') + rest;

describe('scanContent', () => {
  it('accepts clean test code', () => {
    const source = ["it('works', () => {", '  expect(1).toBe(1);', '});'].join('\n');
    expect(scanContent(source, 'a.test.ts')).toEqual([]);
  });

  it.each([
    [call('it', 'only', "('x', () => {})"), 'only'],
    [call('describe', 'only', "('x', () => {})"), 'only'],
    [call('test', 'skip', "('x', () => {})"), 'skip'],
    [call('describe', 'skip', ".each([1])('x', () => {})"), 'skip'],
    [call('it', 'skipIf', "(true)('x', () => {})"), 'skipIf'],
    [call('it', 'runIf', "(false)('x', () => {})"), 'runIf'],
    [call('test', 'todo', "('later')"), 'todo'],
    [call('it', 'fails', "('x', () => {})"), 'fails'],
    [call('test', 'fixme', "('x', async () => {})"), 'fixme'],
    ['x' + "it('x', () => {})", 'xit'],
    ['x' + "test('x', () => {})", 'xtest'],
    ['x' + "describe('x', () => {})", 'xdescribe'],
  ])('flags %s', (line, marker) => {
    const violations = scanContent(`const a = 1;\n${line}\n`, 'b.test.ts');
    expect(violations).toEqual([{ file: 'b.test.ts', line: 2, marker, text: line }]);
  });

  it('does not flag look-alike identifiers', () => {
    const source = [
      'const onlyOnce = true;',
      'skipper.skipped();',
      'const fixmeLater = 1;',
      'boxit(1);',
      'texts.length;',
    ].join('\n');
    expect(scanContent(source, 'c.test.ts')).toEqual([]);
  });
});

describe('countPlaywrightReport', () => {
  it('counts tests across nested suites and projects', () => {
    const report = {
      suites: [
        {
          specs: [{ tests: [{}, {}] }],
          suites: [{ specs: [{ tests: [{}] }, { tests: [{}, {}, {}] }] }],
        },
        { specs: [] },
      ],
    };
    expect(countPlaywrightReport(report)).toBe(6);
  });

  it('returns 0 for an empty report', () => {
    expect(countPlaywrightReport({})).toBe(0);
  });
});

describe('compareCounts', () => {
  it('passes when the count grows or stays equal', () => {
    expect(compareCounts({ vitest: 10, playwright: 4 }, { vitest: 9, playwright: 4 })).toEqual([]);
    expect(compareCounts({ vitest: 9, playwright: 4 }, { vitest: 9, playwright: 4 })).toEqual([]);
  });

  it('fails when either suite shrinks, even if the other grows', () => {
    expect(compareCounts({ vitest: 20, playwright: 3 }, { vitest: 9, playwright: 4 })).toEqual([
      'playwright test count dropped from 4 to 3',
    ]);
    expect(compareCounts({ vitest: 8, playwright: 9 }, { vitest: 9, playwright: 4 })).toEqual([
      'vitest test count dropped from 9 to 8',
    ]);
  });
});
