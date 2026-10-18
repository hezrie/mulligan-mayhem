import { describe, expect, it } from 'vitest';
import { aimStrokeStyles } from '../../../src/render/aim.ts';
import { COLORS } from '../../../src/render/palette.ts';

describe('aimStrokeStyles', () => {
  it('draws a weak line with a 2-unit-wider outline at power 0', () => {
    expect(aimStrokeStyles(0)).toEqual([
      { color: COLORS.aimOutline, width: 4 },
      { color: COLORS.aimWeak, width: 2 },
    ]);
  });

  it('draws a strong line with a 2-unit-wider outline at power 1', () => {
    expect(aimStrokeStyles(1)).toEqual([
      { color: COLORS.aimOutline, width: 7 },
      { color: COLORS.aimStrong, width: 5 },
    ]);
  });

  it('switches to the strong colour only above 0.66', () => {
    expect(aimStrokeStyles(0.66)[1]?.color).toBe(COLORS.aimWeak);
    expect(aimStrokeStyles(0.67)[1]?.color).toBe(COLORS.aimStrong);
  });

  it('scales the width with power, outline first', () => {
    const [outline, line] = aimStrokeStyles(0.5);
    expect(line?.width).toBeCloseTo(3.5, 12);
    expect(outline?.width).toBeCloseTo(5.5, 12);
    expect(outline?.color).toBe(COLORS.aimOutline);
  });
});
