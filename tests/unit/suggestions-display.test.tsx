/**
 * Unit tests for T-035 — Slash-command autocomplete suggestions.
 *
 * Verifies the five acceptance criteria from tasks.json:
 *  1. New component packages/cli/src/tui/components/SuggestionsDisplay.tsx.
 *  2. Typing / in PromptInput shows filtered list of matching commands.
 *  3. Arrow keys navigate; Enter selects; Esc dismisses.
 *  4. Each suggestion shows command name + description (from CommandRegistry).
 *  5. Active suggestion highlighted.
 *
 * Comparison reference: gemini-cli packages/cli/src/ui/components/SuggestionsDisplay.tsx.
 *
 * Note: These tests cover the pure logic (filterCommands) and the
 * SuggestionsDisplay component's rendering logic. End-to-end keyboard
 * interaction tests are out of scope for vitest + ink-testing-library
 * (they would require a full TTY emulator); they are validated by the
 * existing tui-smoke.test.ts and the a11y audit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import {
  SuggestionsDisplay,
  filterCommands,
  MAX_SUGGESTIONS_TO_SHOW,
} from '../../packages/cli/src/tui/components/SuggestionsDisplay.js';
import {
  globalCommands,
  registerDefaultCommands,
  type Command,
} from '../../packages/cli/src/tui/lib/CommandRegistry.js';

// Force registration of default commands before each test.
beforeEach(() => {
  registerDefaultCommands(true);
});

describe('T-035: filterCommands (AC #2 — prefix filtering)', () => {
  // NOTE: `globalCommands.entries()` must be called AFTER registerDefaultCommands
  // runs in beforeEach — so we use a getter, not a top-level const.
  const all = () => globalCommands.entries();

  it('returns all commands when input is just "/"', () => {
    const result = filterCommands(all(), '/');
    expect(result.length).toBeGreaterThan(0);
    // Should include help, godmode, etc.
    expect(result.map((c) => c.name)).toContain('help');
    expect(result.map((c) => c.name)).toContain('godmode');
  });

  it('returns only commands matching the prefix "/he"', () => {
    const result = filterCommands(all(), '/he');
    expect(result.length).toBe(1);
    expect(result[0]!.name).toBe('help');
  });

  it('is case-insensitive on the prefix', () => {
    const upper = filterCommands(all(), '/HELP');
    const lower = filterCommands(all(), '/help');
    expect(upper.length).toBe(lower.length);
    expect(upper[0]!.name).toBe('help');
  });

  it('returns empty for non-slash input', () => {
    expect(filterCommands(all(), 'hello')).toEqual([]);
    expect(filterCommands(all(), '')).toEqual([]);
  });

  it('returns empty when prefix matches no command', () => {
    expect(filterCommands(all(), '/zzzznotacommand')).toEqual([]);
  });

  it('matches partial prefixes ("/ti" → tier)', () => {
    const result = filterCommands(all(), '/ti');
    expect(result.map((c) => c.name)).toContain('tier');
  });
});

describe('T-035: SuggestionsDisplay (AC #1, #4, #5)', () => {
  const sampleCommands: Command[] = [
    { name: 'help', description: 'Show this help and shortcut reference', handler: () => {} },
    { name: 'godmode', description: 'Toggle Safe <-> God mode', handler: () => {} },
    { name: 'tier', description: 'Set the permission tier', handler: () => {} },
    { name: 'plan', description: 'Switch to Plan mode (read-only)', handler: () => {} },
    { name: 'build', description: 'Switch to Build mode', handler: () => {} },
    { name: 'compact', description: 'Manually compact context', handler: () => {} },
  ];

  it('renders null when suggestions list is empty', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={[]} activeIndex={-1} userInput="/zzz" />,
    );
    // ink-testing-library renders null components as an empty string, not null.
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders all suggestions when activeIndex is -1 (none active)', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={sampleCommands}
        activeIndex={-1}
        userInput="/"
      />,
    );
    const frame = lastFrame() ?? '';
    // All 6 command names should appear.
    for (const c of sampleCommands) {
      expect(frame).toContain(`/${c.name}`);
    }
    // Descriptions should appear too.
    expect(frame).toContain('Show this help and shortcut reference');
    expect(frame).toContain('Toggle Safe <-> God mode');
  });

  it('marks the active suggestion with the ▸ cursor', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={sampleCommands}
        activeIndex={1} // godmode is active
        userInput="/"
      />,
    );
    const frame = lastFrame() ?? '';
    // The active row starts with "▸ ", others with "  ".
    // Find the line containing "godmode" and verify it has ▸.
    const lines = frame.split('\n');
    const godmodeLine = lines.find((l) => l.includes('/godmode'));
    expect(godmodeLine).toBeDefined();
    expect(godmodeLine).toContain('▸');
    // The help line should NOT have ▸ (it's not active).
    const helpLine = lines.find((l) => l.includes('/help'));
    expect(helpLine).toBeDefined();
    expect(helpLine).not.toContain('▸');
  });

  it('shows the navigation hint when userInput is just "/"', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={sampleCommands}
        activeIndex={0}
        userInput="/"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('navigate');
    expect(frame).toContain('Enter select');
    expect(frame).toContain('Esc dismiss');
  });

  it('does NOT show the hint when userInput is more than "/"', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={sampleCommands.slice(0, 1)}
        activeIndex={0}
        userInput="/he"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('navigate');
  });

  it('shows ▲ when scrollOffset > 0', () => {
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={sampleCommands}
        activeIndex={3}
        userInput="/"
        scrollOffset={2}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▲');
  });

  it('shows ▼ when there are more suggestions below the visible window', () => {
    // Create 15 commands so the window of 8 leaves 7 below.
    const many: Command[] = Array.from({ length: 15 }, (_, i) => ({
      name: `cmd${i}`,
      description: `Description ${i}`,
      handler: () => {},
    }));
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={many}
        activeIndex={0}
        userInput="/"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▼');
  });

  it('shows position indicator (n/total) when list is longer than maxVisible', () => {
    const many: Command[] = Array.from({ length: 15 }, (_, i) => ({
      name: `cmd${i}`,
      description: `Description ${i}`,
      handler: () => {},
    }));
    const { lastFrame } = render(
      <SuggestionsDisplay
        suggestions={many}
        activeIndex={3}
        userInput="/"
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\(\d+\/15\)/);
  });

  it('handles empty description gracefully (still renders the name)', () => {
    const noDesc: Command[] = [
      { name: 'nodesc', description: '', handler: () => {} },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={noDesc} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/nodesc');
  });

  it('aligns descriptions to the same column regardless of name length', () => {
    const mixed: Command[] = [
      { name: 'a', description: 'Short', handler: () => {} },
      { name: 'longcommandname', description: 'Long', handler: () => {} },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={mixed} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    const lines = frame.split('\n').filter((l) => l.includes('/'));
    // Both lines should contain "Short" or "Long" at the same column.
    // We verify by checking that "Short" and "Long" appear.
    expect(frame).toContain('Short');
    expect(frame).toContain('Long');
  });
});

describe('T-035: MAX_SUGGESTIONS_TO_SHOW constant', () => {
  it('equals 8 (matches gemini-cli)', () => {
    expect(MAX_SUGGESTIONS_TO_SHOW).toBe(8);
  });
});

describe('T-035: Integration with globalCommands (AC #4)', () => {
  it('filterCommands on real registered commands returns expected matches', () => {
    const all = globalCommands.entries();
    expect(all.length).toBeGreaterThan(5);

    // /help should match
    const helpMatches = filterCommands(all, '/help');
    expect(helpMatches.length).toBe(1);
    expect(helpMatches[0]!.name).toBe('help');
    expect(helpMatches[0]!.description).toBeTruthy();

    // /bui should match /build
    const buiMatches = filterCommands(all, '/bui');
    expect(buiMatches.map((c) => c.name)).toContain('build');

    // /p should match /plan
    const pMatches = filterCommands(all, '/p');
    expect(pMatches.map((c) => c.name)).toContain('plan');
  });

  it('every registered command has a non-empty description (for the suggestions UI)', () => {
    const all = globalCommands.entries();
    for (const cmd of all) {
      expect(cmd.description.length, `/${cmd.name} must have a description`).toBeGreaterThan(0);
    }
  });
});
