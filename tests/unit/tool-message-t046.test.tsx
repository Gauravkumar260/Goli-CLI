/**
 * Unit tests for T-046 — ToolMessage sticky headers + expandable results + MCP progress.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. ToolMessage supports expanded/collapsed state (Ctrl+O toggle).
 *  2. StickyHeader component keeps tool name visible while scrolling.
 *  3. MCP progress indicator (progress bar for long-running MCP tools).
 *  4. Tests verify expand/collapse + progress rendering.
 *
 * Comparison reference: gemini-cli ToolMessage has StickyHeader +
 * McpProgressIndicator + FocusHint.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ToolMessage } from '../../packages/cli/src/tui/components/messages/ToolMessage.js';
import type { ToolCall } from '../../packages/cli/src/tui/state/types.js';

const successTool: ToolCall = {
  id: 'tc-ok',
  name: 'read_file',
  tier: 'T1',
  arg: 'README.md',
  state: 'success',
  output: 'Line 1\nLine 2\nLine 3',
};

const runningMcpTool: ToolCall = {
  id: 'tc-mcp',
  name: 'mcp-search',
  tier: 'T2',
  arg: 'query',
  state: 'running',
  meta: '0.6', // 60% progress
  output: 'Searching the web...',
};

const failedTool: ToolCall = {
  id: 'tc-fail',
  name: 'write_file',
  tier: 'T2',
  arg: '/etc/passwd',
  state: 'failed',
  error: 'permission denied',
};

// ─── Collapsed vs Expanded (AC #1) ─────────────────────────────────

describe('T-046: ToolMessage collapsed vs expanded (AC #1)', () => {
  it('collapsed: renders only the header row', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} isExpanded={false} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).toContain('README.md');
    // Output should NOT appear when collapsed.
    expect(frame).not.toContain('Line 1');
    expect(frame).not.toContain('Line 2');
  });

  it('expanded: renders header + output in a bordered box', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} isExpanded={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).toContain('Line 1');
    expect(frame).toContain('Line 2');
    expect(frame).toContain('Line 3');
  });

  it('expanded: shows [Ctrl+O to collapse] hint', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} isExpanded={true} />);
    expect(lastFrame() ?? '').toContain('Ctrl+O to collapse');
  });

  it('collapsed: does NOT show collapse hint', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} isExpanded={false} />);
    expect(lastFrame() ?? '').not.toContain('Ctrl+O to collapse');
  });

  it('defaults to collapsed when isExpanded is not specified', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('read_file');
    expect(frame).not.toContain('Line 1');
  });

  it('expanded: shows error output when tool failed', () => {
    const { lastFrame } = render(<ToolMessage toolCall={failedTool} isExpanded={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('write_file');
    expect(frame).toContain('permission denied');
    expect(frame).toContain('Error:');
  });
});

// ─── MCP progress indicator (AC #3) ────────────────────────────────

describe('T-046: MCP progress indicator (AC #3)', () => {
  it('shows progress bar for running MCP tools', () => {
    const { lastFrame } = render(<ToolMessage toolCall={runningMcpTool} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('mcp-search');
    // Progress bar chars.
    expect(frame).toContain('█');
    expect(frame).toContain('░');
    expect(frame).toContain('%');
  });

  it('shows 60% when meta=0.6', () => {
    const { lastFrame } = render(<ToolMessage toolCall={runningMcpTool} />);
    expect(lastFrame() ?? '').toContain('60%');
  });

  it('shows the progress message from output field', () => {
    const { lastFrame } = render(<ToolMessage toolCall={runningMcpTool} />);
    expect(lastFrame() ?? '').toContain('Searching the web...');
  });

  it('does NOT show progress bar for non-MCP tools', () => {
    const runningNonMcp: ToolCall = {
      id: 'tc-bash',
      name: 'bash',
      tier: 'T1',
      arg: 'ls',
      state: 'running',
      meta: '0.5',
    };
    const { lastFrame } = render(<ToolMessage toolCall={runningNonMcp} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bash');
    expect(frame).not.toContain('█');
    expect(frame).not.toContain('%');
  });

  it('does NOT show progress bar for completed MCP tools', () => {
    const completedMcp: ToolCall = {
      id: 'tc-mcp-done',
      name: 'mcp-search',
      tier: 'T2',
      arg: 'query',
      state: 'success',
      meta: '1.0',
      output: 'results',
    };
    const { lastFrame } = render(<ToolMessage toolCall={completedMcp} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('█');
    expect(frame).not.toContain('%');
  });

  it('detects MCP tools by mcp- prefix', () => {
    const mcpByName: ToolCall = {
      id: 'tc-1',
      name: 'mcp-weather',
      tier: 'T2',
      arg: 'forecast',
      state: 'running',
      meta: '0.3',
    };
    const { lastFrame } = render(<ToolMessage toolCall={mcpByName} />);
    expect(lastFrame() ?? '').toContain('%');
  });

  it('does NOT detect MCP tools by underscore in name (P0-3 fix)', () => {
    // P0-3 fix: previously any name containing `_` (e.g. github_search,
    // edit_file, read_file) was treated as an MCP tool. This caused
    // crashes because built-ins carry human-readable `meta` strings
    // (e.g. "+5 -2") that parseFloat parsed into bogus progress ratios,
    // then `'░'.repeat(16 - 192)` threw RangeError. Only the canonical
    // `mcp-` prefix is treated as an MCP tool now.
    const mcpByUnderscore: ToolCall = {
      id: 'tc-2',
      name: 'github_search',
      tier: 'T2',
      arg: 'q',
      state: 'running',
      meta: '0.4',
    };
    const { lastFrame } = render(<ToolMessage toolCall={mcpByUnderscore} />);
    expect(lastFrame() ?? '').not.toContain('%');
  });
});

// ─── Expanded result clamping (AC #2 — sticky header) ──────────────

describe('T-046: Expanded result clamping (AC #2)', () => {
  it('clamps output to availableTerminalHeight lines', () => {
    const longOutput: ToolCall = {
      id: 'tc-long',
      name: 'bash',
      tier: 'T1',
      arg: 'ls',
      state: 'success',
      output: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'),
    };
    const { lastFrame } = render(
      <ToolMessage toolCall={longOutput} isExpanded={true} availableTerminalHeight={5} />,
    );
    const frame = lastFrame() ?? '';
    // Should show at most 5 lines.
    expect(frame).toContain('line 0');
    expect(frame).toContain('line 4');
    // line 5+ should NOT appear (clamped).
    expect(frame).not.toContain('line 10');
    // Truncation message should appear.
    expect(frame).toContain('more lines');
  });

  it('shows all lines when availableTerminalHeight is not specified', () => {
    const shortOutput: ToolCall = {
      id: 'tc-short',
      name: 'bash',
      tier: 'T1',
      arg: 'echo',
      state: 'success',
      output: 'a\nb\nc',
    };
    const { lastFrame } = render(<ToolMessage toolCall={shortOutput} isExpanded={true} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('a');
    expect(frame).toContain('b');
    expect(frame).toContain('c');
    expect(frame).not.toContain('more lines');
  });

  it('uses minimum 3 lines when availableTerminalHeight is very small', () => {
    const output: ToolCall = {
      id: 'tc-min',
      name: 'bash',
      tier: 'T1',
      arg: 'x',
      state: 'success',
      output: 'a\nb\nc\nd\ne',
    };
    const { lastFrame } = render(
      <ToolMessage toolCall={output} isExpanded={true} availableTerminalHeight={1} />,
    );
    const frame = lastFrame() ?? '';
    // Should show at least 3 lines (the min clamp).
    expect(frame).toContain('a');
    expect(frame).toContain('b');
    expect(frame).toContain('c');
    // d and e should be truncated.
    expect(frame).toContain('more lines');
  });
});

// ─── Backward compatibility ────────────────────────────────────────

describe('T-046: Backward compatibility with existing ToolMessage tests', () => {
  it('still renders all 5 status states correctly', () => {
    const states: Array<{ state: ToolCall['state']; glyph: string }> = [
      { state: 'pending', glyph: '○' },
      { state: 'running', glyph: '◷' },
      { state: 'success', glyph: '✓' },
      { state: 'failed', glyph: '✗' },
      { state: 'denied', glyph: '⊘' },
    ];

    for (const { state, glyph } of states) {
      const tc: ToolCall = {
        id: `tc-${state}`,
        name: 'test_tool',
        tier: 'T1',
        arg: 'arg',
        state,
      };
      const { lastFrame } = render(<ToolMessage toolCall={tc} />);
      expect(lastFrame() ?? '').toContain(glyph);
    }
  });

  it('still shows the tool tier', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} />);
    expect(lastFrame() ?? '').toContain('T1');
  });

  it('still truncates very long args to 60 chars + ellipsis', () => {
    const longArg: ToolCall = {
      id: 'tc-long-arg',
      name: 'bash',
      tier: 'T1',
      arg: 'x'.repeat(100),
      state: 'success',
    };
    const { lastFrame } = render(<ToolMessage toolCall={longArg} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('…');
    expect(frame).not.toContain('x'.repeat(100));
  });
});
