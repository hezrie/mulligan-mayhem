import { defineConfig } from 'vitest/config';

// PROTECTED FILE: coverage thresholds are a quality gate. Agents may not edit this file.
export default defineConfig({
  define: {
    __TEST_API__: 'true',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/main.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      thresholds: {
        'src/core/**/*.ts': { lines: 90, branches: 85 },
      },
    },
  },
});
