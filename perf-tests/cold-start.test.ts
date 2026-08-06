/**
 * T-030 — CLI cold-start regression test.
 *
 * Measures how long the built CLI takes to spawn and print `--version`
 * (median of 3 wall-clock runs), then compares against
 * `perf-tests/baselines/cold-start.json` via {@link PerfTestHarness}.
 *
 * The test is **skipped if the CLI bundle isn't built** (`apps/cli/dist/index.js`
 * is absent), so a fresh clone can still run the perf suite. Run
 * `npm run build` first, or seed/refresh the baseline with
 * `npm run test:perf:update`.
 *
 * Direction: lower-is-better. Only a >tolerance SLOW-DOWN fails (a faster
 * machine still passes).
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PerfTestHarness } from '@goli-cli/test-utils';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL('../apps/cli/dist/index.js', import.meta.url));
const BASELINE = 'perf-tests/baselines/cold-start.json';
const UPDATE = process.env.GOLI_UPDATE_BASELINES === '1';

describe.skipIf(!existsSync(CLI_ENTRY))('CLI cold start (T-030)', () => {
  it('`--version` cold start stays within baseline tolerance', () => {
    const harness = new PerfTestHarness(BASELINE);
    harness.measureMedian(
      'cli_version_cold_start_ms',
      () => {
        const run = spawnSync(process.execPath, [CLI_ENTRY, '--version'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30_000,
        });
        if (run.status !== 0) {
          throw new Error(
            `cli --version failed (status ${run.status}): ${run.stderr}`,
          );
        }
      },
      3,
    );

    if (!UPDATE) {
      expect(harness.hasBaseline('cli_version_cold_start_ms')).toBe(true);
    }
    if (UPDATE) {
      harness.updateBaseline();
    } else {
      harness.assertAll();
    }
  });
});