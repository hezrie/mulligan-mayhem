import { COLORS } from './palette.ts';

export type StrokeStyle = Readonly<{ color: string; width: number }>;

/** Above this power the aim line turns from the weak to the strong colour. */
const STRONG_POWER = 0.66;

/**
 * Stroke passes for the aim line, drawn in order: a dark outline first, then the coloured line on
 * top, so the line stays readable on light terrain (sand, ice) as well as dark.
 */
export function aimStrokeStyles(power: number): readonly StrokeStyle[] {
  const width = 2 + 3 * power;
  return [
    { color: COLORS.aimOutline, width: width + 2 },
    { color: power > STRONG_POWER ? COLORS.aimStrong : COLORS.aimWeak, width },
  ];
}
