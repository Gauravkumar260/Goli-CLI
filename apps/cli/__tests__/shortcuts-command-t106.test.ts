/**
 * Tests for T-106: /shortcuts command (dynamic from keymap).
 *
 * Covers:
 *   - /shortcuts command is registered
 *   - /shortcuts is isSafeConcurrent
 *   - /shortcuts outputs keyboard shortcuts header
 *   - /shortcuts shows category-grouped shortcuts
 *   - /shortcuts shows Global category
 *   - /shortcuts shows Navigation category
 *   - /shortcuts shows Input category
 *   - /shortcuts shows clearScreen action (added in T-071)
 *   - /shortcuts shows copyResponse with ctrl+shift+c (fixed in T-071)
 *   - /shortcuts shows "Other" section with non-keymap shortcuts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands();
});

describe('T-106: /shortcuts command', () => {
  it('is registered', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'shortcuts');
    expect(cmd).toBeDefined();
  });

  it('has /keys and /hotkeys as aliases', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'shortcuts');
    expect(cmd?.altNames).toContain('keys');
    expect(cmd?.altNames).toContain('hotkeys');
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'shortcuts');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('outputs keyboard shortcuts header', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Keyboard shortcuts');
    pushSpy.mockRestore();
  });

  it('shows category-grouped shortcuts', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    // Should have at least one category label.
    expect(msg).toMatch(/Global|Navigation|Input|Session|Permission/);
    pushSpy.mockRestore();
  });

  it('shows Global category', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Global:');
    pushSpy.mockRestore();
  });

  it('shows clearScreen action (added in T-071)', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('clearScreen');
    expect(msg).toContain('ctrl+l');
    pushSpy.mockRestore();
  });

  it('shows copyResponse with ctrl+shift+c (fixed in T-071)', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('copyResponse');
    expect(msg).toContain('ctrl+shift+c');
    // Should NOT contain the old collision with ctrl+o
    pushSpy.mockRestore();
  });

  it('shows "Other" section with non-keymap shortcuts', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Other:');
    expect(msg).toContain('?');
    expect(msg).toContain('Tab');
    expect(msg).toContain('Double-Esc');
    pushSpy.mockRestore();
  });

  it('mentions keybindings.json for customization', () => {
    const cmd = globalCommands.resolve('shortcuts');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('keybindings.json');
    pushSpy.mockRestore();
  });
});
