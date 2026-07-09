/**
 * Goli-CLI benchmark script.
 *
 * Captures cold-start, build, typecheck, lint, and test-suite timings
 * into bench/baseline.json. Re-runnable: `npm run bench`.
 *
 * Metrics captured (median of 5 runs unless noted):
 *   - goli_version_cold_start_ms (A1 target: < 200ms)
 *   - goli_help_cold_start_ms    (A1 target: < 200ms)
 *   - build_time_seconds         (single run)
 *   - typecheck_time_seconds     (single run)
 *   - lint_time_seconds          (single run)
 *   - test_suite_time_seconds    (single run)
 *   - bundle_size_kb             (size of packages/cli/dist/index.js)
 *
 * Usage:
 *   node scripts/bench.ts                # run all benchmarks
 *   node scripts/bench.ts --quick        # only cold-start (skip build/test)
 *
 * @module scripts/bench
 */

import { execSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { timeMs, median } from './bench-utils.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CLI_BIN = resolve(REPO_ROOT, 'packages/cli/dist/index.js');
const BENCH_FILE = resolve(REPO_ROOT, 'bench/baseline.json');
const RUNS = 5;

interface Metric {
  value: number;
  unit: 'ms' | 'seconds' | 'kb';
  note?: string;
  samples?: number[];
}

interface BenchResult {
  captured_at: string;
  metrics: {
    goli_version_cold_start_ms: Metric;
    goli_help_cold_start_ms: Metric;
    build_time_seconds: Metric;
    typecheck_time_seconds: Metric;
    lint_time_seconds: Metric;
    test_suite_time_seconds: Metric;
    bundle_size_kb: Metric;
  };
}

function measureColdStart(args: string[], runs: number = RUNS): { median: number; samples: number[] } {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const ms = timeMs(() => {
      execSync(`node "${CLI_BIN}" ${args.join(' ')}`, {
        stdio: 'ignore',
        cwd: REPO_ROOT,
      });
    });
    samples.push(Math.round(ms));
  }
  return { median: Math.round(median(samples)), samples };
}

function measureSeconds(cmd: string): number {
  const ms = timeMs(() => {
    try {
      execSync(cmd, { stdio: 'ignore', cwd: REPO_ROOT });
    } catch (err) {
      // Some commands (notably `npm run lint`) exit non-zero even when
      // there are only warnings. For benchmark purposes we only care
      // about wall-clock time, not exit code — swallow the error.
      if (!(err instanceof Error) || !('status' in err)) {
        throw err;
      }
      // Re-throw if the process was killed by a signal (e.g. OOM).
      const e = err as unknown as SpawnSyncReturns<Buffer>;
      if (e.signal) throw err;
    }
  });
  return Math.round((ms / 1000) * 10) / 10; // 1 decimal place
}

function bundleSizeKb(): number {
  try {
    const stat = statSync(CLI_BIN);
    return Math.round((stat.size / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

function main(): void {
  const quick = process.argv.includes('--quick');
  const result: BenchResult = {
    captured_at: new Date().toISOString(),
    metrics: {} as BenchResult['metrics'],
  };

  console.log('▶ goli --version cold-start (5 runs)...');
  const versionMs = measureColdStart(['--version']);
  console.log(`  samples: ${versionMs.samples.join(', ')} ms`);
  console.log(`  median: ${versionMs.median} ms (A1 target: < 200ms)`);
  result.metrics.goli_version_cold_start_ms = {
    value: versionMs.median,
    unit: 'ms',
    note: 'A1 target: < 200ms',
    samples: versionMs.samples,
  };

  console.log('▶ goli --help cold-start (5 runs)...');
  const helpMs = measureColdStart(['--help']);
  console.log(`  samples: ${helpMs.samples.join(', ')} ms`);
  console.log(`  median: ${helpMs.median} ms (A1 target: < 200ms)`);
  result.metrics.goli_help_cold_start_ms = {
    value: helpMs.median,
    unit: 'ms',
    note: 'A1 target: < 200ms',
    samples: helpMs.samples,
  };

  console.log(`▶ bundle size: ${bundleSizeKb()} KB (packages/cli/dist/index.js)`);
  result.metrics.bundle_size_kb = {
    value: bundleSizeKb(),
    unit: 'kb',
    note: 'Size of the compiled CLI entry point.',
  };

  if (quick) {
    console.log('\n--quick mode: skipping build/typecheck/lint/test.');
  } else {
    console.log('▶ npm run build (1 run)...');
    const buildS = measureSeconds('npm run build');
    console.log(`  ${buildS}s`);
    result.metrics.build_time_seconds = { value: buildS, unit: 'seconds' };

    console.log('▶ npm run typecheck (1 run)...');
    const tcS = measureSeconds('npm run typecheck');
    console.log(`  ${tcS}s`);
    result.metrics.typecheck_time_seconds = { value: tcS, unit: 'seconds' };

    console.log('▶ npm run lint (1 run)...');
    const lintS = measureSeconds('npm run lint');
    console.log(`  ${lintS}s`);
    result.metrics.lint_time_seconds = { value: lintS, unit: 'seconds' };

    console.log('▶ npm test (1 run)...');
    const testS = measureSeconds('npm test');
    console.log(`  ${testS}s`);
    result.metrics.test_suite_time_seconds = { value: testS, unit: 'seconds' };
  }

  // Merge into baseline.json
  let baseline: Record<string, unknown> = {};
  try {
    baseline = JSON.parse(readFileSync(BENCH_FILE, 'utf-8'));
  } catch {
    // File doesn't exist yet — start fresh.
  }
  const metrics = (baseline['metrics'] as Record<string, Metric>) ?? {};
  for (const [k, v] of Object.entries(result.metrics)) {
    if (v) metrics[k] = v;
  }
  baseline['metrics'] = metrics;
  baseline['last_captured_at'] = result.captured_at;
  baseline['history'] = [
    ...((baseline['history'] as unknown[]) ?? []),
    {
      timestamp: result.captured_at,
      goli_version_cold_start_ms: result.metrics.goli_version_cold_start_ms?.value,
      goli_help_cold_start_ms: result.metrics.goli_help_cold_start_ms?.value,
      build_time_seconds: result.metrics.build_time_seconds?.value,
      test_suite_time_seconds: result.metrics.test_suite_time_seconds?.value,
    },
  ];
  writeFileSync(BENCH_FILE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`\n✓ bench/baseline.json updated.`);
}

main();
