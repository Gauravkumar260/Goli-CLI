/**
 * Unit tests for T-044 — SuggestionsDisplay command-kind suffixes + section headers.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. Commands can declare a `kind` field (e.g. 'MCP', 'Agent', 'builtin').
 *  2. SuggestionsDisplay renders the kind as a suffix in brackets.
 *  3. SuggestionsDisplay groups suggestions by sectionTitle (-- Section --).
 *  4. Tests verify suffix rendering + section headers.
 *
 * Comparison reference: gemini-cli SuggestionsDisplay has COMMAND_KIND_SUFFIX
 * + sectionTitle grouping.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import {
  SuggestionsDisplay,
  filterCommands,
  getFullLabel,
  MAX_SUGGESTIONS_TO_SHOW,
} from '../src/tui/components/SuggestionsDisplay.js';
import {
  globalCommands,
  registerDefaultCommands,
  type Command,
} from '../src/tui/lib/CommandRegistry.js';

beforeEach(() => {
  registerDefaultCommands(true);
});

describe('T-044: Command.kind field (AC #1)', () => {
  it('Command interface accepts kind: "MCP"', () => {
    const cmd: Command = {
      name: 'mcp-search',
      description: 'Search via MCP',
      handler: () => {},
      kind: 'MCP',
    };
    expect(cmd.kind).toBe('MCP');
  });

  it('Command interface accepts kind: "Agent"', () => {
    const cmd: Command = {
      name: 'spawn-coder',
      description: 'Spawn coder agent',
      handler: () => {},
      kind: 'Agent',
    };
    expect(cmd.kind).toBe('Agent');
  });

  it('Command.kind is optional (defaults to undefined → treated as builtin)', () => {
    const cmd: Command = {
      name: 'help',
      description: 'Show help',
      handler: () => {},
    };
    expect(cmd.kind).toBeUndefined();
  });

  it('Command.sectionTitle is optional', () => {
    const cmd: Command = {
      name: 'help',
      description: 'Show help',
      handler: () => {},
    };
    expect(cmd.sectionTitle).toBeUndefined();
  });
});

describe('T-044: getFullLabel (AC #2)', () => {
  it('returns just the name for builtin commands (no suffix)', () => {
    const cmd: Command = { name: 'help', description: '', handler: () => {}, kind: 'builtin' };
    expect(getFullLabel(cmd)).toBe('help');
  });

  it('returns name + [MCP] for MCP commands', () => {
    const cmd: Command = { name: 'search', description: '', handler: () => {}, kind: 'MCP' };
    expect(getFullLabel(cmd)).toBe('search [MCP]');
  });

  it('returns name + [Agent] for Agent commands', () => {
    const cmd: Command = { name: 'spawn', description: '', handler: () => {}, kind: 'Agent' };
    expect(getFullLabel(cmd)).toBe('spawn [Agent]');
  });

  it('returns name + [custom] for custom commands', () => {
    const cmd: Command = { name: 'my-cmd', description: '', handler: () => {}, kind: 'custom' };
    expect(getFullLabel(cmd)).toBe('my-cmd [custom]');
  });

  it('returns just the name when kind is undefined', () => {
    const cmd: Command = { name: 'help', description: '', handler: () => {} };
    expect(getFullLabel(cmd)).toBe('help');
  });
});

describe('T-044: SuggestionsDisplay renders kind suffix (AC #2)', () => {
  it('renders [MCP] suffix for MCP commands', () => {
    const cmds: Command[] = [
      { name: 'search', description: 'Search the web', handler: () => {}, kind: 'MCP' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    expect(lastFrame() ?? '').toContain('[MCP]');
    expect(lastFrame() ?? '').toContain('/search');
  });

  it('renders [Agent] suffix for Agent commands', () => {
    const cmds: Command[] = [
      { name: 'spawn', description: 'Spawn agent', handler: () => {}, kind: 'Agent' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    expect(lastFrame() ?? '').toContain('[Agent]');
  });

  it('does NOT render a suffix for builtin commands', () => {
    const cmds: Command[] = [
      { name: 'help', description: 'Show help', handler: () => {}, kind: 'builtin' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/help');
    expect(frame).not.toContain('[builtin]');
    expect(frame).not.toContain('[MCP]');
    expect(frame).not.toContain('[Agent]');
  });

  it('renders mixed kinds in the same list', () => {
    const cmds: Command[] = [
      { name: 'help', description: 'Show help', handler: () => {}, kind: 'builtin' },
      { name: 'search', description: 'Search', handler: () => {}, kind: 'MCP' },
      { name: 'spawn', description: 'Spawn', handler: () => {}, kind: 'Agent' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/help');
    expect(frame).toContain('[MCP]');
    expect(frame).toContain('[Agent]');
  });
});

describe('T-044: SuggestionsDisplay renders section headers (AC #3)', () => {
  it('renders "-- Built-in --" header for commands without sectionTitle', () => {
    const cmds: Command[] = [
      { name: 'help', description: 'Show help', handler: () => {} },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    expect(lastFrame() ?? '').toContain('-- Built-in --');
  });

  it('renders custom section title when provided', () => {
    const cmds: Command[] = [
      { name: 'search', description: 'Search', handler: () => {}, sectionTitle: 'MCP Commands' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    expect(lastFrame() ?? '').toContain('-- MCP Commands --');
  });

  it('renders section header only when section changes', () => {
    const cmds: Command[] = [
      { name: 'help', description: 'Show help', handler: () => {} }, // Built-in
      { name: 'clear', description: 'Clear', handler: () => {} }, // Built-in (no new header)
      { name: 'search', description: 'Search', handler: () => {}, sectionTitle: 'MCP Commands' },
      { name: 'fetch', description: 'Fetch', handler: () => {}, sectionTitle: 'MCP Commands' }, // no new header
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    // "Built-in" header should appear once.
    expect(frame.match(/-- Built-in --/g)?.length).toBe(1);
    // "MCP Commands" header should appear once.
    expect(frame.match(/-- MCP Commands --/g)?.length).toBe(1);
  });

  it('renders multiple sections when sectionTitle varies', () => {
    const cmds: Command[] = [
      { name: 'help', description: 'Show help', handler: () => {} },
      { name: 'search', description: 'Search', handler: () => {}, sectionTitle: 'MCP' },
      { name: 'spawn', description: 'Spawn', handler: () => {}, sectionTitle: 'Agents' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('-- Built-in --');
    expect(frame).toContain('-- MCP --');
    expect(frame).toContain('-- Agents --');
  });
});

describe('T-044: Integration — kind + section together', () => {
  it('renders MCP commands under MCP section with [MCP] suffix', () => {
    const cmds: Command[] = [
      { name: 'help', description: 'Show help', handler: () => {}, kind: 'builtin' },
      { name: 'search', description: 'Search', handler: () => {}, kind: 'MCP', sectionTitle: 'MCP' },
      { name: 'fetch', description: 'Fetch', handler: () => {}, kind: 'MCP', sectionTitle: 'MCP' },
      { name: 'spawn', description: 'Spawn', handler: () => {}, kind: 'Agent', sectionTitle: 'Agents' },
    ];
    const { lastFrame } = render(
      <SuggestionsDisplay suggestions={cmds} activeIndex={0} userInput="/" />,
    );
    const frame = lastFrame() ?? '';
    // All 3 section headers.
    expect(frame).toContain('-- Built-in --');
    expect(frame).toContain('-- MCP --');
    expect(frame).toContain('-- Agents --');
    // Kind suffixes.
    expect(frame).toContain('[MCP]');
    expect(frame).toContain('[Agent]');
    // No [builtin] suffix.
    expect(frame).not.toContain('[builtin]');
  });
});

describe('T-044: filterCommands still works with kind + sectionTitle', () => {
  it('filterCommands returns commands with kind/sectionTitle preserved', () => {
    const all = () => globalCommands.entries();
    const result = filterCommands(all(), '/');
    // All registered commands are builtin (no kind set); they should all
    // have kind === undefined and sectionTitle === undefined.
    for (const cmd of result) {
      expect(cmd.kind).toBeUndefined();
      expect(cmd.sectionTitle).toBeUndefined();
    }
  });
});

describe('T-044: MAX_SUGGESTIONS_TO_SHOW unchanged', () => {
  it('still equals 8', () => {
    expect(MAX_SUGGESTIONS_TO_SHOW).toBe(8);
  });
});
