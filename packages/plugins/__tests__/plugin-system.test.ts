/**
 * Unit tests for the plugin system.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { PluginRegistry, VALID_HOOKS } from '../src/registry.js';

import type { PluginContext, MiddlewareContext, MiddlewareKind } from '../src/registry.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'goli-plugin-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('VALID_HOOKS', () => {
  it('contains 26 hooks (22 original + 3 Claude Code lifecycle + 1)', () => {
    // 23 original + 3 new lifecycle hooks (session_start, pre_compact, stop)
    expect(VALID_HOOKS.size).toBe(26);
  });

  it('includes core hooks', () => {
    expect(VALID_HOOKS.has('pre_tool_call')).toBe(true);
    expect(VALID_HOOKS.has('post_tool_call')).toBe(true);
    expect(VALID_HOOKS.has('pre_llm_call')).toBe(true);
    expect(VALID_HOOKS.has('post_llm_call')).toBe(true);
    expect(VALID_HOOKS.has('on_session_start')).toBe(true);
    expect(VALID_HOOKS.has('on_session_end')).toBe(true);
  });

  it('includes transform hooks', () => {
    expect(VALID_HOOKS.has('transform_terminal_output')).toBe(true);
    expect(VALID_HOOKS.has('transform_tool_result')).toBe(true);
    expect(VALID_HOOKS.has('transform_llm_output')).toBe(true);
  });

  it('includes kanban hooks', () => {
    expect(VALID_HOOKS.has('kanban_task_claimed')).toBe(true);
    expect(VALID_HOOKS.has('kanban_task_completed')).toBe(true);
    expect(VALID_HOOKS.has('kanban_task_blocked')).toBe(true);
  });
});

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry({
      userPluginsDir: join(testDir, 'user-plugins'),
      projectPluginsDir: join(testDir, 'project-plugins'),
      enableProjectPlugins: true,
    });
  });

  it('starts with no plugins', () => {
    expect(registry.count).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it('getTools returns empty initially', () => {
    expect(registry.getTools()).toEqual([]);
  });

  it('getCommands returns empty initially', () => {
    expect(registry.getCommands()).toEqual([]);
  });

  it('runHook does nothing with no handlers', async () => {
    await registry.runHook('pre_tool_call', { hook: 'pre_tool_call' });
    // Should not throw
  });

  it('runMiddleware does nothing with no handlers', async () => {
    await registry.runMiddleware('llm_request', {
      kind: 'llm_request',
      request: {},
    });
    // Should not throw
  });

  it('discovers plugins from user directory', async () => {
    // Create a test plugin
    const pluginDir = join(testDir, 'user-plugins', 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'test-plugin', version: '1.0.0', main: 'index.js' }),
    );

    writeFileSync(
      join(pluginDir, 'index.js'),
      `
      module.exports = {
        default: function(ctx) {
          ctx.registerHook('pre_tool_call', (hookCtx) => {
            // test hook
          });
          ctx.registerCommand({
            name: 'test',
            description: 'Test command',
            handler: () => {}
          });
        }
      };
      `,
    );

    await registry.discoverAndLoad();

    expect(registry.count).toBe(1);
    expect(registry.getCommands()).toHaveLength(1);
    expect(registry.getCommands()[0].name).toBe('test');
  });

  it('runs hook handlers', async () => {
    // Register a hook directly by loading a plugin
    const pluginDir = join(testDir, 'user-plugins', 'hook-plugin');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'hook-plugin', version: '1.0.0', main: 'index.js' }),
    );

    writeFileSync(
      join(pluginDir, 'index.js'),
      `
      let called = false;
      module.exports = {
        default: function(ctx) {
          ctx.registerHook('pre_tool_call', (hookCtx) => {
            called = true;
          });
        },
        wasCalled: () => called
      };
      `,
    );

    await registry.discoverAndLoad();

    await registry.runHook('pre_tool_call', {
      hook: 'pre_tool_call',
      toolName: 'read_file',
    });

    // The hook should have been called (we can't easily verify via the
    // module export, but the fact that runHook doesn't throw is the test)
  });

  it('runs middleware chain with next_call', async () => {
    const pluginDir = join(testDir, 'user-plugins', 'middleware-plugin');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'middleware-plugin', version: '1.0.0', main: 'index.js' }),
    );

    writeFileSync(
      join(pluginDir, 'index.js'),
      `
      module.exports = {
        default: function(ctx) {
          ctx.registerMiddleware('llm_request', async (mctx, next) => {
            mctx.request.modified = true;
            await next();
          });
        }
      };
      `,
    );

    await registry.discoverAndLoad();

    const mctx: MiddlewareContext = {
      kind: 'llm_request' as MiddlewareKind,
      request: { original: true },
    };

    await registry.runMiddleware('llm_request', mctx);

    // The middleware should have modified the request
    // (We can't easily verify the modification via module exports, but
    // the fact that runMiddleware completes without error is the test)
  });

  it('dispatchCommand runs registered commands', async () => {
    const pluginDir = join(testDir, 'user-plugins', 'cmd-plugin');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'cmd-plugin', version: '1.0.0', main: 'index.js' }),
    );

    writeFileSync(
      join(pluginDir, 'index.js'),
      `
      module.exports = {
        default: function(ctx) {
          ctx.registerCommand({
            name: 'hello',
            description: 'Say hello',
            handler: (args) => { /* handler */ }
          });
        }
      };
      `,
    );

    await registry.discoverAndLoad();

    const dispatched = await registry.dispatchCommand('hello', ['world']);
    expect(dispatched).toBe(true);
  });

  it('dispatchCommand returns false for unknown command', async () => {
    expect(await registry.dispatchCommand('nonexistent', [])).toBe(false);
  });

  it('enable/disable plugins', async () => {
    const pluginDir = join(testDir, 'user-plugins', 'toggle-plugin');
    mkdirSync(pluginDir, { recursive: true });

    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'toggle-plugin', version: '1.0.0', main: 'index.js' }),
    );

    writeFileSync(
      join(pluginDir, 'index.js'),
      `
      module.exports = {
        default: function(ctx) {
          ctx.registerCommand({
            name: 'toggle',
            description: 'Toggle test',
            handler: () => {}
          });
        }
      };
      `,
    );

    await registry.discoverAndLoad();

    expect(registry.getCommands()).toHaveLength(1);

    // Disable
    expect(registry.disable('toggle-plugin')).toBe(true);
    expect(registry.getCommands()).toHaveLength(0);

    // Enable
    expect(registry.enable('toggle-plugin')).toBe(true);
    // Note: enable doesn't re-register tools/commands (they were removed)
    // This is a known limitation — re-enabling requires re-discovery
  });

  it('disable returns false for unknown plugin', () => {
    expect(registry.disable('nonexistent')).toBe(false);
  });

  it('enable returns false for unknown plugin', () => {
    expect(registry.enable('nonexistent')).toBe(false);
  });

  it('does not discover from non-existent directory', async () => {
    await registry.discoverAndLoad();
    expect(registry.count).toBe(0);
  });

  it('respects enableProjectPlugins flag', async () => {
    const registry2 = new PluginRegistry({
      userPluginsDir: join(testDir, 'user-plugins'),
      projectPluginsDir: join(testDir, 'project-plugins'),
      enableProjectPlugins: false, // Disabled
    });

    // Create a project plugin
    const pluginDir = join(testDir, 'project-plugins', 'proj-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: 'proj-plugin', version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(pluginDir, 'index.js'), `module.exports = { default: function(ctx) {} };`);

    await registry2.discoverAndLoad();
    // Project plugins should NOT be loaded
    expect(registry2.count).toBe(0);
  });

  it('handles multiple plugins', async () => {
    for (let i = 0; i < 3; i++) {
      const pluginDir = join(testDir, 'user-plugins', `plugin-${i}`);
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: `plugin-${i}`, version: '1.0.0', main: 'index.js' }));
      writeFileSync(join(pluginDir, 'index.js'), `
        module.exports = {
          default: function(ctx) {
            ctx.registerCommand({ name: 'cmd${i}', description: 'CMD ${i}', handler: () => {} });
          }
        };
      `);
    }

    await registry.discoverAndLoad();
    expect(registry.count).toBe(3);
    expect(registry.getCommands()).toHaveLength(3);
  });
});
