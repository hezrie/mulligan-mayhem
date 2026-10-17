import type { MulliganTestApi } from './types.ts';

/** Installs `window.__MM__`. Only ever called from main.ts behind `__TEST_API__`. */
export function installTestApi(target: Window): MulliganTestApi {
  const api: MulliganTestApi = { ready: true };
  target.__MM__ = api;
  return api;
}
