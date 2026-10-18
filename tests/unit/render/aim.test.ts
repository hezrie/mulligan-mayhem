import { describe, expect, it } from 'vitest';
import { MAX_DRAG } from '../../../src/input/drag-to-shot.ts';
import {
  BAND_MAX_LENGTH,
  aimStrokeStyles,
  aimVisual,
  bandEnd,
  bandWidth,
  litTicks,
  powerColor,
  ringTicks,
} from '../../../src/render/aim.ts';
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

describe('slingshot band', () => {
  it('mirrors MAX_DRAG from the input layer', () => {
    expect(BAND_MAX_LENGTH).toBe(160);
    expect(BAND_MAX_LENGTH).toBe(MAX_DRAG);
  });

  it('thins the band from 6 to 2 as power rises', () => {
    expect(bandWidth(0)).toBe(6);
    expect(bandWidth(0.5)).toBe(4);
    expect(bandWidth(1)).toBe(2);
    expect(bandWidth(-1)).toBe(6);
    expect(bandWidth(2)).toBe(2);
  });

  it('ends the band behind the ball, under the finger', () => {
    const ball = { x: 100, y: 100 };
    const a = bandEnd(ball, { angle: 0, power: 0.5 });
    expect(a.x).toBeCloseTo(20, 9);
    expect(a.y).toBeCloseTo(100, 9);
    const b = bandEnd(ball, { angle: Math.PI / 2, power: 1 });
    expect(b.x).toBeCloseTo(100, 9);
    expect(b.y).toBeCloseTo(-60, 9);
  });
});

describe('litTicks', () => {
  it.each([
    [0.049, 0],
    [0.05, 0],
    [0.55, 5],
    [0.6, 6],
    [0.7, 7],
    [0.999, 9],
    [1, 10],
  ])('lights %s → %i ticks', (power, ticks) => {
    expect(litTicks(power)).toBe(ticks);
  });
});

describe('powerColor', () => {
  it('pins the low, mid, high and cancel colours', () => {
    expect(COLORS.powerLow).toBe('#4caf50');
    expect(COLORS.powerMid).toBe('#ffe066');
    expect(COLORS.powerHigh).toBe('#ff4d4d');
    expect(COLORS.aimCancel).toBe('#9e9e9e');
  });

  it.each([
    [0, '#4caf50'],
    [0.2, '#88bf57'],
    [0.6, '#ffe066'],
    [0.7, '#ffbb60'],
    [0.9, '#ff7253'],
    [1, '#ff4d4d'],
    [-1, '#4caf50'],
    [2, '#ff4d4d'],
  ])('maps %s → %s', (power, color) => {
    expect(powerColor(power)).toBe(color);
  });
});

describe('aimVisual', () => {
  it('greys out a release that would cancel', () => {
    expect(aimVisual({ angle: 0, power: 0.04 })).toEqual({
      cancel: true,
      bandWidth: bandWidth(0.04),
      litTicks: 0,
      color: '#9e9e9e',
    });
  });

  it('colours a real shot by its power', () => {
    expect(aimVisual({ angle: 1, power: 0.5 })).toEqual({
      cancel: false,
      bandWidth: 4,
      litTicks: 5,
      color: powerColor(0.5),
    });
  });
});

describe('ringTicks', () => {
  const center = { x: 0, y: 0 };

  it('returns 10 ticks, the first pointing straight up from radius 22 to 26', () => {
    const ticks = ringTicks(center, aimVisual({ angle: 0, power: 0.5 }));
    expect(ticks).toHaveLength(10);
    const first = ticks[0];
    expect(first?.from.x).toBeCloseTo(0, 9);
    expect(first?.from.y).toBeCloseTo(-22, 9);
    expect(first?.to.x).toBeCloseTo(0, 9);
    expect(first?.to.y).toBeCloseTo(-26, 9);
  });

  it('spaces the ticks clockwise every 2π/10', () => {
    const ticks = ringTicks({ x: 10, y: 20 }, aimVisual({ angle: 0, power: 0.5 }));
    ticks.forEach((tick, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 10;
      expect(tick.from.x).toBeCloseTo(10 + 22 * Math.cos(angle), 9);
      expect(tick.from.y).toBeCloseTo(20 + 22 * Math.sin(angle), 9);
      expect(tick.to.x).toBeCloseTo(10 + 26 * Math.cos(angle), 9);
      expect(tick.to.y).toBeCloseTo(20 + 26 * Math.sin(angle), 9);
    });
  });

  it('lights ticks up to litTicks in their own power colour', () => {
    const ticks = ringTicks(center, aimVisual({ angle: 0, power: 0.7 }));
    ticks.forEach((tick, index) => {
      const i = index + 1;
      expect(tick.color).toBe(i <= 7 ? powerColor(i / 10) : 'rgba(255, 255, 255, 0.35)');
    });
  });

  it('greys every tick when the release would cancel', () => {
    const visual = { cancel: true, bandWidth: 6, litTicks: 3, color: COLORS.aimCancel };
    for (const tick of ringTicks(center, visual)) expect(tick.color).toBe(COLORS.aimCancel);
  });
});
