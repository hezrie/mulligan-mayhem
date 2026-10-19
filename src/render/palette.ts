import type { TerrainKind } from '../core/physics/terrain.ts';

/** Every terrain kind needs a colour; TypeScript enforces this when a kind is added. */
export const TERRAIN_COLORS: Readonly<Record<TerrainKind, string>> = {
  fairway: '#5cb85c',
  rough: '#3e8e41',
  sand: '#e6d3a3',
  ice: '#bfe6ff',
  water: '#3a7bd5',
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
  // The slingshot power ramp: green when soft, yellow by 0.6, red at full power.
  powerLow: '#4caf50',
  powerMid: '#ffe066',
  powerHigh: '#ff4d4d',
  // A release that would cancel is greyed out so it reads as "nothing will happen".
  aimCancel: '#9e9e9e',
  flag: '#e8443a',
  flagPole: '#f4efe1',
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
  { name: 'flag', fill: COLORS.flag, outline: COLORS.aimOutline },
  { name: 'flagPole', fill: COLORS.flagPole, outline: COLORS.aimOutline },
  { name: 'powerLow', fill: COLORS.powerLow, outline: COLORS.aimOutline },
  { name: 'powerMid', fill: COLORS.powerMid, outline: COLORS.aimOutline },
  { name: 'powerHigh', fill: COLORS.powerHigh, outline: COLORS.aimOutline },
  { name: 'aimCancel', fill: COLORS.aimCancel, outline: COLORS.aimOutline },
];
