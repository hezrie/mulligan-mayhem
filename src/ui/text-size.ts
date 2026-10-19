import type { SettingsStore } from './settings-store.ts';

/**
 * Scales the root font size to the text-size setting, now and on every change. All UI sizes are
 * in rem, so this one percentage scales the HUD and every screen together.
 */
export function applyTextSize(root: HTMLElement, settings: SettingsStore): void {
  const apply = (textSize: number): void => {
    root.style.fontSize = `${String(textSize)}%`;
  };
  apply(settings.get().textSize);
  settings.subscribe((next) => {
    apply(next.textSize);
  });
}
