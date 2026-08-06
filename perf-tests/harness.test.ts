/**
 * Deterministic unit tests for {@link PerfTestHarness} (T-030).
 *
 * These use a fixed fixture baseline (`fixtures/baseline-fixture.json`) and
 * manually recorded values — no wall-clock measurement — so they are fast and
 * reproducible on any machine. The regression direction is **lower-is-better**:
 * a measurement ABOVE `baseline * (1 + tolerance)` is a regression; a faster
 * (smaller) measurement passes.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PerfRegressionError,
  PerfTestHarness,
} from '@goli-cli/test-utils';

const FIXTURE = 'perf-tests/fixtures/baseline-fixture.json';

describe('PerfTestHarness (T-030)', () => {
  it('loads a baseline file and reports known metrics', () => {
    const h = new PerfTestHarness(FIXTURE);
    expect(h.hasBaseline('fast_fn_ms')).toBe(true);
    expect(h.baselineOf('fast_fn_ms')?.value).toBe(5);
    expect(h.hasBaseline('does_not_exist')).toBe(false);
    expect(h.baselineOf('does_not_exist')).toBeNull();
  });

  it('passes when measured == baseline (within tolerance)', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('ok_fn_ms', 10);
    const [r] = h.checkAll();
    expect(r.status).toBe('pass');
    expect(r.deltaPct).toBe(0);
  });

  it('passes when measured is FASTER than baseline (lower is better)', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('ok_fn_ms', 7);
    const [r] = h.checkAll();
    expect(r.status).toBe('pass');
    expect(r.deltaPct).toBe(-30);
  });

  it('regresses only when measured exceeds baseline * (1 + tolerance)', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('ok_fn_ms', 11); // 11 <= 10 * 1.15 = 11.5 → pass
    const [pass] = h.checkAll();
    expect(pass.status).toBe('pass');

    const h2 = new PerfTestHarness(FIXTURE);
    h2.record('ok_fn_ms', 12); // 12 > 11.5 → regressed (+20%)
    const [fail] = h2.checkAll();
    expect(fail.status).toBe('regressed');
    expect(fail.deltaPct).toBe(20);
  });

  it('honors per-metric tolerance overrides', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('strict_fn_ms', 10.4); // 5% tol → 10.5 ceiling → pass
    const [r] = h.checkAll();
    expect(r.tolerance).toBe(0.05);
    expect(r.status).toBe('pass');
  });

  it('flags metrics that were measured but have no baseline entry', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('brand_new_metric_ms', 42);
    const [r] = h.checkAll();
    expect(r.status).toBe('no-baseline');
    expect(r.baseline).toBeNull();
  });

  it('assertAll throws PerfRegressionError carrying check results on regression', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('ok_fn_ms', 12); // regressed
    h.record('fast_fn_ms', 4); // pass
    expect(() => h.assertAll()).toThrow(PerfRegressionError);
    try {
      h.assertAll();
    } catch (err) {
      const e = err as PerfRegressionError;
      expect(e.results.length).toBe(2);
      expect(e.results.find((r) => r.name === 'ok_fn_ms')?.status).toBe(
        'regressed',
      );
    }
  });

  it('assertAll passes when every recorded metric is within tolerance', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('ok_fn_ms', 10);
    h.record('fast_fn_ms', 3);
    const results = h.assertAll();
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('assertAll throws a plain error when nothing was measured', () => {
    const h = new PerfTestHarness(FIXTURE);
    expect(() => h.assertAll()).toThrow(/zero recorded measurements/);
  });

  it('respects a global default tolerance option on bare metrics', () => {
    const h = new PerfTestHarness(FIXTURE, { tolerance: 0.2 });
    h.record('bare_ms', 12); // no explicit tol → global 0.2 → 12 <= 12 → pass
    expect(h.checkAll()[0]!.status).toBe('pass');

    const h2 = new PerfTestHarness(FIXTURE); // default 0.15 → 12 > 11.5 → regressed
    h2.record('bare_ms', 12);
    expect(h2.checkAll()[0]!.status).toBe('regressed');
  });

  it('informational probes (huge tolerance) tolerate large fluctuation', () => {
    const h = new PerfTestHarness(FIXTURE);
    h.record('informational_ms', 60_000); // 600x baseline, still < 100*1001 ceiling
    expect(h.checkAll()[0]!.status).toBe('pass');
  });

  it('measure/measureAsync record elapsed time and stay comparable', async () => {
    const h = new PerfTestHarness(FIXTURE);
    const sync = h.measure('fast_fn_ms', () => {
      const start = Date.now();
      while (Date.now() - start < 1) {
        /* busy-wait for a sub-ms tick */
      }
    });
    expect(typeof sync).toBe('number');
    expect(h.hasMeasurements).toBe(true);

    const h2 = new PerfTestHarness(FIXTURE);
    const value = await h2.measureAsync('fast_fn_ms', async () => {
      await Promise.resolve();
    });
    expect(typeof value).toBe('number');
    // Elapsed is near-zero (faster than the 5ms baseline) → pass.
    expect(h2.checkAll()[0]!.status).toBe('pass');
  });

  it('updateBaseline rewrites metrics (merging _meta) and can be re-read', () => {
    const out = join(tmpdir(), `perf-harness-${Date.now()}-${Math.random()}.json`);
    try {
      const h = new PerfTestHarness(FIXTURE);
      h.record('ok_fn_ms', 11);
      h.record('new_measured_ms', 7);
      h.updateBaseline(out);

      const raw = JSON.parse(readFileSync(out, 'utf8')) as {
        _meta?: { description?: string };
        metrics: Record<string, { value: number; unit?: string }>;
      };
      expect(raw._meta?.description).toContain('fixture');
      expect(raw.metrics.ok_fn_ms?.value).toBe(11); // remeasured
      expect(raw.metrics.new_measured_ms?.value).toBe(7); // added
      expect(raw.metrics.strict_fn_ms?.value).toBe(10); // untouched entry preserved

      const reloaded = new PerfTestHarness(out);
      expect(reloaded.baselineOf('ok_fn_ms')?.value).toBe(11);
    } finally {
      if (existsSync(out)) unlinkSync(out);
    }
  });

  it('requires the baseline file to exist', () => {
    expect(() => new PerfTestHarness('perf-tests/fixtures/missing.json')).toThrow();
  });
});