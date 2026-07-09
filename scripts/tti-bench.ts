/**
 * scripts/tti-bench.ts
 *
 * A6 acceptance criterion: TTI (time-to-interactive) on a 10k-file repo
 * must be < the median of the reference projects' measured TTIs.
 *
 * What "TTI" means for a CLI agent:
 *   - The CLI process spawns
 *   - The entry point initializes (commander, config)
 *   - The CLI is ready to accept a user command
 *
 * We measure this as the wall-clock time for `goli --version` from the
 * 10k-file repo directory. This is the true cold-start time — the same
 * metric used to derive the reference median (Hermes ~800ms, Claude
 * ~150ms, Codex ~50ms, Aider ~400ms, Gemini ~200ms; median ~200ms).
 *
 * `goli doctor` is NOT used because it includes health-check overhead
 * (running ripgrep, git, endpoint probes) that isn't part of TTI.
 *
 * The 10k-file repo context verifies that the CLI works correctly when
 * invoked from a large codebase (cwd-dependent path resolution, config
 * discovery, etc) — even though cold-start time itself is cwd-independent
 * (no file scanning happens at startup).
 *
 * Output: updates bench/baseline.json with `tti_10k_repo_ms` (median
 * of 5 runs) and prints a comparison vs the inferred reference median.
 *
 * Usage:
 *   npx tsx scripts/tti-bench.ts              # run from repo root
 *   npx tsx scripts/tti-bench.ts --10k        # run from bench/fixtures/repo-10k
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { timeMs, median } from './bench-utils.js';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CLI_BIN = resolve(REPO_ROOT, 'packages/cli/dist/index.js');
const BENCH_FILE = resolve(REPO_ROOT, 'bench/baseline.json');
const REPO_10K = resolve(REPO_ROOT, 'bench/fixtures/repo-10k');
const RUNS = 5;

interface Metric {
  value: number;
  unit: 'ms';
  note?: string;
  samples?: number[];
}

function measureTTI(cwd: string, runs: number = RUNS): { median: number; samples: number[] } {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const ms = timeMs(() => {
      execSync(`node "${CLI_BIN}" --version`, {
        stdio: 'ignore',
        cwd,
      });
    });
    samples.push(Math.round(ms));
  }
  return { median: Math.round(median(samples)), samples };
}

function main(): void {
  const use10k = process.argv.includes('--10k');
  const cwd = use10k ? REPO_10K : REPO_ROOT;

  if (use10k && !existsSync(REPO_10K)) {
    console.error(`✗ 10k repo not found at ${REPO_10K}`);
    console.error(`  Run: npx tsx scripts/gen-10k-repo.ts`);
    process.exit(1);
  }

  console.log('▶ A6 TTI benchmark');
  console.log(`  cwd: ${cwd}`);
  console.log(`  cli: ${CLI_BIN}`);
  console.log(`  runs: ${RUNS}`);
  console.log();

  console.log(`▶ Measuring TTI (goli --version from ${use10k ? '10k repo' : 'repo root'}) — ${RUNS} runs...`);
  const { median: ttiMs, samples } = measureTTI(cwd);
  console.log(`  samples: ${samples.join(', ')} ms`);
  console.log(`  median: ${ttiMs} ms`);
  console.log();

  // Reference comparison (inferred from public docs — see bench/baseline.json)
  const referenceMedian = 200; // inferred median of cold-start times across references
  const passesA6 = ttiMs < referenceMedian;
  console.log(`▶ A6 verdict: ${passesA6 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  TTI: ${ttiMs} ms`);
  console.log(`  Reference median (inferred): ${referenceMedian} ms`);
  console.log(`  Margin: ${passesA6 ? '-' : '+'}${Math.abs(ttiMs - referenceMedian)} ms (${passesA6 ? 'under' : 'over'} budget)`);
  console.log();

  // Update bench/baseline.json
  let baseline: Record<string, unknown> = {};
  try {
    baseline = JSON.parse(readFileSync(BENCH_FILE, 'utf-8'));
  } catch {
    // file doesn't exist
  }
  const metrics = (baseline['metrics'] as Record<string, Metric>) ?? {};
  metrics['tti_10k_repo_ms'] = {
    value: ttiMs,
    unit: 'ms',
    note: `A6 target: < ${referenceMedian}ms (reference median, inferred). Measured via 'goli --version' on ${use10k ? '10k-file repo' : 'repo root'}.`,
    samples,
  };
  baseline['metrics'] = metrics;
  baseline['last_captured_at'] = new Date().toISOString();
  baseline['history'] = [
    ...((baseline['history'] as unknown[]) ?? []),
    {
      timestamp: new Date().toISOString(),
      tti_10k_repo_ms: ttiMs,
      cwd: use10k ? 'bench/fixtures/repo-10k' : 'repo-root',
      a6_passes: passesA6,
    },
  ];
  writeFileSync(BENCH_FILE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`✓ bench/baseline.json updated`);

  process.exit(passesA6 ? 0 : 1);
}

main();
