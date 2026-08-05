/**
 * Unit tests for T-045 — ThinkingMessage + ErrorMessage + WarningMessage + HintMessage.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. New message types added to Message union: 'thinking', 'error', 'warning', 'hint'.
 *  2. 4 new renderers in components/messages/.
 *  3. MessageBubble dispatcher routes each new type.
 *  4. Tests verify each renderer.
 *
 * Comparison reference: gemini-cli has 15 specialized message renderers.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';

import { ThinkingMessage } from '../../apps/cli/src/tui/components/messages/ThinkingMessage.js';
import { ErrorMessage } from '../../apps/cli/src/tui/components/messages/ErrorMessage.js';
import { WarningMessage } from '../../apps/cli/src/tui/components/messages/WarningMessage.js';
import { HintMessage } from '../../apps/cli/src/tui/components/messages/HintMessage.js';
import { MessageBubble } from '../../apps/cli/src/tui/components/MessageBubble.js';
import type { Message } from '../../apps/cli/src/tui/state/types.js';

// ─── Test fixtures ─────────────────────────────────────────────────

const thinkingMessage: Message = {
  id: 't1',
  type: 'thinking',
  content: 'Let me analyze the request...',
  timestamp: Date.now(),
  agentId: 'orchestrator',
};

const errorMessage: Message = {
  id: 'e1',
  type: 'error',
  content: 'Failed to read file: permission denied',
  timestamp: Date.now(),
  code: 'EACCES',
};

const errorMessageNoCode: Message = {
  id: 'e2',
  type: 'error',
  content: 'Network timeout',
  timestamp: Date.now(),
};

const warningMessage: Message = {
  id: 'w1',
  type: 'warning',
  content: 'Context near limit — use /compact to free tokens',
  timestamp: Date.now(),
};

const hintMessage: Message = {
  id: 'h1',
  type: 'hint',
  content: 'Press Tab to queue a follow-up message',
  timestamp: Date.now(),
};

// ─── ThinkingMessage (AC #4) ───────────────────────────────────────

describe('T-045: ThinkingMessage (AC #4)', () => {
  it('renders the thinking content', () => {
    const { lastFrame } = render(<ThinkingMessage message={thinkingMessage} />);
    expect(lastFrame() ?? '').toContain('Let me analyze the request...');
  });

  it('renders the 💭 icon', () => {
    const { lastFrame } = render(<ThinkingMessage message={thinkingMessage} />);
    expect(lastFrame() ?? '').toContain('💭');
  });

  it('renders the agent id', () => {
    const { lastFrame } = render(<ThinkingMessage message={thinkingMessage} />);
    expect(lastFrame() ?? '').toContain('orchestrator');
  });

  it('renders "(thinking)" label to distinguish from final answer', () => {
    const { lastFrame } = render(<ThinkingMessage message={thinkingMessage} />);
    expect(lastFrame() ?? '').toContain('thinking');
  });

  it('defaults to orchestrator when agentId is not provided', () => {
    const noAgent: Message = {
      id: 't2',
      type: 'thinking',
      content: 'thinking without agent',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<ThinkingMessage message={noAgent} />);
    expect(lastFrame() ?? '').toContain('orchestrator');
  });

  it('handles empty content', () => {
    const empty: Message = {
      id: 't3',
      type: 'thinking',
      content: '',
      timestamp: Date.now(),
    };
    const { lastFrame } = render(<ThinkingMessage message={empty} />);
    // Should not throw; 💭 + agent id still render.
    expect(lastFrame() ?? '').toContain('💭');
  });
});

// ─── ErrorMessage (AC #4) ──────────────────────────────────────────

describe('T-045: ErrorMessage (AC #4)', () => {
  it('renders the error content', () => {
    const { lastFrame } = render(<ErrorMessage message={errorMessage} />);
    expect(lastFrame() ?? '').toContain('Failed to read file: permission denied');
  });

  it('renders the ✗ icon', () => {
    const { lastFrame } = render(<ErrorMessage message={errorMessage} />);
    expect(lastFrame() ?? '').toContain('✗');
  });

  it('renders "Error:" label', () => {
    const { lastFrame } = render(<ErrorMessage message={errorMessage} />);
    expect(lastFrame() ?? '').toContain('Error:');
  });

  it('renders the error code when provided', () => {
    const { lastFrame } = render(<ErrorMessage message={errorMessage} />);
    expect(lastFrame() ?? '').toContain('EACCES');
    expect(lastFrame() ?? '').toContain('[code:');
  });

  it('does NOT render the code line when code is not provided', () => {
    const { lastFrame } = render(<ErrorMessage message={errorMessageNoCode} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Network timeout');
    expect(frame).not.toContain('[code:');
  });
});

// ─── WarningMessage (AC #4) ────────────────────────────────────────

describe('T-045: WarningMessage (AC #4)', () => {
  it('renders the warning content', () => {
    const { lastFrame } = render(<WarningMessage message={warningMessage} />);
    expect(lastFrame() ?? '').toContain('Context near limit');
  });

  it('renders the ⚠ icon', () => {
    const { lastFrame } = render(<WarningMessage message={warningMessage} />);
    expect(lastFrame() ?? '').toContain('⚠');
  });

  it('does NOT render the ✗ icon (that is for errors)', () => {
    const { lastFrame } = render(<WarningMessage message={warningMessage} />);
    expect(lastFrame() ?? '').not.toContain('✗');
  });
});

// ─── HintMessage (AC #4) ───────────────────────────────────────────

describe('T-045: HintMessage (AC #4)', () => {
  it('renders the hint content', () => {
    const { lastFrame } = render(<HintMessage message={hintMessage} />);
    expect(lastFrame() ?? '').toContain('Press Tab to queue');
  });

  it('renders the 💡 icon', () => {
    const { lastFrame } = render(<HintMessage message={hintMessage} />);
    expect(lastFrame() ?? '').toContain('💡');
  });

  it('does NOT render the ⚠ icon (that is for warnings)', () => {
    const { lastFrame } = render(<HintMessage message={hintMessage} />);
    expect(lastFrame() ?? '').not.toContain('⚠');
  });
});

// ─── Message type guard tests ──────────────────────────────────────

describe('T-045: Message union includes new types (AC #1)', () => {
  it('Message type accepts "thinking"', () => {
    const m: Message = { id: 'x', type: 'thinking', content: 'c', timestamp: 0 };
    expect(m.type).toBe('thinking');
  });

  it('Message type accepts "error"', () => {
    const m: Message = { id: 'x', type: 'error', content: 'c', timestamp: 0 };
    expect(m.type).toBe('error');
  });

  it('Message type accepts "error" with code', () => {
    const m: Message = { id: 'x', type: 'error', content: 'c', timestamp: 0, code: 'E1' };
    expect(m.code).toBe('E1');
  });

  it('Message type accepts "warning"', () => {
    const m: Message = { id: 'x', type: 'warning', content: 'c', timestamp: 0 };
    expect(m.type).toBe('warning');
  });

  it('Message type accepts "hint"', () => {
    const m: Message = { id: 'x', type: 'hint', content: 'c', timestamp: 0 };
    expect(m.type).toBe('hint');
  });

  it('Message type accepts "thinking" with agentId', () => {
    const m: Message = { id: 'x', type: 'thinking', content: 'c', timestamp: 0, agentId: 'coder' };
    expect(m.agentId).toBe('coder');
  });
});

// ─── MessageBubble dispatcher (AC #3) ──────────────────────────────

describe('T-045: MessageBubble routes new types (AC #3)', () => {
  it('routes thinking messages to ThinkingMessage', () => {
    const { lastFrame } = render(<MessageBubble message={thinkingMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('💭');
    expect(frame).toContain('Let me analyze the request...');
  });

  it('routes error messages to ErrorMessage', () => {
    const { lastFrame } = render(<MessageBubble message={errorMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✗');
    expect(frame).toContain('Failed to read file');
    expect(frame).toContain('EACCES');
  });

  it('routes warning messages to WarningMessage', () => {
    const { lastFrame } = render(<MessageBubble message={warningMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⚠');
    expect(frame).toContain('Context near limit');
  });

  it('routes hint messages to HintMessage', () => {
    const { lastFrame } = render(<MessageBubble message={hintMessage} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('💡');
    expect(frame).toContain('Press Tab');
  });
});

// ─── Icon distinctness ─────────────────────────────────────────────

describe('T-045: Each message type has a distinct icon', () => {
  const cases: Array<{ type: string; message: Message; icon: string }> = [
    { type: 'thinking', message: thinkingMessage, icon: '💭' },
    { type: 'error',    message: errorMessage,    icon: '✗' },
    { type: 'warning',  message: warningMessage,  icon: '⚠' },
    { type: 'hint',     message: hintMessage,     icon: '💡' },
  ];

  it.each(cases)('$type message renders icon $icon', ({ message, icon }) => {
    const { lastFrame } = render(<MessageBubble message={message} />);
    expect(lastFrame() ?? '').toContain(icon);
  });
});
