// Vitest configuration for GOLI-CLI e2e tests.
//
// E2E tests spawn the built CLI binary (`dist/cli/main.js`) and exercise
// end-to-end flows: real API calls (mocked at the HTTP layer via msw,
// or pointed at a real self-hosted endpoint via GOLI_E2E_ENDPOINT env),
// real sandbox execution, real file I/O, real TUI rendering.

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 120_000, // 2 minutes — e2e is slow
    hookTimeout: 60_000,
    reporters: ['default'],
    // E2E tests must run serially to avoid sandbox / port conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: false,
      },
    },
  },
  resolve: {
    alias: {
      '#agent': resolve(__dirname, 'src/agent'),
      '#context': resolve(__dirname, 'src/context'),
      '#tools': resolve(__dirname, 'src/tools'),
      '#sandbox': resolve(__dirname, 'src/sandbox'),
      '#memory': resolve(__dirname, 'src/memory'),
      '#evals': resolve(__dirname, 'src/evals'),
      '#orchestration': resolve(__dirname, 'src/orchestration'),
      '#tui': resolve(__dirname, 'src/tui'),
      '#config': resolve(__dirname, 'src/config'),
      '#utils': resolve(__dirname, 'src/utils'),
    },
  },
});
