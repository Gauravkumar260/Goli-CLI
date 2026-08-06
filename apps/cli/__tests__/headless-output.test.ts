/**
 * Unit tests for H19: Headless Structured Output.
 *
 * Verifies:
 *   - formatAsJson produces the correct JSON-serializable shape
 *   - formatAsText returns the response content (or error message)
 *   - formatUsageSummary returns the usage string (or empty)
 *   - parseOutputFormat validates the format string
 *   - tool call results are truncated in JSON output
 */

import { describe, it, expect } from 'vitest';

import {
  formatAsJson,
  formatAsText,
  formatUsageSummary,
  parseOutputFormat,
  type HeadlessJsonOutput,
} from '../src/commands/headless-output.js';

import type { AgentLoopResult, ToolCall, Todo } from '../../../../packages/core/src/index.js';

function makeResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    ok: true,
    stopReason: 'completed',
    content: 'The task is done.',
    totalTokens: 1234,
    totalCostUsd: 0.0056,
    iterations: 3,
    durationMs: 4567,
    todos: [],
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-1',
    name: 'read_file',
    arguments: '{"file_path":"/tmp/foo.txt"}',
    argumentsParsed: { file_path: '/tmp/foo.txt' },
    status: 'completed',
    result: 'file contents here',
    durationMs: 12,
    ...overrides,
  };
}

describe('H19 formatAsJson', () => {
  it('produces the correct JSON shape for a successful run', () => {
    const result = makeResult();
    const json = formatAsJson(result);
    expect(json.ok).toBe(true);
    expect(json.stopReason).toBe('completed');
    expect(json.response).toBe('The task is done.');
    expect(json.tokens.total).toBe(1234);
    expect(json.costUsd).toBe(0.0056);
    expect(json.iterations).toBe(3);
    expect(json.durationMs).toBe(4567);
    expect(json.todos).toEqual([]);
    expect(json.toolCalls).toEqual([]);
  });

  it('includes tool calls with truncated results', () => {
    const result = makeResult();
    const longResult = 'x'.repeat(2000);
    const tc = makeToolCall({
      result: longResult,
      status: 'completed',
    });
    const json = formatAsJson(result, [tc]);
    expect(json.toolCalls).toHaveLength(1);
    expect(json.toolCalls[0]!.name).toBe('read_file');
    expect(json.toolCalls[0]!.args).toEqual({ file_path: '/tmp/foo.txt' });
    expect(json.toolCalls[0]!.ok).toBe(true);
    expect(json.toolCalls[0]!.result!.length).toBeLessThan(2000);
    expect(json.toolCalls[0]!.result!.endsWith('…')).toBe(true);
  });

  it('includes error info for failed runs', () => {
    const result = makeResult({
      ok: false,
      stopReason: 'error',
      content: 'Error: something went wrong',
      error: 'something went wrong',
    });
    const json = formatAsJson(result);
    expect(json.ok).toBe(false);
    expect(json.stopReason).toBe('error');
    expect(json.error).toBe('something went wrong');
  });

  it('includes failed tool calls', () => {
    const result = makeResult();
    const tc = makeToolCall({
      name: 'bash',
      status: 'failed',
      error: 'command not found',
      result: undefined,
    });
    const json = formatAsJson(result, [tc]);
    expect(json.toolCalls).toHaveLength(1);
    expect(json.toolCalls[0]!.ok).toBe(false);
    expect(json.toolCalls[0]!.error).toBe('command not found');
    expect(json.toolCalls[0]!.result).toBeUndefined();
  });

  it('includes todos', () => {
    const todos: Todo[] = [
      { content: 'Fix bug', status: 'completed', priority: 'high' },
      { content: 'Write tests', status: 'in_progress', priority: 'medium' },
    ];
    const result = makeResult({ todos });
    const json = formatAsJson(result);
    expect(json.todos).toHaveLength(2);
    expect(json.todos[0]!.content).toBe('Fix bug');
    expect(json.todos[0]!.status).toBe('completed');
  });

  it('is JSON-serializable', () => {
    const result = makeResult();
    const tc = makeToolCall();
    const json = formatAsJson(result, [tc]);
    // Should not throw
    const str = JSON.stringify(json);
    expect(str).toContain('"ok":true');
    expect(str).toContain('"response":"The task is done."');
    expect(str).toContain('"name":"read_file"');
  });
});

describe('H19 formatAsText', () => {
  it('returns the response content for successful runs', () => {
    const result = makeResult({ content: 'Hello, world!' });
    expect(formatAsText(result)).toBe('Hello, world!');
  });

  it('returns an error message for failed runs', () => {
    const result = makeResult({
      ok: false,
      content: '',
      error: 'the model timed out',
    });
    expect(formatAsText(result)).toBe('Error: the model timed out');
  });

  it('returns a generic error when error is missing', () => {
    const result = makeResult({ ok: false, content: '', error: undefined });
    expect(formatAsText(result)).toBe('Error: agent run failed');
  });
});

describe('H19 formatUsageSummary', () => {
  it('returns a usage string with tokens, cost, iterations, duration', () => {
    const result = makeResult({
      totalTokens: 1234,
      totalCostUsd: 0.0056,
      iterations: 3,
      durationMs: 4567,
    });
    const usage = formatUsageSummary(result);
    expect(usage).toContain('Tokens: 1234');
    expect(usage).toContain('Cost: $0.0056');
    expect(usage).toContain('Iterations: 3');
    expect(usage).toContain('Duration: 4567ms');
  });

  it('returns empty string when no tokens or cost', () => {
    const result = makeResult({ totalTokens: 0, totalCostUsd: 0 });
    expect(formatUsageSummary(result)).toBe('');
  });
});

describe('H19 parseOutputFormat', () => {
  it('returns "text" for undefined or empty', () => {
    expect(parseOutputFormat(undefined)).toBe('text');
    expect(parseOutputFormat('')).toBe('text');
  });

  it('returns the format for valid values', () => {
    expect(parseOutputFormat('text')).toBe('text');
    expect(parseOutputFormat('json')).toBe('json');
    expect(parseOutputFormat('stream-json')).toBe('stream-json');
  });

  it('returns null for invalid values', () => {
    expect(parseOutputFormat('xml')).toBeNull();
    expect(parseOutputFormat('yaml')).toBeNull();
    expect(parseOutputFormat('JSON')).toBeNull(); // case-sensitive
  });
});
