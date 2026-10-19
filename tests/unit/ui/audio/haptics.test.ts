import { describe, expect, it, vi } from 'vitest';
import { createHaptics, hapticFor } from '../../../../src/ui/audio/haptics.ts';

describe('hapticFor', () => {
  it.each([
    [0.01, 8],
    [0.05, 8],
    [0.5, 16],
    [1, 25],
    [1.4, 25],
  ])('putt at power %d buzzes %d ms', (power, ms) => {
    expect(hapticFor({ type: 'putt', power })).toBe(ms);
  });

  it.each([
    [400, 25],
    [399.9, 12],
    [150, 12],
    [149.9, null],
  ])('bounce at impulse %d gives %s', (impulse, pattern) => {
    expect(hapticFor({ type: 'bounce', impulse })).toBe(pattern);
  });

  it('cup', () => {
    expect(hapticFor({ type: 'cup' })).toEqual([15, 40, 30]);
  });

  it('hole-in-one', () => {
    expect(hapticFor({ type: 'hole-in-one' })).toEqual([30, 60, 30, 60, 120]);
  });
});

describe('createHaptics', () => {
  it('is enabled by default', () => {
    expect(createHaptics({}).enabled()).toBe(true);
  });

  it('never vibrates before arm()', () => {
    const vibrate = vi.fn();
    const haptics = createHaptics({ vibrate });
    haptics.pulse(20);
    haptics.pulse([15, 40, 30]);
    expect(vibrate).toHaveBeenCalledTimes(0);
  });

  it('vibrates with the pattern once armed and enabled', () => {
    const vibrate = vi.fn();
    const haptics = createHaptics({ vibrate });
    haptics.arm();
    haptics.pulse(20);
    haptics.pulse([15, 40, 30]);
    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(vibrate).toHaveBeenNthCalledWith(1, 20);
    expect(vibrate).toHaveBeenNthCalledWith(2, [15, 40, 30]);
  });

  it('pulse(null) never vibrates', () => {
    const vibrate = vi.fn();
    const haptics = createHaptics({ vibrate });
    haptics.arm();
    haptics.pulse(null);
    expect(vibrate).toHaveBeenCalledTimes(0);
  });

  it('setEnabled(false) silences it and setEnabled(true) restores it', () => {
    const vibrate = vi.fn();
    const haptics = createHaptics({ vibrate });
    haptics.arm();
    haptics.setEnabled(false);
    expect(haptics.enabled()).toBe(false);
    haptics.pulse(20);
    expect(vibrate).toHaveBeenCalledTimes(0);
    haptics.setEnabled(true);
    expect(haptics.enabled()).toBe(true);
    haptics.pulse(20);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not throw without vibrate', () => {
    const haptics = createHaptics({});
    haptics.arm();
    expect(() => {
      haptics.pulse(20);
    }).not.toThrow();
  });

  it('does not throw when vibrate throws', () => {
    const vibrate = vi.fn(() => {
      throw new Error('blocked');
    });
    const haptics = createHaptics({ vibrate });
    haptics.arm();
    expect(() => {
      haptics.pulse([30, 60, 30]);
    }).not.toThrow();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
