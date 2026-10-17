/**
 * Terrain kinds and their physical parameters. To add a terrain, add its kind here and its
 * parameters to TERRAIN; the hole schema accepts every kind listed in TERRAIN_KINDS.
 */
export const TERRAIN_KINDS = ['fairway'] as const;

export type TerrainKind = (typeof TERRAIN_KINDS)[number];

export interface TerrainParams {
  /** Constant rolling deceleration in units/s². Higher = the ball stops sooner. */
  readonly rollingDecel: number;
  readonly label: string;
}

export const TERRAIN: Readonly<Record<TerrainKind, TerrainParams>> = {
  fairway: { rollingDecel: 360, label: 'Fairway' },
};
