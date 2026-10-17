import { describe, expect, it } from 'vitest';
import { TERRAIN_KINDS } from '../../../src/core/physics/terrain.ts';
import { TERRAIN_COLORS } from '../../../src/render/palette.ts';

describe('TERRAIN_COLORS', () => {
  it('colours rough and sand as specified', () => {
    expect(TERRAIN_COLORS).toHaveProperty('rough', '#3e8e41');
    expect(TERRAIN_COLORS).toHaveProperty('sand', '#e6d3a3');
  });

  it('gives every terrain kind its own distinct colour', () => {
    const colours = TERRAIN_KINDS.map((kind) => TERRAIN_COLORS[kind].toLowerCase());
    expect(new Set(colours).size).toBe(TERRAIN_KINDS.length);
  });
});
