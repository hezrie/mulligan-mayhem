import type { Nav, Screen } from '../screen.ts';

export interface MenuItem {
  /** Suffix of the button's data-testid: `menu-<id>`. */
  readonly id: string;
  readonly label: string;
  readonly select: (nav: Nav) => void;
}

/** Each game mode adds its own entry here when it ships. */
export const MENU_ITEMS: readonly MenuItem[] = [
  {
    id: 'play',
    label: 'Play',
    select: (nav) => {
      nav.reset('play');
    },
  },
];

/** Title screen: the game's name up top, big buttons in the thumb zone below. */
export function createMenuScreen(nav: Nav): Screen {
  return {
    mount(el) {
      const title = document.createElement('h1');
      title.className = 'menu-title';
      title.textContent = 'Mulligan Mayhem';
      const list = document.createElement('div');
      list.className = 'menu-items';
      for (const item of MENU_ITEMS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['testid'] = `menu-${item.id}`;
        button.textContent = item.label;
        button.addEventListener('click', () => {
          item.select(nav);
        });
        list.append(button);
      }
      el.append(title, list);
    },
    unmount() {
      // The shell removes the section and with it every listener; nothing else to release.
    },
  };
}
