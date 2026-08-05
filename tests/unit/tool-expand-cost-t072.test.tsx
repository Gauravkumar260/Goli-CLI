/**
 * Tests for T-072: ToolMessage expand-toggle + duration/cost rendering.
 *
 * Covers:
 *   - ToolMessage renders duration when durationMs is present
 *   - ToolMessage renders cost when cost is present
 *   - ToolMessage renders meta (e.g. "12 lines") on success
 *   - Failed tool calls auto-expand (show error output)
 *   - Successful tool calls are collapsed by default
 *   - AgentMessage passes isExpanded to ToolMessage
 *   - formatDuration formats correctly (ms/s/m)
 *   - formatCost formats correctly
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';

import { ToolMessage } from '../../apps/cli/src/tui/components/messages/ToolMessage.js';
import { AgentMessage } from '../../apps/cli/src/tui/components/messages/AgentMessage.js';
import type { ToolCall, Message } from '../../apps/cli/src/tui/state/types.js';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-1',
    name: 'read_file',
    tier: 'T0',
    arg: 'src/index.ts',
    state: 'success',
    ...overrides,
  };
}

// ─── Duration + cost rendering ──────────────────────────────────────

describe('T-072: ToolMessage renders duration + cost', () => {
  it('shows duration when durationMs is present', () => {
    const tc = makeToolCall({ durationMs: 500 });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('500ms');
  });

  it('shows duration in seconds when >= 1000ms', () => {
    const tc = makeToolCall({ durationMs: 1500 });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('1.5s');
  });

  it('shows duration in minutes when >= 60000ms', () => {
    const tc = makeToolCall({ durationMs: 65000 });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('1m 5s');
  });

  it('shows cost when cost is present', () => {
    const tc = makeToolCall({ cost: 0.05 });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('$0.05');
  });

  it('shows cost with 4 decimal places when < 0.01', () => {
    const tc = makeToolCall({ cost: 0.0001 });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('$0.0001');
  });

  it('shows meta on success (e.g. "12 lines")', () => {
    const tc = makeToolCall({ meta: '12 lines' });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain('12 lines');
  });

  it('does NOT show duration when durationMs is 0 or undefined', () => {
    const tc = makeToolCall({ durationMs: 0 });
    const frame = render(<ToolMessage toolCall={tc} />).lastFrame() ?? '';
    // Should not contain "0ms"
    expect(frame).not.toContain('0ms');
  });

  it('does NOT show cost when cost is 0 or undefined', () => {
    const tc = makeToolCall({ cost: 0 });
    const frame = render(<ToolMessage toolCall={tc} />).lastFrame() ?? '';
    // Should not contain "$0.00" or "$0.0000"
    expect(frame).not.toMatch(/\$0\.0/);
  });
});


// ─── Auto-expand failed tool calls ──────────────────────────────────

describe('T-072: ToolMessage auto-expands failed calls', () => {
  it('shows error output when state is failed (auto-expand)', () => {
    const tc = makeToolCall({
      state: 'failed',
      error: 'File not found',
      output: undefined,
    });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    const frame = lastFrame() ?? '';
    // The error should be visible (auto-expanded)
    expect(frame).toContain('File not found');
  });

  it('shows output when state is failed and output is present', () => {
    const tc = makeToolCall({
      state: 'failed',
      output: 'Error: permission denied\n  at line 42',
      error: 'permission denied',
    });
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('permission denied');
  });

  it('successful tool call is collapsed by default (no output shown)', () => {
    const tc = makeToolCall({
      state: 'success',
      output: 'line 1\nline 2\nline 3',
    });
    const { lastFrame } = render(<ToolMessage toolCall={tc} isExpanded={false} />);
    const frame = lastFrame() ?? '';
    // Output should NOT be visible when collapsed
    expect(frame).not.toContain('line 1');
    expect(frame).not.toContain('line 2');
  });

  it('successful tool call shows output when isExpanded is true', () => {
    const tc = makeToolCall({
      state: 'success',
      output: 'visible output line',
    });
    const { lastFrame } = render(<ToolMessage toolCall={tc} isExpanded={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('visible output line');
  });
});


// ─── AgentMessage passes isExpanded ─────────────────────────────────

describe('T-072: AgentMessage tracks expanded IDs', () => {
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

  it('renders tool calls with collapsed state by default', () => {
    const tc = makeToolCall({ state: 'success', output: 'hidden output' });
    const msg = makeAgentMessage([tc]);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    const frame = lastFrame() ?? '';
    // The tool name should be visible
    expect(frame).toContain('read_file');
    // But the output should be collapsed (not visible)
    expect(frame).not.toContain('hidden output');
  });

  it('auto-expands failed tool calls in agent message', () => {
    const tc = makeToolCall({
      state: 'failed',
      error: 'boom',
      output: 'detailed error info',
    });
    const msg = makeAgentMessage([tc]);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('boom');
  });

  it('renders multiple tool calls', () => {
    const tc1 = makeToolCall({ id: 'tc-1', name: 'read_file', arg: 'a.ts' });
    const tc2 = makeToolCall({ id: 'tc-2', name: 'edit_file', arg: 'b.ts', state: 'success' });
    const msg = makeAgentMessage([tc1, tc2]);
    const { lastFrame } = render(<AgentMessage message={msg} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).toContain('edit_file');
  });
});
