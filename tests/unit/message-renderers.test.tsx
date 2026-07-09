/**
 * Unit tests for T-037 — Specialized message renderers.
 *
 * Verifies the five acceptance criteria from tasks.json:
 *  1. New files: messages/{UserMessage,AgentMessage,SystemMessage,ToolMessage}.tsx
 *  2. UserMessage: green avatar + content.
 *  3. AgentMessage: agent-colored header (id · tokens) + content.
 *  4. SystemMessage: variant-colored (info/warning/error) with icon.
 *  5. ToolMessage: tool name + status indicator + collapsible result.
 *  6. MessageBubble becomes a dispatcher.
 *  7. All existing MessageBubble tests still pass.
 *
 * Comparison reference: gemini-cli packages/cli/src/ui/components/messages/
 * — 15 specialized message renderers (UserMessage, GeminiMessage, ToolMessage,
 * ErrorMessage, WarningMessage, ThinkingMessage, InfoMessage, HintMessage,
 * CompressionMessage, DiffRenderer, etc.).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { UserMessage } from '../../packages/cli/src/tui/components/messages/UserMessage.js';
import { AgentMessage } from '../../packages/cli/src/tui/components/messages/AgentMessage.js';
import { SystemMessage } from '../../packages/cli/src/tui/components/messages/SystemMessage.js';
import { ToolMessage } from '../../packages/cli/src/tui/components/messages/ToolMessage.js';
import { MessageBubble } from '../../packages/cli/src/tui/components/MessageBubble.js';
import type { Message, ToolCall } from '../../packages/cli/src/tui/state/types.js';

// ─── Test fixtures ─────────────────────────────────────────────────

const userMessage: Message = {
  id: 'u1',
  type: 'user',
  content: 'Hello, world!',
  timestamp: Date.now(),
};

const agentMessage: Message = {
  id: 'a1',
  type: 'agent',
  content: 'I can help with that.',
  timestamp: Date.now(),
  streaming: false,
  toolCalls: [],
  agentId: 'orchestrator',
  tok: 42,
};

const agentMessageWithTools: Message = {
  id: 'a2',
  type: 'agent',
  content: 'Done.',
  timestamp: Date.now(),
  streaming: false,
  toolCalls: [
    {
      id: 'tc1',
      name: 'bash',
      tier: 'T1',
      arg: 'ls -la /tmp',
      state: 'success',
    },
    {
      id: 'tc2',
      name: 'read_file',
      tier: 'T1',
      arg: 'package.json',
      state: 'success',
    },
  ],
};

const infoMessage: Message = {
  id: 's1',
  type: 'system',
  content: 'Session activated.',
  variant: 'info',
  timestamp: Date.now(),
};

const warningMessage: Message = {
  id: 's2',
  type: 'system',
  content: 'Context near limit.',
  variant: 'warning',
  timestamp: Date.now(),
};

const errorMessage: Message = {
  id: 's3',
  type: 'system',
  content: 'Tool failed.',
  variant: 'error',
  timestamp: Date.now(),
};

const runningTool: ToolCall = {
  id: 'tc-run',
  name: 'bash',
  tier: 'T1',
  arg: 'npm test',
  state: 'running',
};

const successTool: ToolCall = {
  id: 'tc-ok',
  name: 'read_file',
  tier: 'T1',
  arg: 'README.md',
  state: 'success',
};

const failedTool: ToolCall = {
  id: 'tc-fail',
  name: 'write_file',
  tier: 'T2',
  arg: '/etc/passwd',
  state: 'failed',
  error: 'permission denied',
};

const deniedTool: ToolCall = {
  id: 'tc-denied',
  name: 'bash',
  tier: 'T2',
  arg: 'rm -rf /',
  state: 'denied',
};

// ─── UserMessage (AC #2) ───────────────────────────────────────────

describe('T-037: UserMessage (AC #2)', () => {
  it('renders the user content', () => {
    const { lastFrame } = render(<UserMessage message={userMessage} />);
    expect(lastFrame() ?? '').toContain('Hello, world!');
  });

  it('renders the green dot avatar', () => {
    const { lastFrame } = render(<UserMessage message={userMessage} />);
    // The avatar is a colored ● character; ink-testing-library doesn't
    // render colors, but the glyph should appear.
    expect(lastFrame() ?? '').toContain('●');
  });

  it('renders multi-line content via wrap', () => {
    const multiLine: Message = {
      id: 'u2',
      type: 'user',
      content: 'line 1\nline 2\nline 3',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<UserMessage message={multiLine} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('line 1');
    expect(frame).toContain('line 2');
    expect(frame).toContain('line 3');
  });
});

// ─── AgentMessage (AC #3) ──────────────────────────────────────────

describe('T-037: AgentMessage (AC #3)', () => {
  it('renders the agent id in the header', () => {
    const { lastFrame } = render(<AgentMessage message={agentMessage} />);
    expect(lastFrame() ?? '').toContain('orchestrator');
  });

  it('renders the token count in the header', () => {
    const { lastFrame } = render(<AgentMessage message={agentMessage} />);
    expect(lastFrame() ?? '').toContain('42');
    expect(lastFrame() ?? '').toContain('tokens');
  });

  it('renders the content body', () => {
    const { lastFrame } = render(<AgentMessage message={agentMessage} />);
    expect(lastFrame() ?? '').toContain('I can help with that.');
  });

  it('renders tool calls when present', () => {
    const { lastFrame } = render(<AgentMessage message={agentMessageWithTools} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bash');
    expect(frame).toContain('read_file');
    expect(frame).toContain('ls -la /tmp');
    expect(frame).toContain('package.json');
  });

  it('renders multi-line agent content', () => {
    const multiLine: Message = {
      id: 'a3',
      type: 'agent',
      content: 'First paragraph.\nSecond paragraph.\nThird.',
      timestamp: Date.now(),
      streaming: false,
      toolCalls: [],
    };
    const { lastFrame } = render(<AgentMessage message={multiLine} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('First paragraph.');
    expect(frame).toContain('Second paragraph.');
    expect(frame).toContain('Third.');
  });

  it('handles empty content', () => {
    const empty: Message = {
      id: 'a4',
      type: 'agent',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      toolCalls: [],
    };
    const { lastFrame } = render(<AgentMessage message={empty} />);
    // Should not throw; header still renders.
    expect(lastFrame() ?? '').toContain('orchestrator');
  });
});

// ─── SystemMessage (AC #4) ─────────────────────────────────────────

describe('T-037: SystemMessage (AC #4)', () => {
  it('renders info variant with ℹ icon', () => {
    const { lastFrame } = render(<SystemMessage message={infoMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ℹ');
    expect(frame).toContain('Session activated.');
  });

  it('renders warning variant with ⚠ icon', () => {
    const { lastFrame } = render(<SystemMessage message={warningMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⚠');
    expect(frame).toContain('Context near limit.');
  });

  it('renders error variant with ✗ icon', () => {
    const { lastFrame } = render(<SystemMessage message={errorMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗');
    expect(frame).toContain('Tool failed.');
  });
});

// ─── ToolMessage (AC #5) ───────────────────────────────────────────

describe('T-037: ToolMessage (AC #5)', () => {
  it('renders a running tool with ◷ indicator', () => {
    const { lastFrame } = render(<ToolMessage toolCall={runningTool} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('◷');
    expect(frame).toContain('bash');
    expect(frame).toContain('npm test');
  });

  it('renders a successful tool with ✓ indicator', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('read_file');
    expect(frame).toContain('README.md');
  });

  it('renders a failed tool with ✗ indicator + error', () => {
    const { lastFrame } = render(<ToolMessage toolCall={failedTool} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗');
    expect(frame).toContain('write_file');
    expect(frame).toContain('permission denied');
  });

  it('renders a denied tool with ⊘ indicator', () => {
    const { lastFrame } = render(<ToolMessage toolCall={deniedTool} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⊘');
    expect(frame).toContain('rm -rf /');
  });

  it('shows the tool tier in the row', () => {
    const { lastFrame } = render(<ToolMessage toolCall={successTool} />);
    expect(lastFrame() ?? '').toContain('T1');
  });

  it('truncates very long args to 60 chars + ellipsis', () => {
    const longArg: ToolCall = {
      id: 'tc-long',
      name: 'bash',
      tier: 'T1',
      arg: 'x'.repeat(100),
      state: 'success',
    };
    const { lastFrame } = render(<ToolMessage toolCall={longArg} />);
    const frame = lastFrame() ?? '';
    // The arg should be truncated; the ellipsis char "…" should appear.
    expect(frame).toContain('…');
    // And the full 100-char arg should NOT appear.
    expect(frame).not.toContain('x'.repeat(100));
  });
});

// ─── MessageBubble dispatcher (AC #6) ──────────────────────────────

describe('T-037: MessageBubble dispatcher (AC #6)', () => {
  it('routes user messages to UserMessage', () => {
    const { lastFrame } = render(<MessageBubble message={userMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('●');
    expect(frame).toContain('Hello, world!');
  });

  it('routes agent messages to AgentMessage', () => {
    const { lastFrame } = render(<MessageBubble message={agentMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('orchestrator');
    expect(frame).toContain('I can help with that.');
  });

  it('routes system messages to SystemMessage', () => {
    const { lastFrame } = render(<MessageBubble message={infoMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('ℹ');
    expect(frame).toContain('Session activated.');
  });

  it('routes btw messages to SystemMessage with info variant', () => {
    const btwMessage: Message = {
      id: 'b1',
      type: 'btw',
      content: 'side question',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<MessageBubble message={btwMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('side question');
  });

  it('renders agent message with tool calls correctly via dispatcher', () => {
    const { lastFrame } = render(<MessageBubble message={agentMessageWithTools} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bash');
    expect(frame).toContain('read_file');
    expect(frame).toContain('Done.');
  });
});

// ─── Backward compatibility (AC #7 — existing tests still pass) ────

describe('T-037: Backward compatibility (AC #7)', () => {
  // These tests verify that the MessageBubble dispatcher preserves the
  // observable behavior of the old monolithic MessageBubble:
  //   - user messages render with ● avatar
  //   - system messages render with variant-colored icon
  //   - agent messages render with agent id + token count + content

  it('user message still renders the green dot avatar', () => {
    const { lastFrame } = render(<MessageBubble message={userMessage} />);
    expect(lastFrame() ?? '').toContain('●');
  });

  it('system error message still renders the ✗ icon', () => {
    const { lastFrame } = render(<MessageBubble message={errorMessage} />);
    expect(lastFrame() ?? '').toContain('✗');
    expect(lastFrame() ?? '').toContain('Tool failed.');
  });

  it('system warning message still renders the ⚠ icon', () => {
    const { lastFrame } = render(<MessageBubble message={warningMessage} />);
    expect(lastFrame() ?? '').toContain('⚠');
  });

  it('system info message still renders the ℹ icon', () => {
    const { lastFrame } = render(<MessageBubble message={infoMessage} />);
    expect(lastFrame() ?? '').toContain('ℹ');
  });

  it('agent message still renders the agent id and token count', () => {
    const { lastFrame } = render(<MessageBubble message={agentMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('orchestrator');
    expect(frame).toContain('42');
    expect(frame).toContain('tokens');
  });
});

// ─── Status indicator coverage ─────────────────────────────────────

describe('T-037: All tool states have distinct indicators', () => {
  const states: Array<{ state: ToolCall['state']; glyph: string }> = [
    { state: 'pending', glyph: '○' },
    { state: 'running', glyph: '◷' },
    { state: 'success', glyph: '✓' },
    { state: 'failed', glyph: '✗' },
    { state: 'denied', glyph: '⊘' },
  ];

  it.each(states)('state=$state renders glyph=$glyph', ({ state, glyph }) => {
    const tc: ToolCall = {
      id: `tc-${state}`,
      name: 'test_tool',
      tier: 'T1',
      arg: 'arg',
      state,
    };
    const { lastFrame } = render(<ToolMessage toolCall={tc} />);
    expect(lastFrame() ?? '').toContain(glyph);
  });
});
