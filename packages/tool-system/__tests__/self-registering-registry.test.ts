/**
 * Unit tests for the self-registering tool registry and toolsets.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  SelfRegisteringRegistry,
  toolError,
  toolResult,
  selfRegisteringRegistry,
} from '../src/self-registering-registry.js';
import {
  TOOLSETS,
  resolveToolset,
  listToolsets,
  CORE_TOOLS,
  getToolsetDefinitions,
} from '../src/toolsets.js';

import type { Tool } from '../src/types.js';

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: () => ({ toolCallId: 'x', ok: true, content: 'ok' }),
  };
}

describe('SelfRegisteringRegistry', () => {
  let registry: SelfRegisteringRegistry;

  beforeEach(() => {
    registry = new SelfRegisteringRegistry();
  });

  it('registers and retrieves tools', () => {
    registry.register(makeTool('test_tool'));
    expect(registry.get('test_tool')).toBeDefined();
    expect(registry.count).toBe(1);
  });

  it('rejects duplicate registration without override', () => {
    registry.register(makeTool('test_tool'));
    registry.register(makeTool('test_tool')); // no override
    expect(registry.count).toBe(1); // still 1
  });

  it('allows duplicate registration with override', () => {
    registry.register(makeTool('test_tool'));
    registry.register(makeTool('test_tool'), { override: true });
    expect(registry.count).toBe(1); // replaced, not added
  });

  it('unregisters tools', () => {
    registry.register(makeTool('test_tool'));
    expect(registry.unregister('test_tool')).toBe(true);
    expect(registry.count).toBe(0);
  });

  it('bumps generation counter on mutation', () => {
    const gen1 = registry.generation;
    registry.register(makeTool('a'));
    expect(registry.generation).toBe(gen1 + 1);
    registry.unregister('a');
    expect(registry.generation).toBe(gen1 + 2);
  });

  it('caches check_fn results with TTL', async () => {
    let checkCount = 0;
    registry.register(makeTool('gated'), {
      checkFn: () => {
        checkCount++;
        return true;
      },
    });

    await registry.isAvailable('gated');
    await registry.isAvailable('gated');
    // Second call should use cache (checkCount should still be 1)
    expect(checkCount).toBe(1);
  });

  it('invalidateCheckFnCache forces re-check', async () => {
    let checkCount = 0;
    registry.register(makeTool('gated'), {
      checkFn: () => {
        checkCount++;
        return true;
      },
    });

    await registry.isAvailable('gated');
    registry.invalidateCheckFnCache();
    await registry.isAvailable('gated');
    expect(checkCount).toBe(2);
  });

  it('listAvailable filters by check_fn', async () => {
    registry.register(makeTool('available'));
    registry.register(makeTool('unavailable'), {
      checkFn: () => false,
    });

    const available = await registry.listAvailable();
    expect(available).toHaveLength(1);
    expect(available[0]!.name).toBe('available');
  });

  it('getToolDefinitions returns OpenAI format', () => {
    registry.register(makeTool('tool_a'));
    registry.register(makeTool('tool_b'));

    const defs = registry.getToolDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs[0]!.type).toBe('function');
    expect(defs[0]!.function.name).toBe('tool_a');
  });

  it('getToolDefinitions applies dynamic_schema_overrides', () => {
    registry.register(makeTool('dynamic'), {
      dynamicSchemaOverrides: () => ({
        properties: { extra: { type: 'string' } },
      }),
    });

    const defs = registry.getToolDefinitions({ toolCallId: 'x', workspaceRoot: '/tmp', args: {}, readFiles: new Set(), godMode: false, autoMode: false, sandboxMode: 'workspace-write' });
    expect(defs[0]!.function.parameters.properties).toHaveProperty('extra');
  });
});

describe('toolError / toolResult helpers', () => {
  it('toolError produces JSON error string', () => {
    const result = JSON.parse(toolError('something went wrong'));
    expect(result.error).toBe('something went wrong');
  });

  it('toolError includes extra fields', () => {
    const result = JSON.parse(toolError('failed', { code: 500 }));
    expect(result.error).toBe('failed');
    expect(result.code).toBe(500);
  });

  it('toolResult produces JSON data string', () => {
    const result = JSON.parse(toolResult({ value: 42 }));
    expect(result.data.value).toBe(42);
  });

  it('toolResult includes extra fields', () => {
    const result = JSON.parse(toolResult('ok', { count: 3 }));
    expect(result.data).toBe('ok');
    expect(result.count).toBe(3);
  });
});

describe('Toolsets', () => {
  it('CORE_TOOLS contains the 7 core tools', () => {
    expect(CORE_TOOLS).toContain('read_file');
    expect(CORE_TOOLS).toContain('write_file');
    expect(CORE_TOOLS).toContain('edit_file');
    expect(CORE_TOOLS).toContain('bash');
    expect(CORE_TOOLS).toHaveLength(7);
  });

  it('TOOLSETS has expected entries', () => {
    expect(TOOLSETS['core']).toBeDefined();
    expect(TOOLSETS['coding']).toBeDefined();
    expect(TOOLSETS['debugging']).toBeDefined();
    expect(TOOLSETS['safe']).toBeDefined();
    expect(TOOLSETS['full']).toBeDefined();
  });

  it('resolveToolset expands includes recursively', () => {
    // debugging includes terminal + search + file_ops
    // search includes file_ops
    const tools = resolveToolset('debugging');
    expect(tools).toContain('bash'); // from terminal
    expect(tools).toContain('grep'); // from search
    expect(tools).toContain('read_file'); // from file_ops
  });

  it('resolveToolset deduplicates', () => {
    // file_ops appears in both search and debugging's direct includes
    const tools = resolveToolset('debugging');
    const unique = new Set(tools);
    expect(tools.length).toBe(unique.size);
  });

  it('resolveToolset returns empty for unknown toolset', () => {
    expect(resolveToolset('nonexistent')).toEqual([]);
  });

  it('listToolsets returns all toolset names', () => {
    const names = listToolsets();
    expect(names).toContain('core');
    expect(names).toContain('coding');
    expect(names.length).toBeGreaterThan(3);
  });

  it('getToolsetDefinitions filters by registry', () => {
    const mockRegistry = {
      get: (name: string) => (name === 'read_file' ? makeTool('read_file') : undefined),
    };
    const defs = getToolsetDefinitions('safe', mockRegistry);
    // safe = read_file + list_directory + grep, but mock only has read_file
    expect(defs).toHaveLength(1);
    expect(defs[0]!.function.name).toBe('read_file');
  });
});
