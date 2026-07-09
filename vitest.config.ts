// Root-level Vitest configuration for GOLI-CLI.
//
// The monorepo uses vitest.workspace.ts for multi-package discovery,
// but this root config provides the shared defaults (alias, setup, etc.).

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.spec.ts',
        'packages/*/src/**/index.ts',
        'packages/*/src/**/types.ts',
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
    alias: {
      '@goli/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@goli/core/*': resolve(__dirname, 'packages/core/src/*'),
      '@goli/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@goli/cli/*': resolve(__dirname, 'packages/cli/src/*'),
      '@goli/evals': resolve(__dirname, 'packages/evals/src/index.ts'),
      '@goli/evals/*': resolve(__dirname, 'packages/evals/src/*'),
    },
  },
});
