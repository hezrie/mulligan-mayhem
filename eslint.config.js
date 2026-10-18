// PROTECTED FILE: lint rules enforce the architecture. Agents may not edit this file.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PURITY_MESSAGE =
  'src/core must stay pure and deterministic: no DOM, no clocks, no I/O (docs/ARCHITECTURE.md).';

const CORE_BANNED_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'performance',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'fetch',
  'Date',
  'console',
  'process',
  'crypto',
  'globalThis',
  'self',
];

// These Math functions are implementation-approximated in ECMAScript, so results can differ
// between engines (e.g. Safari vs Chrome). Core uses src/core/math helpers instead (ADR 0001).
const ENGINE_DEPENDENT_MATH = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'hypot',
  'cbrt',
];

export default defineConfig(
  {
    ignores: [
      'dist/',
      'dist-e2e/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'blob-report/',
      'node_modules/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...CORE_BANNED_GLOBALS.map((name) => ({ name, message: PURITY_MESSAGE })),
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded PRNG in src/core/rng.ts — it is the only source of randomness.',
        },
        ...ENGINE_DEPENDENT_MATH.map((property) => ({
          object: 'Math',
          property,
          message: `Math.${property} is engine-dependent. Use the deterministic helpers in src/core/math (ADR 0001).`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**']",
          message: '`**` is engine-dependent. Multiply explicitly or use src/core/math (ADR 0001).',
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message:
            '`**=` is engine-dependent. Multiply explicitly or use src/core/math (ADR 0001).',
        },
      ],
    },
  },
  {
    files: ['src/main.ts'],
    rules: {
      // main.ts only boots src/app (and the dev/test API); wiring lives in src/app.
      'max-lines': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/app/**/*.ts'],
    rules: {
      // The composition root wires layers together; split a growing file into siblings.
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  prettier,
);
