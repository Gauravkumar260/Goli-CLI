/**
 * Unit tests for Tier-1 CLI features — matched to the TUI design reference.
 *
 * The design's CommandRegistry registers these commands:
 *   help, godmode, safemode, tier, clear, design, btw, inputmode, plan, build, compact
 *
 * The previous version of this test expected commands (/model, /context,
 * /bashes, /theme, /permissions, /resume, /revert) that the design does
 * NOT register. This file was updated to match the design's actual
 * command set (the design is the source of truth for TUI parity).
 *
 * Also tests:
 *   - DiffReviewDialog (computeDiff function)
 *   - Permission mode cycling
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { computeDiff } from '../src/tui/components/DiffReviewDialog.js';
import { globalCommands, registerDefaultCommands } from '../src/tui/lib/CommandRegistry.js';
import { AppStateStore } from '../src/tui/state/AppStateStore.js';

beforeEach(() => {
  registerDefaultCommands(true); // force re-register
  AppStateStore.resetTokens();
});

describe('Tier-1 slash commands registered (matched to design)', () => {
  it('registers /help command', () => {
    expect(globalCommands.has('help')).toBe(true);
    const cmd = globalCommands.get('help')!;
    expect(cmd.description).toBeTruthy();
  });

  it('registers /godmode command', () => {
    expect(globalCommands.has('godmode')).toBe(true);
  });

  it('registers /safemode command', () => {
    expect(globalCommands.has('safemode')).toBe(true);
  });

  it('registers /tier command', () => {
    expect(globalCommands.has('tier')).toBe(true);
  });

  it('registers /clear command', () => {
    expect(globalCommands.has('clear')).toBe(true);
  });

  it('registers /design command', () => {
    expect(globalCommands.has('design')).toBe(true);
  });

  it('registers /btw command', () => {
    expect(globalCommands.has('btw')).toBe(true);
  });

  it('registers /inputmode command', () => {
    expect(globalCommands.has('inputmode')).toBe(true);
  });

  it('registers /plan command', () => {
    expect(globalCommands.has('plan')).toBe(true);
  });

  it('registers /build command', () => {
    expect(globalCommands.has('build')).toBe(true);
  });

  it('registers /compact command', () => {
    expect(globalCommands.has('compact')).toBe(true);
  });

  it('has 10+ commands total', () => {
    expect(globalCommands.entries().length).toBeGreaterThanOrEqual(10);
  });
});

describe('Slash command dispatch (matched to design)', () => {
  it('dispatches /help', () => {
    const result = globalCommands.dispatch('/help');
    expect(result.handled).toBe(true);
  });

  it('dispatches /godmode', () => {
    const result = globalCommands.dispatch('/godmode');
    expect(result.handled).toBe(true);
  });

  it('dispatches /safemode', () => {
    const result = globalCommands.dispatch('/safemode');
    expect(result.handled).toBe(true);
  });

  it('dispatches /tier with arg', () => {
    const result = globalCommands.dispatch('/tier T1');
    expect(result.handled).toBe(true);
  });

  it('dispatches /clear', () => {
    const result = globalCommands.dispatch('/clear');
    expect(result.handled).toBe(true);
  });

  it('dispatches /compact with instructions', () => {
    const result = globalCommands.dispatch('/compact focus on auth module');
    expect(result.handled).toBe(true);
  });

  it('dispatches /plan', () => {
    const result = globalCommands.dispatch('/plan');
    expect(result.handled).toBe(true);
  });

  it('dispatches /build', () => {
    const result = globalCommands.dispatch('/build');
    expect(result.handled).toBe(true);
  });

  it('returns unknown for unregistered commands', () => {
    const result = globalCommands.dispatch('/nonexistent');
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('unknown');
  });

  it('returns passthrough for non-slash input', () => {
    const result = globalCommands.dispatch('Hello world');
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('passthrough');
  });
});

describe('DiffReviewDialog computeDiff', () => {
  it('computes a simple line-level diff', () => {
    const old = 'line1\nline2\nline3';
    const new_ = 'line1\nchanged\nline3';
    const diff = computeDiff(old, new_);
    expect(diff.some((l) => l === '-line2')).toBe(true);
    expect(diff.some((l) => l === '+changed')).toBe(true);
  });

  it('includes context lines around the change', () => {
    const old = 'line1\nline2\nline3\nline4\nline5';
    const new_ = 'line1\nline2\nCHANGED\nline4\nline5';
    const diff = computeDiff(old, new_);
    // Context before
    expect(diff.some((l) => l === ' line2')).toBe(true);
    // The change
    expect(diff.some((l) => l === '-line3')).toBe(true);
    expect(diff.some((l) => l === '+CHANGED')).toBe(true);
    // Context after
    expect(diff.some((l) => l === ' line4')).toBe(true);
  });

  it('handles insertions (new lines added)', () => {
    const old = 'line1\nline3';
    const new_ = 'line1\nline2\nline3';
    const diff = computeDiff(old, new_);
    expect(diff.some((l) => l === '+line2')).toBe(true);
  });

  it('handles deletions (lines removed)', () => {
    const old = 'line1\nline2\nline3';
    const new_ = 'line1\nline3';
    const diff = computeDiff(old, new_);
    expect(diff.some((l) => l === '-line2')).toBe(true);
  });

  it('handles empty old content (new file)', () => {
    const diff = computeDiff('', 'new content');
    expect(diff.some((l) => l === '+new content')).toBe(true);
  });

  it('handles identical content (no diff)', () => {
    const diff = computeDiff('same\ncontent', 'same\ncontent');
    // Should have no +/- lines
    expect(diff.every((l) => !l.startsWith('+') && !l.startsWith('-'))).toBe(true);
  });
});

describe('Permission mode cycling', () => {
  it('AppStateStore supports permission mode setting', () => {
    AppStateStore.setPermissionMode('plan');
    const snap = AppStateStore.getSnapshot();
    expect(snap.permissionMode).toBe('plan');
  });

  it('cycles through permission modes', () => {
    // Default
    AppStateStore.setPermissionMode('default');
    expect(AppStateStore.getSnapshot().permissionMode).toBe('default');

    // Plan
    AppStateStore.setPermissionMode('plan');
    expect(AppStateStore.getSnapshot().permissionMode).toBe('plan');

    // Back to default
    AppStateStore.setPermissionMode('default');
    expect(AppStateStore.getSnapshot().permissionMode).toBe('default');
  });

  it('toggleGodMode changes god mode state', () => {
    const before = AppStateStore.getSnapshot().godMode;
    AppStateStore.toggleGodMode();
    const after = AppStateStore.getSnapshot().godMode;
    expect(after).toBe(!before);
  });
});
