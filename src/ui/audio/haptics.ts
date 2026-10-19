/**
 * Vibration patterns as plain data, plus a gate that decides whether a pattern may buzz. Patterns
 * are milliseconds in `navigator.vibrate` form: one buzz, or alternating buzz/pause lengths.
 */

export type HapticPattern = number | readonly number[];

export type HapticCue =
  | { readonly type: 'putt'; readonly power: number }
  | { readonly type: 'bounce'; readonly impulse: number }
  | { readonly type: 'cup' }
  | { readonly type: 'hole-in-one' };

// Same floor as the putt voice, so the faintest tap still gives a buzz you can feel.
const PUTT_MIN_POWER = 0.05;
const PUTT_MIN_MS = 8;
const PUTT_MAX_MS = 25;
// Bounce impulses: below SOFT is a graze not worth a buzz; HARD and up is a full knock.
const BOUNCE_SOFT_IMPULSE = 150;
const BOUNCE_HARD_IMPULSE = 400;
const BOUNCE_SOFT_MS = 12;
const BOUNCE_HARD_MS = 25;
// Rattle, pause, thunk: mirrors the cup sound.
const CUP: HapticPattern = [15, 40, 30];
const HOLE_IN_ONE: HapticPattern = [30, 60, 30, 60, 120];

function puttMs(power: number): number {
  const p = Math.min(1, Math.max(PUTT_MIN_POWER, power));
  return Math.round(
    PUTT_MIN_MS + ((PUTT_MAX_MS - PUTT_MIN_MS) * (p - PUTT_MIN_POWER)) / (1 - PUTT_MIN_POWER),
  );
}

/** The vibration for one cue, or `null` when it should not buzz. Pure. */
export function hapticFor(cue: HapticCue): HapticPattern | null {
  switch (cue.type) {
    case 'putt':
      return puttMs(cue.power);
    case 'bounce':
      if (cue.impulse >= BOUNCE_HARD_IMPULSE) return BOUNCE_HARD_MS;
      return cue.impulse >= BOUNCE_SOFT_IMPULSE ? BOUNCE_SOFT_MS : null;
    case 'cup':
      return CUP;
    case 'hole-in-one':
      return HOLE_IN_ONE;
  }
}

export interface HapticsOptions {
  /** Usually `navigator.vibrate`; absent on browsers without it (iOS Safari). */
  readonly vibrate?: (pattern: VibratePattern) => unknown;
}

export interface Haptics {
  /** Call on the first user gesture; browsers ignore or warn about vibration before it. */
  arm(): void;
  setEnabled(on: boolean): void;
  enabled(): boolean;
  pulse(pattern: HapticPattern | null): void;
}

export function createHaptics({ vibrate }: HapticsOptions): Haptics {
  let armed = false;
  let on = true;
  return {
    arm() {
      armed = true;
    },
    setEnabled(value) {
      on = value;
    },
    enabled: () => on,
    pulse(pattern) {
      if (pattern === null || !armed || !on || vibrate === undefined) return;
      try {
        vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
      } catch {
        // A blocked or broken vibrator must never interrupt play.
      }
    },
  };
}
