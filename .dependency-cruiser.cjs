// PROTECTED FILE: this is the enforced layer map (docs/ARCHITECTURE.md). Agents may not edit it.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      severity: 'error',
      comment:
        'src/core may import only other src/core modules and zod. No DOM, no Node built-ins, no other layers.',
      from: { path: '^src/core/' },
      to: { pathNot: ['^src/core/', '^node_modules/zod/'] },
    },
    {
      name: 'input-depends-only-on-core',
      severity: 'error',
      from: { path: '^src/input/' },
      to: { path: '^src/(render|ui|testing|app)/|^src/main\\.ts$' },
    },
    {
      name: 'render-depends-only-on-core',
      severity: 'error',
      from: { path: '^src/render/' },
      to: { path: '^src/(input|ui|testing|app)/|^src/main\\.ts$' },
    },
    {
      name: 'ui-depends-only-on-core',
      severity: 'error',
      from: { path: '^src/ui/' },
      to: { path: '^src/(input|render|testing|app)/|^src/main\\.ts$' },
    },
    {
      name: 'testing-depends-only-on-core',
      severity: 'error',
      from: { path: '^src/testing/' },
      to: { path: '^src/(input|render|ui|app)/|^src/main\\.ts$' },
    },
    {
      name: 'only-main-loads-testing',
      severity: 'error',
      comment:
        'The test API is wired in by main.ts behind __TEST_API__ so it is tree-shaken from prod.',
      from: { path: '^src/', pathNot: '^src/testing/|^src/main\\.ts$' },
      to: { path: '^src/testing/' },
    },
    {
      name: 'only-main-loads-app',
      severity: 'error',
      comment:
        'src/app is the composition root: it may import core, input, render and ui, and only main.ts boots it.',
      from: { path: '^src/', pathNot: '^src/app/|^src/main\\.ts$' },
      to: { path: '^src/app/' },
    },
    {
      name: 'nothing-imports-main',
      severity: 'error',
      from: {},
      to: { path: '^src/main\\.ts$' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment: 'Shipped code may not import devDependencies.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
  },
};
