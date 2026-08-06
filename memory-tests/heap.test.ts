/**
 * T-030 — core module heap-footprint regression test.
 *
 * Measures the heap delta (bytes) of loading the `@goli/core` brain index in a
 * fresh worker: `global.gc()` → snapshot heap → dynamic import → `global.gc()`
 * → snapshot heap. Compares against `memory-tests/baselines/core-heap.json`.
 *
 * `global.gc` is available because the perf config launches worker threads
 * with `--expose-gc` (see `vitest.perf.config.ts`); a `GOLI_UPDATE_BASELINES=1`
 * run re-seeds the baseline instead of asserting.
 *
 * Direction: lower-is-better. A NEGATIVE delta (GC reclaimed more than the
 * import allocated) trivially passes.
 */
import { describe, expect, it } from 'vitest';
import { PerfTestHarness } from '@goli-cli/test-utils';

const BASELINE = 'memory-tests/baselines/core-heap.json';
const UPDATE = process.env.GOLI_UPDATE_BASELINES === '1';
const gc = (globalThis as { gc?: () => void }).gc;

describe('core module heap footprint (T-030)', () => {
  it('loading @goli/core adds a bounded heap delta', async () => {
    const harness = new PerfTestHarness(BASELINE);

    gc?.();
    const before = process.memoryUsage().heapUsed;
    await import('@goli/core');
    gc?.();
    const after = process.memoryUsage().heapUsed;
    const deltaBytes = after - before;

    harness.record('core_load_heap_delta_bytes', deltaBytes, 'bytes');

    if (!UPDATE) {
      expect(harness.hasBaseline('core_load_heap_delta_bytes')).toBe(true);
    }
    if (UPDATE) {
      harness.updateBaseline();
    } else {
      harness.assertAll();
    }
  });
});