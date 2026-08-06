/**
 * Tests for T-098: Background shell registry + /bg command.
 *
 * Covers:
 *   - registerShell() adds an entry
 *   - getShells() returns all entries
 *   - markShellExited() updates running status + exitCode
 *   - removeShell() removes an entry
 *   - clearShells() empties the registry
 *   - subscribeToShells() fires on changes
 *   - /bg command is registered
 *   - /bg has /background and /shells aliases
 *   - /bg is isSafeConcurrent
 *   - /bg shows empty message when no shells
 *   - /bg lists shells when present
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  registerShell,
  markShellExited,
  removeShell,
  clearShells,
  getShells,
  subscribeToShells,
} from '../src/tui/lib/backgroundShellRegistry.js';
import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';

beforeEach(() => {
  clearShells();
  registerDefaultCommands();
});

// ─── Registry ───────────────────────────────────────────────────────

describe('T-098: backgroundShellRegistry', () => {
  it('getShells() returns empty array initially', () => {
    expect(getShells()).toEqual([]);
  });

  it('registerShell() adds an entry', () => {
    registerShell('shell-1', 'npm run dev');
    const shells = getShells();
    expect(shells.length).toBe(1);
    expect(shells[0]!.id).toBe('shell-1');
    expect(shells[0]!.command).toBe('npm run dev');
    expect(shells[0]!.running).toBe(true);
    expect(shells[0]!.startedAt).toBeGreaterThan(0);
  });

  it('markShellExited() updates running status + exitCode', () => {
    registerShell('shell-1', 'npm run dev');
    markShellExited('shell-1', 0);
    const shells = getShells();
    expect(shells[0]!.running).toBe(false);
    expect(shells[0]!.exitCode).toBe(0);
  });

  it('removeShell() removes an entry', () => {
    registerShell('shell-1', 'npm run dev');
    registerShell('shell-2', 'npm test');
    expect(getShells().length).toBe(2);
    removeShell('shell-1');
    expect(getShells().length).toBe(1);
    expect(getShells()[0]!.id).toBe('shell-2');
  });

  it('clearShells() empties the registry', () => {
    registerShell('shell-1', 'npm run dev');
    registerShell('shell-2', 'npm test');
    clearShells();
    expect(getShells()).toEqual([]);
  });

  it('subscribeToShells() fires on changes', () => {
    let calls = 0;
    const unsub = subscribeToShells(() => { calls++; });
    registerShell('shell-1', 'npm run dev');
    expect(calls).toBe(1);
    markShellExited('shell-1', 0);
    expect(calls).toBe(2);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    let calls = 0;
    const unsub = subscribeToShells(() => { calls++; });
    registerShell('shell-1', 'npm run dev');
    expect(calls).toBe(1);
    unsub();
    registerShell('shell-2', 'npm test');
    expect(calls).toBe(1);
  });
});


// ─── /bg command ────────────────────────────────────────────────────

describe('T-098: /bg command', () => {
  it('is registered', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'bg');
    expect(cmd).toBeDefined();
  });

  it('has /background as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'bg');
    expect(cmd?.altNames).toContain('background');
  });

  it('has /shells as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'bg');
    expect(cmd?.altNames).toContain('shells');
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'bg');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('shows empty message when no shells', () => {
    const cmd = globalCommands.resolve('bg');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]![0].toLowerCase()).toContain('no background');
    pushSpy.mockRestore();
  });

  it('lists shells when present', () => {
    registerShell('shell-1', 'npm run dev');
    registerShell('shell-2', 'npm test');

    const cmd = globalCommands.resolve('bg');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Background Shells');
    expect(msg).toContain('2');
    expect(msg).toContain('shell-1');
    expect(msg).toContain('shell-2');
    expect(msg).toContain('npm run dev');
    expect(msg).toContain('npm test');
    pushSpy.mockRestore();
  });

  it('shows running count', () => {
    registerShell('shell-1', 'npm run dev');
    registerShell('shell-2', 'npm test');
    markShellExited('shell-2', 0);

    const cmd = globalCommands.resolve('bg');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('1 running');
    expect(msg).toContain('exited');
    pushSpy.mockRestore();
  });
});
