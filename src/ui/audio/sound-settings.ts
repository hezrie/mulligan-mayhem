import type { AudioEngine } from './engine.ts';

/** The sound slice of the saved settings; `sfxVolume` is on the 0..100 settings scale. */
export interface SoundSettings {
  readonly sfxOn: boolean;
  readonly sfxVolume: number;
}

/** Structural, so a settings store can be adapted to it in a few lines. */
export interface SoundSettingsSource {
  get(): SoundSettings;
  subscribe(listener: (settings: SoundSettings) => void): () => void;
}

export interface BindSoundSettingsOptions {
  readonly engine: Pick<AudioEngine, 'setVolume' | 'setSfxEnabled'>;
}

/** Applies the current sound settings to the engine now and on every change. Returns unbind. */
export function bindSoundSettings(
  source: SoundSettingsSource,
  { engine }: BindSoundSettingsOptions,
): () => void {
  const apply = (settings: SoundSettings): void => {
    engine.setVolume(settings.sfxVolume);
    engine.setSfxEnabled(settings.sfxOn);
  };
  apply(source.get());
  return source.subscribe(apply);
}
