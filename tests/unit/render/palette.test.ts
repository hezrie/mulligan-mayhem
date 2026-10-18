import { describe, expect, it } from 'vitest';
import { TERRAIN_KINDS } from '../../../src/core/physics/terrain.ts';
import { COLORS, READABLE_STROKES, TERRAIN_COLORS } from '../../../src/render/palette.ts';

describe('TERRAIN_COLORS', () => {
  it('colours rough and sand as specified', () => {
    expect(TERRAIN_COLORS).toHaveProperty('rough', '#3e8e41');
    expect(TERRAIN_COLORS).toHaveProperty('sand', '#e6d3a3');
  });

  it('colours ice as specified', () => {
    expect(TERRAIN_COLORS).toHaveProperty('ice', '#bfe6ff');
  });

  it('gives every terrain kind its own distinct colour', () => {
    const colours = TERRAIN_KINDS.map((kind) => TERRAIN_COLORS[kind].toLowerCase());
    expect(new Set(colours).size).toBe(TERRAIN_KINDS.length);
  });

  it('keeps the Classic terrain colours pinned', () => {
    expect(TERRAIN_COLORS).toHaveProperty('fairway', '#5cb85c');
    expect(TERRAIN_COLORS).toHaveProperty('rough', '#3e8e41');
    expect(TERRAIN_COLORS).toHaveProperty('sand', '#e6d3a3');
    expect(TERRAIN_COLORS).toHaveProperty('ice', '#bfe6ff');
  });
});

describe('COLORS', () => {
  it('keeps the Classic aim and ball colours pinned', () => {
    expect(COLORS).toHaveProperty('aimWeak', '#ffe066');
    expect(COLORS).toHaveProperty('aimStrong', '#ff4d4d');
    expect(COLORS).toHaveProperty('ball', '#ffffff');
    expect(COLORS).toHaveProperty('ballOutline', '#2b2b2b');
  });

  it('outlines the aim line in near-black', () => {
    expect(COLORS).toHaveProperty('aimOutline', '#1a1a1a');
  });

  it('pins the flag pennant and pole colours', () => {
    expect(COLORS).toHaveProperty('flag', '#e8443a');
    expect(COLORS).toHaveProperty('flagPole', '#f4efe1');
  });
});

describe('READABLE_STROKES', () => {
  it('lists the aim line colours and the ball with their outlines', () => {
    expect(READABLE_STROKES).toEqual([
      { name: 'aimWeak', fill: '#ffe066', outline: '#1a1a1a' },
      { name: 'aimStrong', fill: '#ff4d4d', outline: '#1a1a1a' },
      { name: 'ball', fill: '#ffffff', outline: '#2b2b2b' },
      { name: 'flag', fill: '#e8443a', outline: '#1a1a1a' },
      { name: 'flagPole', fill: '#f4efe1', outline: '#1a1a1a' },
    ]);
  });
});
