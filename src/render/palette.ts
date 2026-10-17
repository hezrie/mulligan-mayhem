import type { TerrainKind } from '../core/physics/terrain.ts';

/** Every terrain kind needs a colour; TypeScript enforces this when a kind is added. */
export const TERRAIN_COLORS: Readonly<Record<TerrainKind, string>> = {
  fairway: '#5cb85c',
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
} as const;
