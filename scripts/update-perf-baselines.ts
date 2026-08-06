/**
 * scripts/update-perf-baselines.ts
 *
 * T-030: re-seeds the committed perf/memory baselines with current-machine
 * numbers. Runs every perf/memory test with `GOLI_UPDATE_BASELINES=1`, which
 * makes the tests write their measurements back to `perf-tests/baselines/*.json`
 * and `memory-tests/baselines/*.json` (via `PerfTestHarness.updateBaseline()`)
 * instead of asserting against them.
 *
 * Usage:
 *   npx tsx scripts/update-perf-baselines.ts
 *   # or: npm run test:perf:update
 *
 * After reseeding, verify the gate still holds with:
 *   npm run test:perf && npm run test:memory
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const VITEST_CLI = resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

function main(): void {
  const targets = ['perf-tests/', 'memory-tests/'];
  process.env.GOLI_UPDATE_BASELINES = '1';

  const result = spawnSync(
    process.execPath,
    [VITEST_CLI, 'run', '--config', 'vitest.perf.config.ts', ...targets],
    { cwd: REPO_ROOT, stdio: 'inherit', env: process.env },
  );

  if (result.status !== 0) {
    console.error(`✗ Baseline update failed (exit ${result.status}). No baselines were guaranteed written.`);
    process.exit(result.status ?? 1);
  }

  console.log('✓ Baselines re-seeded. Re-run `npm run test:perf` and `npm run test:memory` to verify the gate.');
}

main();
