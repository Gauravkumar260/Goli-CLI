/**
 * Tests for T-077: Dense/compact tool mode.
 *
 * Covers:
 *   - isCompactTool() returns true for allowlisted tools
 *   - isCompactTool() returns false for non-allowlisted tools
 *   - DenseToolMessage renders 1-line summary (collapsed)
 *   - DenseToolMessage shows duration when present
 *   - DenseToolMessage shows cost when present
 *   - DenseToolMessage shows meta when present
 *   - DenseToolMessage auto-expands failed calls
 *   - DenseToolMessage shows output when expanded
 *   - DenseToolMessage shows error when failed and no output
 *   - DenseToolMessage truncates long arg strings
 *   - AgentMessage routes to DenseToolMessage when GOLI_TUI_DENSE_TOOLS=1
 *   - AgentMessage routes to ToolMessage when GOLI_TUI_DENSE_TOOLS unset
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { DenseToolMessage, isCompactTool, COMPACT_TOOL_ALLOWLIST } from '../../apps/cli/src/tui/components/messages/DenseToolMessage.js';
import { AgentMessage } from '../../apps/cli/src/tui/components/messages/AgentMessage.js';
import type { ToolCall, Message } from '../../apps/cli/src/tui/state/types.js';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-1',
    name: 'edit_file',
    tier: 'T1',
    arg: 'src/foo.ts',
    state: 'success',
    ...overrides,
  };
}

function makeAgentMessage(toolCalls: ToolCall[]): Message {
  return {
    id: 'msg-1',
    type: 'agent',
    content: 'Done.',
    timestamp: Date.now(),
    streaming: false,
    toolCalls,
  };
}

const origDenseEnv = process.env['GOLI_TUI_DENSE_TOOLS'];

beforeEach(() => {
  delete process.env['GOLI_TUI_DENSE_TOOLS'];
});

afterEach(() => {
  if (origDenseEnv !== undefined) process.env['GOLI_TUI_DENSE_TOOLS'] = origDenseEnv;
  else delete process.env['GOLI_TUI_DENSE_TOOLS'];
});

// ─── isCompactTool() ────────────────────────────────────────────────

describe('T-077: isCompactTool()', () => {
  it('returns true for allowlisted tools', () => {
    expect(isCompactTool('read_file')).toBe(true);
    expect(isCompactTool('edit_file')).toBe(true);
    expect(isCompactTool('write_file')).toBe(true);
    expect(isCompactTool('grep')).toBe(true);
    // Round-2 verification item T1: `glob` and `ls` are dead refs
    // (no such tools are registered). Replaced with the actual
    // registered names: `list_directory` (the ls-equivalent).
    expect(isCompactTool('list_directory')).toBe(true);
    expect(isCompactTool('web_search')).toBe(true);
    expect(isCompactTool('web_fetch')).toBe(true);
  });

  it('returns false for non-allowlisted tools (including dead refs)', () => {
    // Round-2 verification item T1: `run_shell_command`, `glob`,
    // `ls`, `read_many_files` were dead refs — they should now
    // return false because the dense renderer only recognizes
    // actually-registered tool names.
    expect(isCompactTool('run_shell_command')).toBe(false);
    expect(isCompactTool('glob')).toBe(false);
    expect(isCompactTool('ls')).toBe(false);
    expect(isCompactTool('read_many_files')).toBe(false);
    expect(isCompactTool('mcp_search')).toBe(false);
    expect(isCompactTool('unknown_tool')).toBe(false);
  });

  it('COMPACT_TOOL_ALLOWLIST has at least 7 entries', () => {
    // Round-2 verification item T1: was previously 9 entries (with
    // 3 dead refs `glob`, `ls`, `read_many_files`). After cleanup,
    // the allowlist has 7 real entries (read_file, edit_file,
    // write_file, grep, list_directory, web_search, web_fetch).
    // Lower threshold to 7 to reflect the cleaned list.
    expect(COMPACT_TOOL_ALLOWLIST.length).toBeGreaterThanOrEqual(7);
  });
});


// ─── DenseToolMessage rendering ─────────────────────────────────────

describe('T-077: DenseToolMessage rendering', () => {
  it('renders 1-line summary with tool name + tier + arg', () => {
    const tc = makeToolCall();
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('edit_file');
    expect(frame).toContain('T1');
    expect(frame).toContain('src/foo.ts');
    expect(frame).toContain('✓'); // success glyph
  });

  it('shows duration when present', () => {
    const tc = makeToolCall({ durationMs: 500 });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('500ms');
  });

  it('shows cost when present', () => {
    const tc = makeToolCall({ cost: 0.05 });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('$0.05');
  });

  it('shows meta when present', () => {
    const tc = makeToolCall({ meta: '+5 -2' });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('+5 -2');
  });

  it('does NOT show output when collapsed (isExpanded=false)', () => {
    const tc = makeToolCall({ state: 'success', output: 'hidden output line' });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} isExpanded={false} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('hidden output line');
  });

  it('shows output when expanded (isExpanded=true)', () => {
    const tc = makeToolCall({ state: 'success', output: 'visible output' });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} isExpanded={true} />);
    expect(lastFrame() ?? '').toContain('visible output');
  });

  it('auto-expands failed calls (shows error output)', () => {
    const tc = makeToolCall({
      state: 'failed',
      error: 'permission denied',
      output: undefined,
    });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} isExpanded={false} />);
    expect(lastFrame() ?? '').toContain('permission denied');
  });

  it('truncates long arg strings (>50 chars)', () => {
    const longArg = 'a'.repeat(60);
    const tc = makeToolCall({ arg: longArg });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('…'); // ellipsis
    // Should not contain the full 60-char string
    expect(frame).not.toContain(longArg);
  });

  it('shows running glyph (◷) for running state', () => {
    const tc = makeToolCall({ state: 'running' });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('◷');
  });

  it('shows [Ctrl+O to collapse] when expanded', () => {
    const tc = makeToolCall({ state: 'success', output: 'out' });
    const { lastFrame } = render(<DenseToolMessage toolCall={tc} isExpanded={true} />);
    expect(lastFrame() ?? '').toContain('Ctrl+O to collapse');
  });
});


// ─── AgentMessage routing ───────────────────────────────────────────

describe('T-077: AgentMessage routes to DenseToolMessage', () => {
  it('uses DenseToolMessage when GOLI_TUI_DENSE_TOOLS=1 and tool is allowlisted', () => {
    process.env['GOLI_TUI_DENSE_TOOLS'] = '1';
    const tc = makeToolCall({ name: 'edit_file', state: 'success', output: 'dense output' });
    const msg = makeAgentMessage([tc]);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    const frame = lastFrame() ?? '';
    // In dense mode, the output should NOT be visible (collapsed by default)
    expect(frame).toContain('edit_file');
    expect(frame).not.toContain('dense output');
  });

  it('uses full ToolMessage when GOLI_TUI_DENSE_TOOLS is unset', () => {
    const tc = makeToolCall({ name: 'edit_file', state: 'success', output: 'full output' });
    const msg = makeAgentMessage([tc]);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    const frame = lastFrame() ?? '';
    // In full mode, the output is also collapsed by default (isExpanded=false)
    expect(frame).toContain('edit_file');
  });

  it('uses full ToolMessage for non-allowlisted tools even when dense mode is on', () => {
    process.env['GOLI_TUI_DENSE_TOOLS'] = '1';
    const tc = makeToolCall({ name: 'run_shell_command', state: 'success' });
    const msg = makeAgentMessage([tc]);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    expect(lastFrame() ?? '').toContain('run_shell_command');
  });

  it('renders multiple tool calls in dense mode', () => {
    process.env['GOLI_TUI_DENSE_TOOLS'] = '1';
    const tcs = [
      makeToolCall({ id: 'tc-1', name: 'read_file', arg: 'a.ts' }),
      makeToolCall({ id: 'tc-2', name: 'edit_file', arg: 'b.ts' }),
      makeToolCall({ id: 'tc-3', name: 'grep', arg: 'pattern' }),
    ];
    const msg = makeAgentMessage(tcs);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).toContain('edit_file');
    expect(frame).toContain('grep');
  });
});
