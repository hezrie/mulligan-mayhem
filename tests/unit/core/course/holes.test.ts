import { describe, expect, it } from 'vitest';
import {
  buildHoleRegistry,
  DEFAULT_HOLE_ID,
  getHole,
  listHoleIds,
  UnknownHoleError,
} from '../../../../src/core/course/holes/index.ts';
import { parseHole } from '../../../../src/core/course/schema.ts';

describe('hole registry', () => {
  it('registers the walking-skeleton hole (par 3) as the default', () => {
    expect(listHoleIds()).toContain(DEFAULT_HOLE_ID);
    expect(getHole(DEFAULT_HOLE_ID).par).toBe(3);
  });

  it('throws a clear error for unknown holes', () => {
    expect(() => getHole('no-such-hole')).toThrow(UnknownHoleError);
    expect(() => getHole('no-such-hole')).toThrow(/no-such-hole/);
  });

  it('rejects two holes with the same id', () => {
    const hole = getHole(DEFAULT_HOLE_ID);
    expect(() => buildHoleRegistry([hole, { ...hole, name: 'Copy' }])).toThrow(/Duplicate hole id/);
  });

  it.each(listHoleIds())('%s is valid hole data (round-trips through the schema)', (id) => {
    const hole = getHole(id);
    expect(hole.id).toBe(id);
    expect(parseHole(hole)).toEqual(hole);
  });
});
