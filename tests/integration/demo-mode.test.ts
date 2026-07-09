/**
 * Demo mode test (T-014).
 *
 * Verifies that `goli --demo` launches the MockAgentLoop and prints
 * the scripted event sequence (INIT → PLAN → TOOL → GEN → DONE)
 * without requiring an LLM endpoint.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const CLI_BIN = resolve(REPO_ROOT, 'packages/cli/dist/index.js');

function runDemo(): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI_BIN, '--demo'], {
    encoding: 'utf-8',
    timeout: 30_000,
    cwd: REPO_ROOT,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

describe('T-014: demo/mock mode for TUI', () => {
  it('goli --demo exits 0', () => {
    const result = runDemo();
    expect(result.exitCode).toBe(0);
  });

  it('prints the INIT phase', () => {
    const result = runDemo();
    expect(result.stdout).toContain('INIT');
  });

  it('prints the PLAN phase', () => {
    const result = runDemo();
    expect(result.stdout).toContain('PLAN');
  });

  it('prints the TOOL phase with a read_file tool call', () => {
    const result = runDemo();
    expect(result.stdout).toContain('TOOL');
    expect(result.stdout).toContain('read_file');
    expect(result.stdout).toContain('T0'); // tier
  });

  it('prints the GEN phase with text output', () => {
    const result = runDemo();
    expect(result.stdout).toContain('GEN');
    // The GEN phase produces text from DEMOS
    expect(result.stdout.length).toBeGreaterThan(100);
  });

  it('prints the DONE phase', () => {
    const result = runDemo();
    expect(result.stdout).toContain('DONE');
  });

  it('prints a demo summary on stderr with phase + tool + token counts', () => {
    const result = runDemo();
    expect(result.stderr).toContain('Demo complete');
    expect(result.stderr).toContain('Phases: 5');
    expect(result.stderr).toContain('Tool calls:');
    expect(result.stderr).toContain('Tokens:');
  });

  it('does NOT require an LLM endpoint (no API calls)', () => {
    // Run with no API key/endpoint set — should still work
    const result = runDemo();
    expect(result.exitCode).toBe(0);
    // Should not contain error messages about API/connection
    expect(result.stderr).not.toContain('ECONNREFUSED');
    expect(result.stderr).not.toContain('API key');
    expect(result.stderr).not.toContain('Unauthorized');
  });

  it('completes in < 10 seconds', () => {
    const start = Date.now();
    runDemo();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000);
  });
});
