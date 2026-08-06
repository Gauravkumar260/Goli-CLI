/**
 * Vitest config for the T-030 perf/memory gate.
 *
 * Runs ONLY the `perf-tests/` and `memory-tests/` directories (a dedicated
 * config keeps noisy wall-clock/heap tests out of the 4498-case main suite,
 * which uses `vitest.config.ts`). Extends the root config so aliases, setup
 * files and coverage rules stay in sync.
 *
 * Memory tests need a real GC between heap snapshots, so worker threads are
 * launched with `--expose-gc` (see `poolOptions.threads.execArgv`). The
 * `test:memory` npm script additionally starts the launcher with
 * `node --expose-gc` so `global.gc` is defined in both places.
 *
 * @see scripts/update-perf-baselines.ts
 */

import { mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, {
  test: {
    // Replace the base include (perf/memory dirs are NOT part of `npm test`).
    include: [
      'perf-tests/**/*.test.ts',
      'perf-tests/**/*.test.tsx',
      'memory-tests/**/*.test.ts',
    ],
    // Perf measurements are slower than unit tests; allow generous time.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    poolOptions: {
      threads: {
        execArgv: ['--expose-gc'],
      },
    },
  },
});
