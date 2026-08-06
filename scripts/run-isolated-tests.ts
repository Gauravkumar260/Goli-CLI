/**
 * scripts/run-isolated-tests.ts
 *
 * T-026 — subprocess-per-test isolation for hermetic test runs.
 *
 * Each test file runs in its OWN fresh `node` subprocess (a new vitest
 * process). This guarantees that process-global state (env vars, timers,
 * `process.exit`, module caches, working directory) from one test file can
 * never leak into another — the property that makes a suite flake-free.
 *
 * Design (mirrors hermes-agent's subprocess-per-test isolation):
 *   - 1 subprocess = 1 test file = 1 vitest `run` invocation.
 *   - Hard per-file timeout (default 30s) — a hung file is killed, not waited
 *     on, so one stall can't block the whole suite.
 *   - Bounded worker pool (xdist-style parallelism, default min(cores, 8)) —
 *     no fork-bomb: at most `--workers N` children exist at any instant.
 *   - `--serial` runs one file at a time (for debugging order dependence).
 *
 * Usage:
 *   npx tsx scripts/run-isolated-tests.ts            # full suite, pooled
 *   npx tsx scripts/run-isolated-tests.ts --filter foo # only files matching 'foo'
 *   npx tsx scripts/run-isolated-tests.ts --serial   # 1 file at a time
 *   npx tsx scripts/run-isolated-tests.ts --list     # just print the file list
 *   npx tsx scripts/run-isolated-tests.ts --workers 8 --timeout 60
 *
 * Exit codes: 0 = every file passed; 1 = at least one file failed/timed-out.
 */

import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const VITEST_CLI = resolve(REPO_ROOT, 'node_modules/vitest/vitest.mjs');

// ─── CLI flags ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(name);

const workers = Number(flag('--workers') ?? '0') || Math.min(cpus().length, 8);
const timeoutSeconds = Number(flag('--timeout') ?? '30') || 30;
const filter = flag('--filter') ?? '';
const listOnly = has('--list');
const serial = has('--serial');

// ─── Test-file discovery (mirrors vitest.config.ts include) ─────────────

const TEST_GLOB_EXTENSIONS = ['.test.ts', '.test.tsx'];

function walk(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (
      entry.isFile() &&
      TEST_GLOB_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
    ) {
      out.push(relative(REPO_ROOT, full).replaceAll('\\', '/'));
    }
  }
}

function discoverTestFiles(): string[] {
  const roots: string[] = ['tests/integration'];
  for (const pkgDir of ['packages', 'apps']) {
    const base = resolve(REPO_ROOT, pkgDir);
    if (!statSync(base, { throwIfNoEntry: false })) continue;
    for (const child of readdirSync(base)) {
      const testsDir = join(base, child, '__tests__');
      if (statSync(testsDir, { throwIfNoEntry: false })?.isDirectory()) {
        roots.push(relative(REPO_ROOT, testsDir));
      }
    }
  }

  const files: string[] = [];
  for (const root of roots) {
    const abs = resolve(REPO_ROOT, root);
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      walk(abs, files);
    }
  }
  return files
    .filter((f) => !f.includes('node_modules') && !f.includes('dist/'))
    .sort();
}

const allFiles = discoverTestFiles();
const files = filter ? allFiles.filter((f) => f.includes(filter)) : allFiles;

if (listOnly) {
  console.log(files.map((f) => `  ${f}`).join('\n'));
  console.log(`\n${files.length} test files discovered`);
  process.exit(0);
}

if (files.length === 0) {
  console.error(`No test files found${filter ? ` matching '${filter}'` : ''}.`);
  process.exit(1);
}

// ─── Per-file subprocess runner with hard timeout ───────────────────────

interface FileResult {
  file: string;
  status: 'pass' | 'fail' | 'timeout';
  durationMs: number;
  passed: number;
  failed: number;
  output: string;
  error: string;
}

function runFile(file: string): Promise<FileResult> {
  return new Promise((resolvePromise) => {
    const startedAt = performance.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;

    const child = spawn(
      process.execPath,
      [VITEST_CLI, 'run', file, '--config', 'vitest.config.ts', '--no-color'],
      {
        cwd: REPO_ROOT,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < 64_000) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 32_000) stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      killed = true;
      child.kill();
      // Give the process a moment to die; force-kill if it lingers.
      setTimeout(() => {
        if (killed) child.kill('SIGKILL');
      }, 2_000).unref();
    }, timeoutSeconds * 1000);
    timeout.unref();

    child.on('error', (err) => {
      clearTimeout(timeout);
      const elapsed = performance.now() - startedAt;
      resolvePromise({
        file,
        status: 'fail',
        durationMs: elapsed,
        passed: 0,
        failed: 1,
        output: stdout,
        error: `spawn error: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      killed = false;
      const elapsed = performance.now() - startedAt;
      if (timedOut) {
        resolvePromise({
          file,
          status: 'timeout',
          durationMs: elapsed,
          passed: 0,
          failed: 1,
          output: stdout,
          error: `Timed out after ${timeoutSeconds}s — killed.`,
        });
        return;
      }
      const passMatch = stdout.match(/\bTests\s+(\d+)\s+passed/);
      const failMatch = stdout.match(/\bTests\s+(\d+)\s+failed/);
      const passed = passMatch ? Number(passMatch[1]) : 0;
      const failed = failMatch ? Number(failMatch[1]) : 0;
      resolvePromise({
        file,
        status: code === 0 && failed === 0 ? 'pass' : 'fail',
        durationMs: elapsed,
        passed,
        failed,
        output: stdout,
        error: code === 0 ? '' : `vitest exited with code ${code}.`,
      });
    });
  });
}

// ─── Bounded worker pool (xdist-style, no fork-bomb) ────────────────────

async function main(): Promise<void> {
  console.log(
    `T-026 isolated run: ${files.length} files, ${serial ? 'serial' : `${workers} workers`}, ` +
      `${timeoutSeconds}s/file timeout\n`,
  );

  const poolSize = serial ? 1 : workers;
  const results: FileResult[] = [];
  let next = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  const startedAt = performance.now();

  async function worker(): Promise<void> {
    while (next < files.length) {
      const file = files[next]!;
      next += 1;
      const result = await runFile(file);
      results.push(result);
      totalPassed += result.passed;
      totalFailed += result.failed;
      if (result.status === 'pass') {
        console.log(
          `  ✓ ${file} (${result.durationMs.toFixed(0)}ms, ${result.passed} tests)`,
        );
      } else {
        console.log(
          `  ✗ ${file} (${result.durationMs.toFixed(0)}ms) — ${result.status}${result.error ? `: ${result.error}` : ''}`,
        );
      }
    }
  }

  const runners = Array.from({ length: poolSize }, () => worker());
  await Promise.all(runners);

  const elapsed = (performance.now() - startedAt) / 1000;
  const failures = results.filter((r) => r.status !== 'pass');
  const timeoutCount = failures.filter((r) => r.status === 'timeout').length;

  console.log(
    `\n${results.length} files, ${totalPassed} tests passed, ${totalFailed} failed` +
      `${timeoutCount > 0 ? ` (${timeoutCount} timed out)` : ''} ` +
      `in ${elapsed.toFixed(1)}s (${serial ? 'serial' : `${poolSize} workers`})`,
  );

  if (failures.length > 0) {
    console.log(`\n${failures.length} file(s) failed:\n`);
    for (const r of failures) {
      console.log(`——— ${r.file} [${r.status}] ———`);
      if (r.error) console.log(r.error);
      const tail = r.output.split('\n').slice(-25).join('\n');
      if (tail.trim()) console.log(tail);
      console.log('');
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
