/**
 * T-030 — core module-load cost regression test.
 *
 * Measures the wall-clock time of the FIRST dynamic `import('@goli-cli/agent-core')`
 * within a fresh vitest worker (i.e. the real module-graph load cost, not the
 * cached re-import), and compares against `perf-tests/baselines/module-load.json`.
 *
 * Direction: lower-is-better. Only a >tolerance SLOW-DOWN fails.
 */
import { describe, expect, it } from 'vitest';
import { PerfTestHarness } from '@goli-cli/test-utils';

const BASELINE = 'perf-tests/baselines/module-load.json';
const UPDATE = process.env.GOLI_UPDATE_BASELINES === '1';

describe('core module load cost (T-030)', () => {
  it('first dynamic import of @goli-cli/agent-core stays within baseline', async () => {
    const harness = new PerfTestHarness(BASELINE);

    const value = await harness.measureAsync(
      'core_index_dynamic_import_ms',
      async () => {
        await import('@goli-cli/agent-core');
      },
    );
    expect(value).toBeGreaterThan(0);

    if (!UPDATE) {
      expect(harness.hasBaseline('core_index_dynamic_import_ms')).toBe(true);
    }
    if (UPDATE) {
      harness.updateBaseline();
    } else {
      harness.assertAll();
    }
  });
});