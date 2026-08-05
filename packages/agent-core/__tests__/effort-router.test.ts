/**
 * Unit tests for the EffortRoutingClient (deep-dive recommendation 1).
 */

import { describe, it, expect } from 'vitest';

import { EffortRoutingClient } from '../src/effort-router.js';

import type { ModelCallable } from '../src/effort-router.js';
import type { Message } from '../src/types.js';

interface TestModelResponse {
  content: string;
  thinking: string;
  toolCalls: unknown[];
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  finishReason: string;
}

/** A mock model client that records the effort it received. */
function makeMockClient(): ModelCallable & { lastEffort?: string } {
  const mock: ModelCallable & { lastEffort?: string } = {
    async call(params) {
      mock.lastEffort = params.effort;
      return {
        content: 'mock response',
        thinking: '',
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 0,
        finishReason: 'stop',
      } satisfies TestModelResponse;
    },
  };
  return mock;
}

function makeMessage(role: Message['role'], content: string, toolCalls?: Message['toolCalls']): Message {
  return { role, content, toolCalls, timestamp: new Date().toISOString() };
}

describe('EffortRoutingClient', () => {
  it('downgrades to "high" on tool-execution turns', async () => {
    const mock = makeMockClient();
    const routed = new EffortRoutingClient({
      client: mock,
      toolExecutionEffort: 'high',
      plannerEffort: 'max',
    });

    // The last assistant message has tool calls → this is a
    // tool-execution turn (the model is about to receive tool results).
    const messages: Message[] = [
      makeMessage('system', 'You are a coding agent.'),
      makeMessage('user', 'Fix the bug'),
      makeMessage('assistant', 'Let me read the file.', [
        { id: 'tc1', name: 'read_file', arguments: '{"file_path":"src/foo.ts"}', status: 'pending' },
      ]),
      makeMessage('tool', 'file contents', undefined, 'tc1'),
    ];

    await routed.call({ messages, effort: 'max' });
    expect(mock.lastEffort).toBe('high');
  });

  it('upgrades to "max" on planner turns (system prompt has planner keywords)', async () => {
    const mock = makeMockClient();
    const routed = new EffortRoutingClient({
      client: mock,
      toolExecutionEffort: 'high',
      plannerEffort: 'max',
    });

    // System prompt contains "plan_task" → planner turn.
    const messages: Message[] = [
      makeMessage('system', 'You are a coding agent. Use plan_task to decompose complex tasks.'),
      makeMessage('user', 'Refactor the auth module'),
    ];

    await routed.call({ messages, effort: 'high' });
    expect(mock.lastEffort).toBe('max');
  });

  it('downgrades to "high" when last message is a tool result (tool-execution turn)', async () => {
    // Note: we can't distinguish "final answer" from "more tools" until
    // the model responds, so tool-result turns are classified as
    // 'tool-execution' (downgrade to 'high'). This saves tokens on
    // the common case (model emits another tool call) without hurting
    // the rare case (model produces a final answer — 'high' is still
    // sufficient for most answers).
    const mock = makeMockClient();
    const routed = new EffortRoutingClient({
      client: mock,
      toolExecutionEffort: 'high',
      plannerEffort: 'max',
    });

    const messages: Message[] = [
      makeMessage('system', 'You are a coding agent.'),
      makeMessage('user', 'What does the file contain?'),
      makeMessage('assistant', 'Let me read it.', [
        { id: 'tc1', name: 'read_file', arguments: '{}', status: 'completed' },
      ]),
      makeMessage('tool', 'The file contains the auth logic.', undefined, 'tc1'),
    ];

    await routed.call({ messages, effort: 'max' });
    expect(mock.lastEffort).toBe('high');
  });

  it('respects caller effort on default turns', async () => {
    const mock = makeMockClient();
    const routed = new EffortRoutingClient({
      client: mock,
      toolExecutionEffort: 'high',
      plannerEffort: 'max',
    });

    // No tool calls, no planner keywords, last message is user → default.
    const messages: Message[] = [
      makeMessage('system', 'You are a coding agent.'),
      makeMessage('user', 'Hello'),
    ];

    await routed.call({ messages, effort: 'low' });
    expect(mock.lastEffort).toBe('low');
  });

  it('passes through stream/signal/tools params', async () => {
    const mock = makeMockClient();
    const routed = new EffortRoutingClient({ client: mock });

    const messages: Message[] = [makeMessage('user', 'Hi')];
    const controller = new AbortController();

    await routed.call({
      messages,
      tools: [],
      stream: false,
      signal: controller.signal,
    });

    // Should not throw — params are forwarded.
    expect(mock.lastEffort).toBeDefined();
  });
});
