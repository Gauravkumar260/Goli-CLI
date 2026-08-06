/**
 * Unit tests for the ToolRegistry.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { createDefaultToolRegistry } from '../src/index.js';
import { ToolRegistry } from '../src/registry.js';

import type { ToolCall } from '@goli-cli/agent-core/types.js';
import type { Tool, ToolContext } from '../src/types.js';

function makeToolCall(name: string, args: Record<string, unknown>, parseError?: string): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: parseError ? undefined : args,
    parseError,
    status: 'pending',
  };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: 'test',
    workspaceRoot: '/tmp/test-workspace',
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and lists tools', () => {
    const tool: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: () => ({ toolCallId: 'x', ok: true, content: 'test' }),
    };
    registry.register(tool);
    expect(registry.has('test_tool')).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('throws on duplicate registration', () => {
    const tool: Tool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: () => ({ toolCallId: 'x', ok: true, content: 'test' }),
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow('already registered');
  });

  it('dispatches a valid tool call', async () => {
    const tool: Tool = {
      name: 'echo',
      description: 'Echo the input',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      handler: (args) => ({
        toolCallId: 'test',
        ok: true,
        content: `Echo: ${args['message']}`,
      }),
    };
    registry.register(tool);
    const result = await registry.dispatch(
      makeToolCall('echo', { message: 'hello' }),
      makeContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Echo: hello');
  });

  it('returns error for unknown tool', async () => {
    const result = await registry.dispatch(
      makeToolCall('nonexistent', {}),
      makeContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  it('returns error for invalid args (missing required)', async () => {
    const tool: Tool = {
      name: 'requires_path',
      description: 'Requires a path',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      handler: () => ({ toolCallId: 'x', ok: true, content: 'ok' }),
    };
    registry.register(tool);
    const result = await registry.dispatch(
      makeToolCall('requires_path', {}),
      makeContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('validation failed');
    expect(result.error).toContain('path');
  });

  it('returns error for parse errors', async () => {
    const tool: Tool = {
      name: 'test',
      description: 'Test',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: () => ({ toolCallId: 'x', ok: true, content: 'ok' }),
    };
    registry.register(tool);
    const result = await registry.dispatch(
      makeToolCall('test', {}, 'malformed JSON'),
      makeContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('parse');
  });

  it('truncates large results', async () => {
    const tool: Tool = {
      name: 'big_output',
      description: 'Returns a big string',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: () => ({
        toolCallId: 'x',
        ok: true,
        content: 'x'.repeat(100_000), // 100K chars > 4000 tokens
      }),
    };
    registry.register(tool);
    const result = await registry.dispatch(
      makeToolCall('big_output', {}),
      makeContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain('[... truncated ...]');
  });

  it('catches handler errors', async () => {
    const tool: Tool = {
      name: 'throws',
      description: 'Throws an error',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: () => {
        throw new Error('handler crashed');
      },
    };
    registry.register(tool);
    const result = await registry.dispatch(
      makeToolCall('throws', {}),
      makeContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('handler crashed');
  });
});

describe('createDefaultToolRegistry', () => {
  it('registers all 6 core tools', () => {
    const registry = createDefaultToolRegistry();
    const names = registry.list().map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('edit_file');
    expect(names).toContain('list_directory');
    expect(names).toContain('grep');
    expect(names).toContain('bash');
    // 13 original + 3 spec tools (H13) + 1 spawn_subagent (H15) + 4 LSP tools (H21) = 21
    expect(names).toContain('spec_write');
    expect(names).toContain('spec_review');
    expect(names).toContain('spec_update');
    expect(names).toContain('spawn_subagent');
    expect(names).toContain('lsp_hover');
    expect(names).toContain('lsp_goto_definition');
    expect(names).toContain('lsp_references');
    expect(names).toContain('lsp_diagnostics');
    expect(names).toHaveLength(21);
  });

  it('generates OpenAI tool definitions', () => {
    const registry = createDefaultToolRegistry();
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(21);
    expect(defs[0]!.type).toBe('function');
    expect(defs[0]!.function.name).toBe('read_file');
  });
});
