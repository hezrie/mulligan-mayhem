/**
 * Shape of the test API exposed as `window.__MM__` in dev/test/e2e builds only.
 * Phase 3 extends this with loadHole / shoot / fastForward / getState / getStateHash.
 */
export interface MulliganTestApi {
  readonly ready: true;
}

declare global {
  interface Window {
    __MM__?: MulliganTestApi;
  }
}
