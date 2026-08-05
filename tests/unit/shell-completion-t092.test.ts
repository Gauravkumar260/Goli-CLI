/**
 * Tests for T-092: ! shell Tab completion.
 *
 * Covers:
 *   - getShellCompletions() returns common binaries for empty partial
 *   - getShellCompletions() filters binaries by prefix
 *   - getShellCompletions() returns git subcommands after "git "
 *   - getShellCompletions() returns npm subcommands after "npm "
 *   - getShellCompletions() filters subcommands by prefix
 *   - getShellCompletions() returns empty for unknown binary subcommands
 *   - getShellCompletions() caps at MAX_SHELL_COMPLETIONS
 *   - ShellCompletion.isSubcommand is true for subcommands
 */

import { describe, it, expect } from 'vitest';

import { getShellCompletions, MAX_SHELL_COMPLETIONS } from '../../apps/cli/src/tui/lib/shellCompletion.js';

// ─── Binary completion ──────────────────────────────────────────────

describe('T-092: getShellCompletions() binary completion', () => {
  it('returns common binaries for empty partial', () => {
    const results = getShellCompletions('');
    expect(results.length).toBeGreaterThan(0);
    // The list is capped at MAX_SHELL_COMPLETIONS (20), so only check
    // binaries that appear in the first 20 entries.
    expect(results.some((r) => r.label === 'ls')).toBe(true);
    expect(results.some((r) => r.label === 'grep')).toBe(true);
    expect(results.some((r) => r.label === 'cat')).toBe(true);
  });

  it('filters binaries by prefix', () => {
    const results = getShellCompletions('gi');
    expect(results.length).toBe(1);
    expect(results[0]!.label).toBe('git');
    expect(results[0]!.isSubcommand).toBe(false);
  });

  it('returns empty for no matching binaries', () => {
    const results = getShellCompletions('xyz_nonexistent');
    expect(results).toEqual([]);
  });

  it('all results have isSubcommand=false for binary completion', () => {
    const results = getShellCompletions('c');
    expect(results.every((r) => !r.isSubcommand)).toBe(true);
  });
});


// ─── Git subcommand completion ──────────────────────────────────────

describe('T-092: getShellCompletions() git subcommands', () => {
  it('returns all git subcommands for "git " (empty subcmd prefix)', () => {
    const results = getShellCompletions('git ');
    expect(results.length).toBeGreaterThan(10);
    expect(results.some((r) => r.label === 'add')).toBe(true);
    expect(results.some((r) => r.label === 'commit')).toBe(true);
    expect(results.some((r) => r.label === 'push')).toBe(true);
  });

  it('filters git subcommands by prefix', () => {
    const results = getShellCompletions('git co');
    expect(results.some((r) => r.label === 'commit')).toBe(true);
    expect(results.some((r) => r.label === 'config')).toBe(true);
  });

  it('all git subcommand results have isSubcommand=true', () => {
    const results = getShellCompletions('git ');
    expect(results.every((r) => r.isSubcommand)).toBe(true);
  });

  it('returns value with "git" prefix for subcommands', () => {
    const results = getShellCompletions('git ad');
    expect(results[0]!.value).toBe('git add');
  });
});


// ─── npm subcommand completion ──────────────────────────────────────

describe('T-092: getShellCompletions() npm subcommands', () => {
  it('returns npm subcommands for "npm "', () => {
    const results = getShellCompletions('npm ');
    expect(results.length).toBeGreaterThan(5);
    expect(results.some((r) => r.label === 'install')).toBe(true);
    expect(results.some((r) => r.label === 'run')).toBe(true);
    expect(results.some((r) => r.label === 'test')).toBe(true);
  });

  it('filters npm subcommands by prefix', () => {
    const results = getShellCompletions('npm in');
    expect(results.some((r) => r.label === 'install')).toBe(true);
    expect(results.some((r) => r.label === 'init')).toBe(true);
  });

  it('returns pnpm subcommands for "pnpm "', () => {
    const results = getShellCompletions('pnpm ');
    expect(results.some((r) => r.label === 'install')).toBe(true);
  });

  it('returns yarn subcommands for "yarn "', () => {
    const results = getShellCompletions('yarn ');
    expect(results.some((r) => r.label === 'add')).toBe(true);
  });
});


// ─── Edge cases ─────────────────────────────────────────────────────

describe('T-092: getShellCompletions() edge cases', () => {
  it('returns empty for unknown binary subcommands', () => {
    const results = getShellCompletions('nonexistent_bin subcmd');
    expect(results).toEqual([]);
  });

  it('caps at MAX_SHELL_COMPLETIONS', () => {
    // Empty partial returns all common binaries — should be capped.
    const results = getShellCompletions('');
    expect(results.length).toBeLessThanOrEqual(MAX_SHELL_COMPLETIONS);
  });

  it('preserves typed args after subcommand', () => {
    // "git checkout -- " should preserve the "--" in the value.
    // Actually, our implementation handles parts.length >= 3 by preserving
    // the rest. Let me test "git ad existing_arg".
    const results = getShellCompletions('git ad existing');
    // "git ad existing" → parts = ['git', 'ad', 'existing']
    // subcmdPrefix = 'ad', typed_rest = 'existing'
    // Should return "git add existing"
    expect(results[0]!.value).toBe('git add existing');
  });
});
