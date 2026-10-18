import { describe, expect, it } from 'vitest';
import { TERRAIN_KINDS } from '../../../src/core/physics/terrain.ts';
import { contrastRatio, relativeLuminance } from '../../../src/render/contrast.ts';
import { READABLE_STROKES, TERRAIN_COLORS } from '../../../src/render/palette.ts';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 12);
  });

  it('uses the linear segment below the 0.04045 threshold', () => {
    // 0x0a / 255 ≈ 0.0392 is below the threshold, so it is divided by 12.92.
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 12);
  });
});

describe('contrastRatio', () => {
  it('gives 21 for white on black', () => {
    expect(Math.abs(contrastRatio('#ffffff', '#000000') - 21)).toBeLessThanOrEqual(1e-6);
  });

  it('gives 1 for a colour against itself', () => {
    expect(contrastRatio('#5cb85c', '#5cb85c')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#ffe066', '#3e8e41')).toBe(contrastRatio('#3e8e41', '#ffe066'));
  });

  it('measures the aim line on sand at about 1.13', () => {
    expect(Math.abs(contrastRatio('#ffe066', '#e6d3a3') - 1.13)).toBeLessThanOrEqual(0.005);
  });

  it.each(['#fff', 'red', '#gggggg', 'ffffff'])('rejects %s with a RangeError', (bad) => {
    expect(() => contrastRatio(bad, '#000000')).toThrow(RangeError);
    expect(() => contrastRatio('#000000', bad)).toThrow(RangeError);
    expect(() => relativeLuminance(bad)).toThrow(RangeError);
  });
});

describe('readability guardrail', () => {
  const cases = READABLE_STROKES.flatMap((stroke) =>
    TERRAIN_KINDS.map((kind) => [stroke.name, kind, stroke] as const),
  );

  it.each(cases)('%s stays readable on %s (≥ 3:1 via fill or outline)', (_name, kind, stroke) => {
    const ground = TERRAIN_COLORS[kind];
    const best = Math.max(
      contrastRatio(stroke.fill, ground),
      contrastRatio(stroke.outline, ground),
    );
    expect(best).toBeGreaterThanOrEqual(3);
  });
});
