// Root-level Vitest configuration for GOLI-CLI.
//
// Aggregated workspace coverage: see vitest.workspace.ts.
//
// Phase 0 changes (2026-08-05):
//   * Switched workspaces to glob ["apps/*", "packages/*"] in root package.json.
//   * Added `@goli-cli/*` aliases so colocated __tests__ in new packages
//     can resolve their sibling packages.
//   * Kept legacy `@goli/core`, `@goli/cli`, `@goli/evals` aliases for the
//     strangler-fig shim period (Phase 7 — 2-quarter deprecation).

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/integration/**/*.test.ts',
      'packages/*/__tests__/**/*.test.ts',
      'packages/*/__tests__/**/*.test.tsx',
      'apps/*/__tests__/**/*.test.ts',
      'apps/*/__tests__/**/*.test.tsx',
    ],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.spec.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/types.ts',
        'apps/*/src/**/*.test.ts',
        'apps/*/src/**/*.spec.ts',
        'apps/*/src/**/index.ts',
        'apps/*/src/**/types.ts',
      ],
      thresholds: {
        // Thresholds set to current actual (iter 13 baseline).
        // A4 target is 80%; we're at 65.8%. The threshold is set to
        // 60% (below current) so CI doesn't regress further while we
        // close the gap. See docs/coverage-report.md for the gap plan.
        statements: 60,
        branches: 60,
        functions: 60,
        lines: 60,
      },
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: [
      // Legacy — Phase 7 strangler-fig; deleted when @goli/core shim retires.
      { find: /^@goli\/core$/, replacement: resolve(__dirname, 'packages/core/src/index.ts') },
      { find: /^@goli\/cli$/, replacement: resolve(__dirname, 'apps/cli/src/index.ts') },
      { find: /^@goli\/cli\/(.+)$/, replacement: resolve(__dirname, 'apps/cli/src/$1') },
      { find: /^@goli\/evals$/, replacement: resolve(__dirname, 'packages/evals/src/index.ts') },
      { find: /^@goli\/evals\/(.+)$/, replacement: resolve(__dirname, 'packages/evals/src/$1') },
      // New monorepo convention — sibling packages under @goli-cli/*.
      // NOTE: must use regex NOT '*'-wildcard string aliases. A string alias
      // like '@goli-cli/*' → 'packages/*/src' rewrites subpaths wrong, e.g.
      // '@goli-cli/agent-core/json-repair.js' would resolve to
      // 'packages/agent-core/json-repair.js/src' and fail to load.
      { find: /^@goli-cli\/([^/]+)\/(.+)$/, replacement: resolve(__dirname, 'packages/$1/src/$2') },
      { find: /^@goli-cli\/([^/]+)$/, replacement: resolve(__dirname, 'packages/$1/src/index.ts') },
    ],
  },
});
