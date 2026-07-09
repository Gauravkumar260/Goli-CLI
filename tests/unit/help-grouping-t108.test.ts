/**
 * Tests for T-108: /help command with category grouping.
 *
 * Covers:
 *   - /help (no args) shows category-grouped commands
 *   - /help shows "Session & Mode" category
 *   - /help shows "UI & Display" category
 *   - /help shows "Information" category
 *   - /help shows "Tools & Permissions" category
 *   - /help shows total command count
 *   - /help mentions /shortcuts for keyboard shortcuts
 *   - /help <command> shows detailed info for a specific command
 *   - /help <unknown> shows a warning
 *   - /help is isSafeConcurrent
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { globalCommands, registerDefaultCommands } from '../../packages/cli/src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../../packages/cli/src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands();
});

describe('T-108: /help command with category grouping', () => {
  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'help');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('shows category-grouped commands', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Available commands');
    // Should have at least one category.
    expect(msg).toMatch(/Session & Mode|UI & Display|Information|Tools & Permissions/);
    pushSpy.mockRestore();
  });

  it('shows "Session & Mode" category', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Session & Mode:');
    pushSpy.mockRestore();
  });

  it('shows "UI & Display" category', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('UI & Display:');
    pushSpy.mockRestore();
  });

  it('shows "Information" category', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Information:');
    pushSpy.mockRestore();
  });

  it('shows "Tools & Permissions" category', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Tools & Permissions:');
    pushSpy.mockRestore();
  });

  it('shows total command count', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toMatch(/Available commands \(\d+ total\)/);
    pushSpy.mockRestore();
  });

  it('mentions /shortcuts for keyboard shortcuts', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('/shortcuts');
    pushSpy.mockRestore();
  });

  it('shows detailed info for /help theme', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['theme']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('/theme');
    expect(msg).toContain('theme');
    pushSpy.mockRestore();
  });

  it('shows warning for unknown command', () => {
    const cmd = globalCommands.resolve('help');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['nonexistent_cmd']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Unknown command');
    pushSpy.mockRestore();
  });
});
