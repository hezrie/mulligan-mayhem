import type { Nav, Screen } from '../screen.ts';

/** Overlay over a paused hole. The shell freezes the simulation while it is on top. */
export function createPauseScreen(nav: Nav, onRestart: () => void): Screen {
  const items: readonly (readonly [id: string, label: string, select: () => void])[] = [
    [
      'resume',
      'Resume',
      () => {
        nav.back();
      },
    ],
    [
      'restart',
      'Restart hole',
      () => {
        onRestart();
        nav.back();
      },
    ],
    [
      'settings',
      'Settings',
      () => {
        nav.open('settings');
      },
    ],
    [
      'quit',
      'Quit to title',
      () => {
        nav.reset('menu');
      },
    ],
  ];
  return {
    mount(el) {
      const heading = document.createElement('h1');
      heading.className = 'menu-title';
      heading.textContent = 'Paused';
      const list = document.createElement('div');
      list.className = 'menu-items';
      for (const [id, label, select] of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['testid'] = `pause-${id}`;
        button.textContent = label;
        button.addEventListener('click', select);
        list.append(button);
      }
      el.append(heading, list);
    },
    unmount() {
      // The shell removes the section and with it every listener; nothing else to release.
    },
  };
}
