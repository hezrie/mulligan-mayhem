/**
 * Terrain kinds and their physical parameters. To add a terrain, add its kind here and its
 * parameters to TERRAIN; the hole schema accepts every kind listed in TERRAIN_KINDS.
 */
export const TERRAIN_KINDS = ['fairway', 'rough', 'sand', 'ice', 'water'] as const;

export type TerrainKind = (typeof TERRAIN_KINDS)[number];

export interface TerrainParams {
  /** Constant rolling deceleration in units/s². Higher = the ball stops sooner. */
  readonly rollingDecel: number;
  readonly label: string;
}

export const TERRAIN: Readonly<Record<TerrainKind, TerrainParams>> = {
  fairway: { rollingDecel: 360, label: 'Fairway' },
  // Multiples of fairway, so a roll stops in 1/2 (rough) or 1/3 (sand) of the fairway distance.
  rough: { rollingDecel: 720, label: 'Rough' },
  sand: { rollingDecel: 1080, label: 'Sand' },
  // A quarter of fairway, so a roll goes 4× as far and players must judge power carefully.
  ice: { rollingDecel: 90, label: 'Ice' },
  // A ball whose centre ends a step in water is a hazard and stops at once, so this rate never
  // shapes a roll. Fairway's value keeps it positive and above ice (the invariants' slowest).
  water: { rollingDecel: 360, label: 'Water' },
};
