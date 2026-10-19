import { describe, expect, it } from 'vitest';
import {
  COLOUR_SCHEMES,
  DEFAULT_SETTINGS,
  parseSettings,
  SettingsSchema,
  type AimMode,
  type MotionSetting,
  type Settings,
  type TextSize,
} from '../../../../src/core/game/settings.ts';
import { Rng } from '../../../../src/core/rng.ts';

describe('DEFAULT_SETTINGS', () => {
  it('matches the settings-defaults product decision and is frozen', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      volume: 70,
      music: false,
      haptics: true,
      motion: 'system',
      colours: 'classic',
      aimMode: 'grab',
      handedness: 'right',
      showPower: false,
      textSize: 100,
    });
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('exports the colour schemes and the setting types', () => {
    expect(COLOUR_SCHEMES).toEqual(['classic']);
    const aim: AimMode[] = ['grab', 'anywhere'];
    const motion: MotionSetting[] = ['system', 'full', 'reduced'];
    const sizes: TextSize[] = [100, 120, 140];
    const settings: Settings = DEFAULT_SETTINGS;
    expect([aim.length, motion.length, sizes.length, settings.version]).toEqual([2, 3, 3, 1]);
  });
});

describe('parseSettings', () => {
  it.each([undefined, null, 0, 42, '', 'volume', true, [], [1, 2], {}])(
    'returns the defaults for %j',
    (input) => {
      expect(parseSettings(input)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('falls back per field', () => {
    expect(parseSettings({ volume: 30, music: 'yes' })).toEqual({
      ...DEFAULT_SETTINGS,
      volume: 30,
      music: false,
    });
  });

  it.each<[keyof Settings, unknown]>([
    ['volume', -1],
    ['volume', 101],
    ['volume', 50.5],
    ['volume', '70'],
    ['volume', NaN],
    ['music', 1],
    ['haptics', 'true'],
    ['motion', 'fast'],
    ['colours', 'neon'],
    ['aimMode', 'drag'],
    ['handedness', 'both'],
    ['showPower', null],
    ['textSize', 110],
    ['textSize', '100'],
  ])('resets only %s when it is %j', (key, value) => {
    const valid = { ...DEFAULT_SETTINGS, volume: 30, music: true, haptics: false, textSize: 120 };
    const expected = { ...valid, [key]: DEFAULT_SETTINGS[key] };
    expect(parseSettings({ ...valid, [key]: value })).toEqual(expected);
  });

  it.each<[keyof Settings, unknown]>([
    ['volume', 0],
    ['volume', 100],
    ['motion', 'full'],
    ['motion', 'reduced'],
    ['aimMode', 'anywhere'],
    ['handedness', 'left'],
    ['textSize', 120],
    ['textSize', 140],
  ])('keeps %s = %j', (key, value) => {
    expect(parseSettings({ [key]: value })).toEqual({ ...DEFAULT_SETTINGS, [key]: value });
  });

  it('drops unknown keys and always reports version 1', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, extra: 1, version: 7 })).toEqual(DEFAULT_SETTINGS);
  });
});

const KEYS = [...Object.keys(DEFAULT_SETTINGS), 'extra'];
const PRIMITIVES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -1,
  50.5,
  70,
  100,
  101,
  120,
  140,
  NaN,
  Infinity,
  '',
  '70',
  'grab',
  'anywhere',
  'left',
  'right',
  'system',
  'full',
  'reduced',
  'classic',
];

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.int(0, items.length - 1)] as T;
}

function randomPrimitive(rng: Rng): unknown {
  return rng.float() < 0.5 ? pick(rng, PRIMITIVES) : rng.int(-200, 200);
}

function randomValue(rng: Rng): unknown {
  const kind = rng.int(0, 2);
  if (kind === 0) return randomPrimitive(rng);
  if (kind === 1) return Array.from({ length: rng.int(0, 4) }, () => randomPrimitive(rng));
  const value: Record<string, unknown> = {};
  for (const key of KEYS) if (rng.float() < 0.6) value[key] = randomPrimitive(rng);
  return value;
}

describe('parseSettings property', () => {
  it('never throws and always returns canonical, JSON-stable settings', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 500; i++) {
      const input = randomValue(rng);
      let result: Settings | undefined;
      expect(() => (result = parseSettings(input))).not.toThrow();
      expect(SettingsSchema.parse(result)).toEqual(result);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });
});
