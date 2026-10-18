/**
 * WCAG 2.x contrast maths, so tests can prove every stroke stays readable on every terrain.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

const HEX = /^#[0-9a-f]{6}$/i;

function channel(hex: string, start: number): number {
  const srgb = parseInt(hex.slice(start, start + 2), 16) / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

/** Relative luminance of a '#rrggbb' colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  // Shorthand and named colours are rejected so the palette has one spelling per colour.
  if (!HEX.test(hex)) throw new RangeError(`Expected '#rrggbb', got '${hex}'`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Contrast ratio between two '#rrggbb' colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
