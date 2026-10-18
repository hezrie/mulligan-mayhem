import type { TerrainKind } from '../core/physics/terrain.ts';

/** Every terrain kind needs a colour; TypeScript enforces this when a kind is added. */
export const TERRAIN_COLORS: Readonly<Record<TerrainKind, string>> = {
  fairway: '#5cb85c',
  rough: '#3e8e41',
  sand: '#e6d3a3',
  ice: '#bfe6ff',
};

export const COLORS = {
  background: '#1f5f2a',
  wall: '#f4efe1',
  wallShadow: 'rgba(0, 0, 0, 0.25)',
  cup: '#101010',
  cupRim: '#e8e8e8',
  ball: '#ffffff',
  ballOutline: '#2b2b2b',
  aimWeak: '#ffe066',
  aimStrong: '#ff4d4d',
  aimOutline: '#1a1a1a',
} as const;

/**
 * Strokes that must stay readable on every terrain: either the fill or the outline needs at least
 * 3:1 contrast against each TERRAIN_COLORS entry (guarded by tests/unit/render/contrast.test.ts).
 */
export const READABLE_STROKES: readonly Readonly<{
  name: string;
  fill: string;
  outline: string;
}>[] = [
  { name: 'aimWeak', fill: COLORS.aimWeak, outline: COLORS.aimOutline },
  { name: 'aimStrong', fill: COLORS.aimStrong, outline: COLORS.aimOutline },
  { name: 'ball', fill: COLORS.ball, outline: COLORS.ballOutline },
];
