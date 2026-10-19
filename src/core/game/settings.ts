import { z } from 'zod';

/** Colour schemes the renderer can draw; tickets that draw a new scheme add it here. */
export const COLOUR_SCHEMES = ['classic'] as const;

const AIM_MODES = ['grab', 'anywhere'] as const;
const MOTION_SETTINGS = ['system', 'full', 'reduced'] as const;
const HANDEDNESS = ['right', 'left'] as const;
const TEXT_SIZES = [100, 120, 140] as const;

export type AimMode = (typeof AIM_MODES)[number];
export type MotionSetting = (typeof MOTION_SETTINGS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];

/**
 * Settings v1. Every field has its own .catch, so a missing, outdated or hand-edited value
 * resets only that field to its default (the settings-defaults product decision) and parsing
 * never throws. Volume 0 means sound off; v1 has no separate sound-effects toggle.
 */
export const SettingsSchema = z.object({
  version: z.literal(1).catch(1),
  volume: z.number().int().min(0).max(100).catch(70),
  music: z.boolean().catch(false),
  haptics: z.boolean().catch(true),
  motion: z.enum(MOTION_SETTINGS).catch('system'),
  colours: z.enum(COLOUR_SCHEMES).catch('classic'),
  aimMode: z.enum(AIM_MODES).catch('grab'),
  handedness: z.enum(HANDEDNESS).catch('right'),
  showPower: z.boolean().catch(false),
  textSize: z.literal(TEXT_SIZES).catch(100),
});

export type Settings = z.infer<typeof SettingsSchema>;

/** Parses stored data into valid settings; non-objects (including arrays) become all defaults. */
export function parseSettings(input: unknown): Settings {
  const isRecord = typeof input === 'object' && input !== null && !Array.isArray(input);
  return SettingsSchema.parse(isRecord ? input : {});
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze(parseSettings({}));
