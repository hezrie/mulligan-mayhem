import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo>/.
export const BASE_PATH = '/mulligan-mayhem/';

export default defineConfig(({ mode }) => ({
  base: BASE_PATH,
  define: {
    // The window.__MM__ test API exists in dev, test and e2e builds only.
    // In production this is the literal `false`, so the bundler drops the code.
    __TEST_API__: JSON.stringify(mode !== 'production'),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
}));
