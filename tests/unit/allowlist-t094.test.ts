/**
 * Tests for T-094: Session allowlist view/clear UI (/allowlist command).
 *
 * Covers:
 *   - /allowlist command is registered
 *   - /allowlist (no args) lists entries when allowlist has items
 *   - /allowlist (no args) shows empty message when allowlist is empty
 *   - /allowlist clear clears all entries
 *   - /allowlist clear shows count of cleared entries
 *   - /allowlist has /al and /allow aliases
 *   - /allowlist is isSafeConcurrent (can run while agent streams)
 *   - AppStateStore.getAllowlist() returns entries
 *   - AppStateStore.clearAllowlist() empties the list
 *   - AppStateStore.addToAllowlist() adds entries
 *   - AppStateStore.isAllowlisted() checks entries
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { globalCommands, registerDefaultCommands } from '../../apps/cli/src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../../apps/cli/src/tui/state/AppStateStore.js';

beforeEach(() => {
  AppStateStore.clearAllowlist();
  registerDefaultCommands();
});

// ─── /allowlist command registration ────────────────────────────────

describe('T-094: /allowlist command registration', () => {
  it('is registered in the command registry', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'allowlist');
    expect(cmd).toBeDefined();
    expect(cmd!.description).toContain('allowlist');
  });

  it('has /al as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'allowlist');
    expect(cmd?.altNames).toContain('al');
  });

  it('has /allow as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'allowlist');
    expect(cmd?.altNames).toContain('allow');
  });

  it('is isSafeConcurrent (can run while agent streams)', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'allowlist');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });
});


// ─── /allowlist (no args) — list ────────────────────────────────────

describe('T-094: /allowlist list behavior', () => {
  it('shows empty message when allowlist is empty', () => {
    const cmd = globalCommands.resolve('allowlist');
    expect(cmd).toBeDefined();
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg.toLowerCase()).toContain('empty');
    pushSpy.mockRestore();
  });

  it('lists entries when allowlist has items', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('write_file', 'src/');

    const cmd = globalCommands.resolve('allowlist');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Session allowlist');
    expect(msg).toContain('2 entries');
    expect(msg).toContain('run_shell_command');
    expect(msg).toContain('npm test');
    expect(msg).toContain('write_file');
    expect(msg).toContain('src/');
    pushSpy.mockRestore();
  });

  it('shows entry age in the listing', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');

    const cmd = globalCommands.resolve('allowlist');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toMatch(/\d+s ago|\d+m ago/);
    pushSpy.mockRestore();
  });
});


// ─── /allowlist clear ───────────────────────────────────────────────

describe('T-094: /allowlist clear behavior', () => {
  it('clears all entries', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('write_file', 'src/');

    expect(AppStateStore.getAllowlist().length).toBe(2);

    const cmd = globalCommands.resolve('allowlist');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['clear']);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(AppStateStore.getAllowlist().length).toBe(0);
    pushSpy.mockRestore();
  });

  it('shows count of cleared entries', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('write_file', 'src/');

    const cmd = globalCommands.resolve('allowlist');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['clear']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Cleared 2 entries');
    pushSpy.mockRestore();
  });

  it('shows singular "entry" when clearing 1 entry', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');

    const cmd = globalCommands.resolve('allowlist');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['clear']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Cleared 1 entry');
    expect(msg).not.toContain('entries');
    pushSpy.mockRestore();
  });

  it('clears 0 entries gracefully', () => {
    const cmd = globalCommands.resolve('allowlist');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['clear']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Cleared 0 entries');
    pushSpy.mockRestore();
  });
});


// ─── AppStateStore allowlist methods ────────────────────────────────

describe('T-094: AppStateStore allowlist methods', () => {
  it('getAllowlist() returns empty array initially', () => {
    expect(AppStateStore.getAllowlist()).toEqual([]);
  });

  it('addToAllowlist() adds an entry', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    const entries = AppStateStore.getAllowlist();
    expect(entries.length).toBe(1);
    expect(entries[0]!.tool).toBe('run_shell_command');
    expect(entries[0]!.argPrefix).toBe('npm test');
    expect(entries[0]!.addedAt).toBeGreaterThan(0);
  });

  it('addToAllowlist() ignores duplicates', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.getAllowlist().length).toBe(1);
  });

  it('isAllowlisted() returns true for matching entries', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm test')).toBe(true);
    expect(AppStateStore.isAllowlisted('run_shell_command', 'npm test --verbose')).toBe(true);
  });

  it('isAllowlisted() returns false for non-matching entries', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    expect(AppStateStore.isAllowlisted('run_shell_command', 'rm -rf /')).toBe(false);
    expect(AppStateStore.isAllowlisted('write_file', 'src/')).toBe(false);
  });

  it('clearAllowlist() empties the list', () => {
    AppStateStore.addToAllowlist('run_shell_command', 'npm test');
    AppStateStore.addToAllowlist('write_file', 'src/');
    expect(AppStateStore.getAllowlist().length).toBe(2);
    AppStateStore.clearAllowlist();
    expect(AppStateStore.getAllowlist().length).toBe(0);
  });
});
