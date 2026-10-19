import { parseSettings, type Settings } from '../../core/game/settings.ts';
import type { Nav, Screen } from '../screen.ts';
import type { SettingsStore } from '../settings-store.ts';

type Control =
  | { readonly kind: 'range'; readonly field: 'volume' }
  | { readonly kind: 'checkbox'; readonly field: 'music' | 'haptics' }
  | {
      readonly kind: 'select';
      readonly field: 'motion' | 'aimMode' | 'textSize';
      readonly options: readonly (readonly [value: string, label: string])[];
    };

/**
 * One row per player-facing setting. Colours, handedness and showPower get a row only once
 * something reads them.
 */
const CONTROLS: readonly (Control & { readonly testId: string; readonly label: string })[] = [
  { field: 'volume', testId: 'volume', label: 'Volume', kind: 'range' },
  { field: 'music', testId: 'music', label: 'Music', kind: 'checkbox' },
  { field: 'haptics', testId: 'haptics', label: 'Haptics', kind: 'checkbox' },
  {
    field: 'motion',
    testId: 'motion',
    label: 'Motion',
    kind: 'select',
    options: [
      ['system', 'System'],
      ['full', 'Full'],
      ['reduced', 'Reduced'],
    ],
  },
  {
    field: 'aimMode',
    testId: 'aim-mode',
    label: 'Aim',
    kind: 'select',
    options: [
      ['grab', 'Grab the ball'],
      ['anywhere', 'Drag anywhere'],
    ],
  },
  {
    field: 'textSize',
    testId: 'text-size',
    label: 'Text size',
    kind: 'select',
    options: [
      ['100', '100%'],
      ['120', '120%'],
      ['140', '140%'],
    ],
  },
];

/** Every change is written through the page's one settings store, so it applies live and persists. */
export function createSettingsScreen(nav: Nav, settings: SettingsStore): Screen {
  return {
    mount(el) {
      const heading = document.createElement('h1');
      heading.className = 'settings-title';
      heading.textContent = 'Settings';
      const list = document.createElement('div');
      list.className = 'settings-controls';
      const current = settings.get();
      for (const control of CONTROLS) {
        const label = document.createElement('label');
        const text = document.createElement('span');
        text.textContent = control.label;
        const input = createInput(control, current, settings);
        input.dataset['testid'] = `settings-${control.testId}`;
        label.append(text, input);
        list.append(label);
      }
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'settings-back';
      back.dataset['testid'] = 'settings-back';
      back.textContent = 'Back';
      back.addEventListener('click', () => {
        nav.back();
      });
      el.append(heading, list, back);
    },
    unmount() {
      // The shell removes the section and with it every listener; nothing else to release.
    },
  };
}

function createInput(
  control: Control,
  current: Readonly<Settings>,
  settings: SettingsStore,
): HTMLInputElement | HTMLSelectElement {
  // parseSettings validates the raw DOM value; anything unexpected falls back to the default.
  const save = (raw: unknown): void => {
    settings.update({ [control.field]: parseSettings({ [control.field]: raw })[control.field] });
  };
  if (control.kind === 'select') {
    const select = document.createElement('select');
    for (const [value, text] of control.options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = String(current[control.field]);
    select.addEventListener('change', () => {
      save(control.field === 'textSize' ? Number(select.value) : select.value);
    });
    return select;
  }
  const input = document.createElement('input');
  if (control.kind === 'checkbox') {
    input.type = 'checkbox';
    input.checked = current[control.field];
    input.addEventListener('change', () => {
      save(input.checked);
    });
    return input;
  }
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = String(current[control.field]);
  input.addEventListener('input', () => {
    save(Number(input.value));
  });
  return input;
}
