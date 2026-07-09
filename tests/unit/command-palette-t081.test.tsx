/**
 * Tests for T-081: Interactive command palette (Ctrl+P).
 *
 * Covers:
 *   - filterCommandsByQuery returns all visible commands for empty query
 *   - filterCommandsByQuery filters by name (case-insensitive)
 *   - filterCommandsByQuery filters by description
 *   - filterCommandsByQuery filters by altNames
 *   - filterCommandsByQuery excludes hidden commands
 *   - CommandPalette renders search input + results
 *   - CommandPalette shows navigation hints
 *   - CommandPalette shows "No commands match" for no results
 *   - CommandPalette renders command names with descriptions
 *   - CommandPalette shows [MCP]/[Agent] suffix for non-builtin commands
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { CommandPalette, filterCommandsByQuery } from '../../packages/cli/src/tui/components/CommandPalette.js';
import { CommandRegistry, globalCommands, type Command } from '../../packages/cli/src/tui/lib/CommandRegistry.js';

function makeCommand(overrides: Partial<Command> = {}): Command {
  return {
    name: 'test',
    description: 'A test command',
    usage: '/test',
    handler: () => {},
    ...overrides,
  };
}

function makeRegistry(commands: Command[]): CommandRegistry {
  const reg = new CommandRegistry();
  for (const cmd of commands) reg.register(cmd);
  return reg;
}

// ─── filterCommandsByQuery ──────────────────────────────────────────

describe('T-081: filterCommandsByQuery', () => {
  it('returns all visible commands for empty query', () => {
    const cmds = [
      makeCommand({ name: 'help', description: 'Show help' }),
      makeCommand({ name: 'theme', description: 'Switch theme' }),
    ];
    const results = filterCommandsByQuery(cmds, '');
    expect(results).toHaveLength(2);
  });

  it('filters by name (case-insensitive)', () => {
    const cmds = [
      makeCommand({ name: 'theme', description: 'Switch theme' }),
      makeCommand({ name: 'help', description: 'Show help' }),
    ];
    const results = filterCommandsByQuery(cmds, 'THEME');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('theme');
  });

  it('filters by description', () => {
    const cmds = [
      makeCommand({ name: 'a', description: 'Switch color theme' }),
      makeCommand({ name: 'b', description: 'Show help info' }),
    ];
    const results = filterCommandsByQuery(cmds, 'color');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('a');
  });

  it('filters by altNames', () => {
    const cmds = [
      makeCommand({ name: 'about', description: 'About info', altNames: ['version', 'v'] }),
      makeCommand({ name: 'help', description: 'Show help' }),
    ];
    const results = filterCommandsByQuery(cmds, 'version');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('about');
  });

  it('excludes hidden commands', () => {
    const cmds = [
      makeCommand({ name: 'visible', description: 'Visible cmd' }),
      makeCommand({ name: 'secret', description: 'Hidden cmd', hidden: true }),
    ];
    const results = filterCommandsByQuery(cmds, '');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('visible');
  });

  it('returns empty array when no commands match', () => {
    const cmds = [makeCommand({ name: 'help', description: 'Show help' })];
    const results = filterCommandsByQuery(cmds, 'xyz_nonexistent');
    expect(results).toHaveLength(0);
  });
});


// ─── CommandPalette rendering ───────────────────────────────────────

describe('T-081: CommandPalette rendering', () => {
  it('renders the palette title and search input', () => {
    const reg = makeRegistry([makeCommand({ name: 'help', description: 'Show help' })]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Command Palette');
    expect(frame).toContain('>');
  });

  it('shows all visible commands initially', () => {
    const reg = makeRegistry([
      makeCommand({ name: 'help', description: 'Show help' }),
      makeCommand({ name: 'theme', description: 'Switch theme' }),
      makeCommand({ name: 'vim', description: 'Toggle vim mode' }),
    ]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/help');
    expect(frame).toContain('/theme');
    expect(frame).toContain('/vim');
  });

  it('shows navigation hints', () => {
    const reg = makeRegistry([makeCommand({ name: 'help', description: 'Show help' })]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('navigate');
    expect(frame).toContain('select');
    expect(frame).toContain('dismiss');
  });

  it('shows command descriptions', () => {
    const reg = makeRegistry([
      makeCommand({ name: 'help', description: 'Show help information' }),
    ]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Show help information');
  });

  it('shows [MCP] suffix for MCP commands', () => {
    const reg = makeRegistry([
      makeCommand({ name: 'search', description: 'Search the web', kind: 'MCP' }),
    ]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[MCP]');
  });

  it('shows [Agent] suffix for Agent commands', () => {
    const reg = makeRegistry([
      makeCommand({ name: 'coder', description: 'Coder agent', kind: 'Agent' }),
    ]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[Agent]');
  });

  it('renders without crashing with empty registry', () => {
    const reg = makeRegistry([]);
    const { lastFrame } = render(
      <CommandPalette
        registry={reg}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(lastFrame() ?? '').toContain('Command Palette');
  });
});


// ─── Integration with globalCommands ────────────────────────────────

describe('T-081: CommandPalette with globalCommands registry', () => {
  it('renders commands from the global registry', () => {
    // globalCommands is a singleton; it may or may not have commands
    // registered depending on test order. We just verify it renders.
    const { lastFrame } = render(
      <CommandPalette
        registry={globalCommands}
        cols={80}
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Command Palette');
  });
});
