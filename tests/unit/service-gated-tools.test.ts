/**
 * Unit tests for T-020 — service-gated tools via `check_fn`.
 *
 * Verifies the four acceptance criteria from tasks.json:
 *  1. Tool definition supports optional check_fn: () => boolean.
 *  2. ToolRegistry respects check_fn at schema-generation time.
 *  3. Documented in AGENTS.md (verified separately by footprint-ladder tests).
 *  4. Tests verify tool appears/disappears from schema based on check_fn.
 *
 * Also covers:
 *  - sync + async check_fn variants
 *  - check_fn that throws is treated as "unavailable"
 *  - dispatch() refuses to run a tool whose check_fn now returns false
 *    (defence-in-depth for the case where the model emits a call to a
 *    gated tool that wasn't in the schema).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ToolRegistry, type Tool, type ToolContext } from '@goli-cli/tool-system';

import type { ToolCall } from '../../packages/core/src/agent/types.js';

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `tc-${Math.random().toString(36).slice(2)}`,
    name,
    arguments: JSON.stringify(args),
    argumentsParsed: args,
    status: 'pending',
  };
}

function makeContext(): ToolContext {
  return {
    toolCallId: 'test',
    workspaceRoot: '/tmp/test',
    readFiles: new Set(),
    godMode: false,
    autoMode: false,
    sandboxMode: 'workspace-write',
  };
}

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => ({ toolCallId: 'x', ok: true, content: 'ok' }),
    ...overrides,
  };
}

describe('T-020: Tool.check_fn — acceptance criterion #1', () => {
  it('Tool interface accepts an optional check_fn field', () => {
    const tool: Tool = makeTool({
      check_fn: () => true,
    });
    expect(typeof tool.check_fn).toBe('function');
  });

  it('check_fn may be sync (returns boolean)', () => {
    const tool: Tool = makeTool({ check_fn: () => false });
    expect(tool.check_fn!()).toBe(false);
  });

  it('check_fn may be async (returns Promise<boolean>)', async () => {
    const tool: Tool = makeTool({ check_fn: async () => true });
    expect(await tool.check_fn!()).toBe(true);
  });

  it('check_fn is optional (omitting is allowed)', () => {
    const tool: Tool = makeTool();
    expect(tool.check_fn).toBeUndefined();
  });
});

describe('T-020: ToolRegistry.listAvailable — acceptance criterion #2', () => {
  let registry: ToolRegistry;
  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('returns all tools when none have check_fn', async () => {
    registry.register(makeTool({ name: 'a' }));
    registry.register(makeTool({ name: 'b' }));
    const available = await registry.listAvailable();
    expect(available.map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('includes tools whose check_fn returns true', async () => {
    registry.register(
      makeTool({ name: 'visible', check_fn: () => true }),
    );
    registry.register(
      makeTool({ name: 'hidden', check_fn: () => false }),
    );
    const available = await registry.listAvailable();
    expect(available.map((t) => t.name)).toEqual(['visible']);
  });

  it('respects async check_fn', async () => {
    registry.register(
      makeTool({
        name: 'async_visible',
        check_fn: async () => Promise.resolve(true),
      }),
    );
    registry.register(
      makeTool({
        name: 'async_hidden',
        check_fn: async () => Promise.resolve(false),
      }),
    );
    const available = await registry.listAvailable();
    expect(available.map((t) => t.name).sort()).toEqual(['async_visible']);
  });

  it('treats a throwing check_fn as unavailable (does not crash)', async () => {
    registry.register(
      makeTool({
        name: 'throws',
        check_fn: () => {
          throw new Error('probe failed');
        },
      }),
    );
    registry.register(makeTool({ name: 'safe' }));
    const available = await registry.listAvailable();
    expect(available.map((t) => t.name)).toEqual(['safe']);
  });

  it('treats a rejecting async check_fn as unavailable', async () => {
    registry.register(
      makeTool({
        name: 'rejects',
        check_fn: async () => Promise.reject(new Error('nope')),
      }),
    );
    const available = await registry.listAvailable();
    expect(available).toHaveLength(0);
  });
});

describe('T-020: ToolRegistry.getAvailableToolDefinitions — acceptance criterion #4 (appears/disappears)', () => {
  let registry: ToolRegistry;
  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('excludes gated-off tools from the schema', async () => {
    registry.register(makeTool({ name: 'always_on' }));
    registry.register(
      makeTool({
        name: 'gated_off',
        description: 'Should not appear',
        check_fn: () => false,
      }),
    );
    const defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.function.name).toBe('always_on');
  });

  it('includes gated-on tools in the schema', async () => {
    registry.register(
      makeTool({
        name: 'gated_on',
        check_fn: () => true,
      }),
    );
    const defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.function.name).toBe('gated_on');
  });

  it('flips inclusion when check_fn result changes between calls', async () => {
    let probe = false;
    registry.register(
      makeTool({
        name: 'flippy',
        check_fn: () => probe,
      }),
    );

    // First call: probe = false ⇒ excluded.
    let defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(0);

    // Flip probe to true ⇒ included.
    probe = true;
    defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.function.name).toBe('flippy');

    // Flip back to false ⇒ excluded again.
    probe = false;
    defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(0);
  });

  it('getToolDefinitions (without "Available") returns ALL regardless of check_fn', () => {
    // The sync variant is preserved for callers that explicitly want every
    // registered tool (e.g. debugging, MCP listing). It must NOT silently
    // filter — that would surprise callers.
    registry.register(makeTool({ name: 'always_on' }));
    registry.register(
      makeTool({
        name: 'gated_off',
        check_fn: () => false,
      }),
    );
    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(2);
  });
});

describe('T-020: ToolRegistry.dispatch — defence-in-depth', () => {
  let registry: ToolRegistry;
  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('refuses to dispatch to a tool whose check_fn now returns false', async () => {
    registry.register(
      makeTool({
        name: 'gated_off',
        check_fn: () => false,
        handler: () => ({ toolCallId: 'x', ok: true, content: 'should not run' }),
      }),
    );
    const result = await registry.dispatch(
      makeToolCall('gated_off', {}),
      makeContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('currently unavailable');
    expect(result.content).toBe('');
  });

  it('dispatches normally when check_fn returns true', async () => {
    registry.register(
      makeTool({
        name: 'gated_on',
        check_fn: () => true,
        handler: () => ({ toolCallId: 'x', ok: true, content: 'ran' }),
      }),
    );
    const result = await registry.dispatch(
      makeToolCall('gated_on', {}),
      makeContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe('ran');
  });

  it('refuses dispatch when check_fn throws', async () => {
    registry.register(
      makeTool({
        name: 'flaky',
        check_fn: () => {
          throw new Error('probe broken');
        },
        handler: () => ({ toolCallId: 'x', ok: true, content: 'should not run' }),
      }),
    );
    const result = await registry.dispatch(
      makeToolCall('flaky', {}),
      makeContext(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('currently unavailable');
  });
});

describe('T-020: Realistic service-gated tool example', () => {
  // Mirrors the documented example from AGENTS.md: a vision_analyze tool
  // that only appears when GOLI_VISION_ENDPOINT is set.
  afterEach(() => {
    delete process.env.GOLI_VISION_ENDPOINT;
  });

  it('vision_analyze is hidden when env var is unset', async () => {
    delete process.env.GOLI_VISION_ENDPOINT;
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'vision_analyze',
        description: 'Analyze an image.',
        check_fn: () => Boolean(process.env.GOLI_VISION_ENDPOINT),
        handler: () => ({ toolCallId: 'x', ok: true, content: 'analysis' }),
      }),
    );
    const defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(0);
  });

  it('vision_analyze appears when env var is set', async () => {
    process.env.GOLI_VISION_ENDPOINT = 'https://vision.example.com';
    const registry = new ToolRegistry();
    registry.register(
      makeTool({
        name: 'vision_analyze',
        description: 'Analyze an image.',
        check_fn: () => Boolean(process.env.GOLI_VISION_ENDPOINT),
        handler: () => ({ toolCallId: 'x', ok: true, content: 'analysis' }),
      }),
    );
    const defs = await registry.getAvailableToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.function.name).toBe('vision_analyze');
  });
});
