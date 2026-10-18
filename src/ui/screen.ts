import type { ScreenId } from './router.ts';

/** A full-screen view the shell mounts into its own section while it is the top of the stack. */
export interface Screen {
  mount(el: HTMLElement): void;
  unmount(): void;
}

/** Navigation that screens receive from the shell; they never touch history themselves. */
export interface Nav {
  open(id: ScreenId): void;
  back(): void;
  reset(id: ScreenId): void;
}
