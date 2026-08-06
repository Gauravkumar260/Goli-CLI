/**
 * Tests for T-101: /tips rotating tips command + tips module.
 *
 * Covers:
 *   - TIPS array is non-empty
 *   - TIPS entries have text + category
 *   - All categories are valid
 *   - getRandomTip() returns a Tip from TIPS
 *   - getTip(index) returns the correct tip
 *   - getTip() wraps with modulo
 *   - getTipsByCategory() filters correctly
 *   - getTipCount() returns TIPS.length
 *   - /tips command is registered
 *   - /tips has /tip alias
 *   - /tips is isSafeConcurrent
 *   - /tips (no args) shows a random tip
 *   - /tips list shows all tips grouped by category
 *   - /tips <category> filters by category
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  TIPS,
  getRandomTip,
  getTip,
  getTipsByCategory,
  getTipCount,
  type Tip,
} from '../src/tui/lib/tips.js';
import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands();
});

// ─── Tips module ────────────────────────────────────────────────────

describe('T-101: tips module', () => {
  it('TIPS array is non-empty', () => {
    expect(TIPS.length).toBeGreaterThan(10);
  });

  it('TIPS entries have text + category', () => {
    for (const tip of TIPS) {
      expect(tip.text).toBeTruthy();
      expect(tip.text.length).toBeGreaterThan(5);
      expect(['shortcut', 'command', 'feature', 'productivity']).toContain(tip.category);
    }
  });

  it('getRandomTip() returns a Tip from TIPS', () => {
    const tip = getRandomTip();
    expect(TIPS).toContain(tip);
  });

  it('getTip(0) returns the first tip', () => {
    expect(getTip(0)).toBe(TIPS[0]);
  });

  it('getTip() wraps with modulo', () => {
    const count = TIPS.length;
    expect(getTip(count)).toBe(TIPS[0]);
    expect(getTip(count + 1)).toBe(TIPS[1]);
  });

  it('getTipsByCategory() filters correctly', () => {
    const shortcuts = getTipsByCategory('shortcut');
    expect(shortcuts.length).toBeGreaterThan(0);
    expect(shortcuts.every((t) => t.category === 'shortcut')).toBe(true);

    const commands = getTipsByCategory('command');
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((t) => t.category === 'command')).toBe(true);
  });

  it('getTipCount() returns TIPS.length', () => {
    expect(getTipCount()).toBe(TIPS.length);
  });

  it('has tips in all 4 categories', () => {
    expect(getTipsByCategory('shortcut').length).toBeGreaterThan(0);
    expect(getTipsByCategory('command').length).toBeGreaterThan(0);
    expect(getTipsByCategory('feature').length).toBeGreaterThan(0);
    expect(getTipsByCategory('productivity').length).toBeGreaterThan(0);
  });
});


// ─── /tips command ──────────────────────────────────────────────────

describe('T-101: /tips command', () => {
  it('is registered', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'tips');
    expect(cmd).toBeDefined();
  });

  it('has /tip as an alias', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'tips');
    expect(cmd?.altNames).toContain('tip');
  });

  it('is isSafeConcurrent', () => {
    const cmd = globalCommands.entries().find((c) => c.name === 'tips');
    expect(cmd?.isSafeConcurrent).toBe(true);
  });

  it('/tips (no args) shows a random tip', () => {
    const cmd = globalCommands.resolve('tips');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler([]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Tip');
    expect(msg).toContain('💡');
    pushSpy.mockRestore();
  });

  it('/tips list shows all tips grouped by category', () => {
    const cmd = globalCommands.resolve('tips');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['list']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('All Tips');
    expect(msg).toContain('shortcut');
    expect(msg).toContain('command');
    expect(msg).toContain('feature');
    expect(msg).toContain('productivity');
    pushSpy.mockRestore();
  });

  it('/tips shortcut filters by shortcut category', () => {
    const cmd = globalCommands.resolve('tips');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['shortcut']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Tips [shortcut]');
    expect(msg).toContain('shortcut');
    pushSpy.mockRestore();
  });

  it('/tips command filters by command category', () => {
    const cmd = globalCommands.resolve('tips');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['command']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Tips [command]');
    pushSpy.mockRestore();
  });

  it('/tips unknown shows warning', () => {
    const cmd = globalCommands.resolve('tips');
    const pushSpy = vi.spyOn(AppStateStore, 'pushSystemMessage');
    cmd!.handler(['unknown_category']);
    const msg = pushSpy.mock.calls[0]![0];
    expect(msg).toContain('Unknown');
    pushSpy.mockRestore();
  });
});
